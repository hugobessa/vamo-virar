import nodemailer from "nodemailer";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Any SMTP server: smtps://user:password@host:465 or smtp://user:password@host:587.
 * Short timeouts: a host that blocks outbound SMTP makes connections hang, and
 * the person filling in the form should not wait minutes for an error. */
export function smtpMailer(url: string, from: string): Mailer {
  const u = new URL(url);
  const transport = nodemailer.createTransport({
    host: u.hostname,
    port: Number(u.port) || (u.protocol === "smtps:" ? 465 : 587),
    secure: u.protocol === "smtps:",
    ...(u.username ? { auth: { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } } : {}),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
    },
  };
}

/** Mailgun's HTTP API, over HTTPS: for hosts that block outbound SMTP.
 * `apiUrl` is https://api.mailgun.net, or https://api.eu.mailgun.net for
 * domains in Mailgun's EU region. */
export function mailgunMailer(
  apiKey: string,
  domain: string,
  from: string,
  apiUrl = "https://api.mailgun.net",
  fetchImpl: typeof fetch = fetch,
): Mailer {
  const auth = `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`;
  const url = `${apiUrl.replace(/\/+$/, "")}/v3/${encodeURIComponent(domain)}/messages`;
  return {
    async send(m) {
      const form = new URLSearchParams({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      if (m.replyTo) form.set("h:Reply-To", m.replyTo);
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { authorization: auth },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`Mailgun respondeu ${res.status}: ${detail}`);
      }
    },
  };
}

/** Development only: prints emails instead of sending them. They carry
 * creation codes, so never run a public portal like this. */
export function logMailer(): Mailer {
  return {
    async send(m) {
      console.log(`\n--- email para ${m.to}: ${m.subject}\n${m.text}\n---\n`);
    },
  };
}
