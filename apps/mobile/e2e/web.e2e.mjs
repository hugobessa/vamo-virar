// End-to-end UI test: the exported web build of the app, driven in headless
// Chromium, talking to a real community-node. Two browser contexts play two
// people (separate storage), so this exercises the whole stack through the
// actual screens: create → invite → join → approve → event → volunteer →
// confirm.
//
//   npm run build && npx expo export -p web --output-dir dist-web
//   cargo build -p community-node
//   npm run e2e:web -w @vamo-virar/mobile
//
// Screenshots go to $E2E_SCREENSHOTS (default: e2e/screenshots).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist-web");
const nodeBin = process.env.VV_NODE_BIN ?? join(root, "../../target/debug/community-node");
const chromePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const shots = process.env.E2E_SCREENSHOTS ?? join(here, "screenshots");
const TOKEN = "e2e-token";

function fail(msg) {
  console.error(`E2E FAILED: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(dist, "index.html"))) fail("dist-web missing; run expo export first");
if (!existsSync(nodeBin)) fail(`community-node binary missing at ${nodeBin}`);
mkdirSync(shots, { recursive: true });

// --- community nodes: the first one, and a second to move to -----------------
async function startNode() {
  const dataDir = mkdtempSync(join(tmpdir(), "vv-e2e-"));
  writeFileSync(join(dataDir, "c.toml"), `provisioning_token = "${TOKEN}"\n`);
  const child = spawn(nodeBin, ["--config", join(dataDir, "c.toml"), "--listen", "127.0.0.1:0", "--data-dir", dataDir], { stdio: ["ignore", "pipe", "inherit"] });
  const url = await new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (d) => {
      out += d;
      const m = /listening on (\S+)/.exec(out);
      if (m) resolve(`http://${m[1]}`);
    });
    child.on("exit", () => reject(new Error("node exited")));
  });
  return { child, url };
}
const node = await startNode();
const node2 = await startNode();
const upstreams = { "/node/": node.url, "/node2/": node2.url };

// --- static app + same-origin proxy to the node -----------------------------
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".ttf": "font/ttf" };
const server = createServer(async (req, res) => {
  try {
    const prefix = Object.keys(upstreams).find((p) => req.url.startsWith(p));
    if (prefix) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const upstream = await fetch(upstreams[prefix] + req.url.slice(prefix.length - 1), {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => ["authorization", "content-type", "x-vv-provision-token"].includes(k))),
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/octet-stream" });
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(dist, path);
    if (!existsSync(file) || !extname(file)) file = join(dist, "index.html"); // SPA fallback
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const appUrl = `http://127.0.0.1:${server.address().port}`;
const apiUrl = `${appUrl}/node`;
const api2Url = `${appUrl}/node2`;

// --- browsers -----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: chromePath });
const errors = [];
async function person(name) {
  const ctx = await browser.newContext({ locale: "pt-BR", viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("dialog", (d) => d.accept());
  return page;
}
const byId = (page, id) => page.getByTestId(id);
const step = async (label, f) => {
  process.stdout.write(`• ${label} … `);
  await f();
  console.log("ok");
};
const shot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });

let exitCode = 0;
try {
  const ana = await person("Ana");
  const bia = await person("Bia");
  let invite;

  await step("Ana opens the app and sees the welcome screen", async () => {
    await ana.goto(appUrl);
    await ana.getByText("Organize sua comunidade").waitFor();
    await shot(ana, "01-welcome");
  });

  await step("Ana creates a community", async () => {
    await byId(ana, "go-create").click();
    await byId(ana, "community-name").fill("Coletivo Recife");
    await byId(ana, "display-name").fill("Ana");
    await byId(ana, "node-url").fill(apiUrl);
    await byId(ana, "setup-code").fill(TOKEN);
    await shot(ana, "02-create");
    await byId(ana, "create-submit").click();
    await ana.getByText("Tudo em dia").waitFor({ timeout: 15000 });
    await shot(ana, "03-community");
  });

  await step("Ana creates an invite link", async () => {
    await ana.getByRole("tab", { name: "Pessoas" }).click();
    await byId(ana, "create-invite").click();
    invite = await byId(ana, "invite-text").textContent({ timeout: 10000 });
    if (!invite?.startsWith("vamovirar://join?")) throw new Error(`bad invite: ${invite}`);
    await shot(ana, "04-invite");
  });

  await step("Bia asks to join with the link", async () => {
    await bia.goto(`${appUrl}/join`);
    await byId(bia, "invite-link").fill(invite);
    await byId(bia, "display-name").fill("Bia");
    await byId(bia, "join-submit").click();
    await bia.getByText("Pedido enviado").first().waitFor({ timeout: 10000 });
    await shot(bia, "05-waiting");
  });

  await step("Ana accepts Bia", async () => {
    await ana.getByRole("tab", { name: "Eventos" }).click();
    await ana.getByRole("tab", { name: "Pessoas" }).click(); // reloads requests
    await ana.getByText("Bia").first().waitFor({ timeout: 10000 });
    await shot(ana, "06-request");
    await ana.getByRole("button", { name: "Aceitar" }).first().click();
    await ana.getByText("Nenhum pedido agora.").waitFor({ timeout: 15000 });
  });

  await step("Bia is in", async () => {
    await bia.goto(appUrl);
    await bia.getByText("Coletivo Recife").first().click({ timeout: 15000 });
    await bia.getByRole("tab", { name: "Eventos" }).waitFor({ timeout: 15000 });
    await shot(bia, "07-bia-in");
  });

  await step("Ana creates an event", async () => {
    await ana.getByRole("tab", { name: "Eventos" }).click();
    await byId(ana, "new-event").click();
    await byId(ana, "event-title").fill("Plenária no Derby");
    await byId(ana, "event-place").fill("Praça do Derby");
    await byId(ana, "event-area").fill("recife");
    await byId(ana, "area-Recife, PE").click();
    await shot(ana, "08-new-event");
    await byId(ana, "event-save").click();
    await ana.getByText("Plenária no Derby").first().waitFor();
    await ana.getByText("Tudo em dia").waitFor({ timeout: 15000 });
    await shot(ana, "09-event-list");
  });

  await step("Bia sees the event and volunteers", async () => {
    await bia.reload();
    await bia.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await byId(bia, "self-volunteer").click();
    await bia.getByText("Você se ofereceu").last().waitFor();
    await shot(bia, "10-volunteered");
  });

  await step("Ana confirms Bia", async () => {
    await ana.reload();
    await ana.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await ana.getByRole("button", { name: "Confirmar" }).first().click({ timeout: 15000 });
    await ana.getByText("Confirmadas").last().waitFor();
    await shot(ana, "11-confirmed");
  });

  await step("Bia sees she is going", async () => {
    await bia.reload();
    await bia.getByText("Você vai").last().waitFor({ timeout: 15000 });
    await shot(bia, "12-going");
  });

  await step("Calendar settings explain what is read and work without any calendar", async () => {
    await bia.goto(appUrl);
    await byId(bia, "go-settings").click();
    await bia.getByText("nada da sua agenda sai do celular", { exact: false }).waitFor();
    await shot(bia, "13-calendar-settings");
  });

  await step("Bia adds a place and sees the event is near her", async () => {
    await byId(bia, "add-place").click();
    await byId(bia, "place-label").fill("Casa");
    await byId(bia, "place-area").fill("recife");
    await byId(bia, "place-option-Recife, PE").click();
    await byId(bia, "place-save").click();
    await bia.getByText("Casa · 15 km").waitFor();
    await shot(bia, "14-places");
    await bia.goto(appUrl);
    await bia.getByText("Coletivo Recife").first().click({ timeout: 15000 });
    // The list hides fit hints for events you're already going to; the event page shows them.
    await bia.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await bia.getByText("Perto de Casa", { exact: false }).last().waitFor({ timeout: 15000 });
    await shot(bia, "15-near");
  });

  await step("Ana asks who could come", async () => {
    await ana.getByTestId("ask-who-can-come").last().click();
    await ana.getByText("Pessoas perguntadas: 1").last().waitFor({ timeout: 15000 });
  });

  await step("Bia gets the question and answers", async () => {
    await bia.reload();
    await bia.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await bia.getByTestId("probe-question").last().waitFor({ timeout: 20000 });
    await shot(bia, "16-probe-question");
    await bia.getByTestId("probe-eligible").last().click();
    await bia.getByTestId("probe-question").last().waitFor({ state: "detached", timeout: 15000 });
  });

  await step("Ana sees the answer", async () => {
    await ana.reload();
    await ana.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await ana.getByTestId("ask-who-can-come").last().waitFor();
    // Results load after the sync that delivers Bia's reply.
    for (let i = 0; i < 40 && !(await ana.getByText("Podem: Bia").count()); i++) {
      await ana.waitForTimeout(500);
      if (i === 10) await ana.reload();
      if (i === 10) await ana.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    }
    await ana.getByText("Podem: Bia").last().waitFor({ timeout: 5000 });
    await shot(ana, "17-probe-results");
  });

  await step("Ana moves the community to another server", async () => {
    await ana.goto(appUrl);
    await ana.getByText("Coletivo Recife").first().click({ timeout: 15000 });
    await ana.getByRole("tab", { name: "Eu" }).last().click();
    await byId(ana, "move-address").last().fill(api2Url);
    await byId(ana, "move-setup-code").last().fill(TOKEN);
    await shot(ana, "18-move");
    await byId(ana, "move-button").last().click();
    await ana.getByText("Pronto: a comunidade está no novo servidor.").last().waitFor({ timeout: 20000 });
    await ana.getByText(`Servidor atual: ${api2Url}`).last().waitFor();
  });

  await step("Bia follows on her own and keeps working", async () => {
    await bia.goto(appUrl);
    await bia.getByText("Coletivo Recife").first().click({ timeout: 15000 });
    await bia.getByRole("tab", { name: "Eu" }).last().click();
    await byId(bia, "my-name").last().fill("Bia Mudou");
    await bia.getByText("Salvar", { exact: true }).last().click();
    await bia.getByText("Tudo em dia").last().waitFor({ timeout: 20000 });
    await ana.reload();
    await ana.getByText("Coletivo Recife").first().click({ timeout: 15000 });
    await ana.getByRole("tab", { name: "Pessoas" }).last().click();
    await ana.getByText("Bia Mudou").last().waitFor({ timeout: 20000 });
    await shot(ana, "19-after-move");
  });

  if (errors.length) throw new Error(`page errors:\n${errors.join("\n")}`);
  console.log(`\nE2E PASSED. Screenshots in ${shots}`);
} catch (e) {
  exitCode = 1;
  console.error(`\nE2E FAILED: ${e instanceof Error ? e.stack : e}`);
  for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: join(shots, `failure-${Date.now()}.png`) }).catch(() => {});
} finally {
  await browser.close();
  server.close();
  node.child.kill("SIGINT");
  node2.child.kill("SIGINT");
}
process.exit(exitCode);
