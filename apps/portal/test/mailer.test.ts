import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { mailgunMailer, smtpMailer } from "../src/mailer.js";

const mail = { to: "ana@example.org", subject: "Assunto", text: "texto", html: "<p>html</p>", replyTo: "admin@example.org" };

describe("mailgun", () => {
  it("posts the message to the HTTP API with basic auth", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"id":"x"}', { status: 200 });
    }) as unknown as typeof fetch;
    await mailgunMailer("key-123", "mg.example.org", "Vamo Virar <s@mg.example.org>", "https://api.eu.mailgun.net/", fake).send(mail);
    expect(calls[0]!.url).toBe("https://api.eu.mailgun.net/v3/mg.example.org/messages");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("api:key-123").toString("base64")}`);
    const body = calls[0]!.init.body as URLSearchParams;
    expect(body.get("from")).toBe("Vamo Virar <s@mg.example.org>");
    expect(body.get("to")).toBe("ana@example.org");
    expect(body.get("html")).toBe("<p>html</p>");
    expect(body.get("h:Reply-To")).toBe("admin@example.org");
  });

  it("reports errors from the API", async () => {
    const fake = (async () => new Response("Forbidden", { status: 401 })) as unknown as typeof fetch;
    await expect(mailgunMailer("bad", "mg.example.org", "x@mg.example.org", undefined, fake).send(mail)).rejects.toThrow(/401: Forbidden/);
  });

  it("is configured from the environment", () => {
    const env = {
      PORTAL_PUBLIC_URL: "https://x.example",
      PORTAL_ADMIN_PASSWORD: "uma-senha-bem-longa",
      PORTAL_ADMIN_EMAIL: "a@x.example",
      PORTAL_MAIL_FROM: "a@x.example",
      VV_OPERATOR_TOKEN: "t".repeat(20),
    };
    expect(loadConfig(env).mailgun).toBeUndefined();
    expect(() => loadConfig({ ...env, PORTAL_MAILGUN_API_KEY: "k" })).toThrow(/PORTAL_MAILGUN_DOMAIN/);
    expect(loadConfig({ ...env, PORTAL_MAILGUN_API_KEY: "k", PORTAL_MAILGUN_DOMAIN: "mg.x.example" }).mailgun).toEqual({
      apiKey: "k",
      domain: "mg.x.example",
      apiUrl: "https://api.mailgun.net",
    });
  });
});

describe("smtp", () => {
  it("gives up quickly on a server that never answers", async () => {
    // Accepts the connection and stays silent, like a blocked or filtered port.
    const silent: Server = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    const port = (silent.address() as AddressInfo).port;
    const started = Date.now();
    await expect(smtpMailer(`smtp://u:p@127.0.0.1:${port}`, "x@example.org").send(mail)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(20_000);
    silent.close();
  }, 25_000);
});
