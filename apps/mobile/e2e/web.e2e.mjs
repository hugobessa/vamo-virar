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

// --- community node ---------------------------------------------------------
const dataDir = mkdtempSync(join(tmpdir(), "vv-e2e-"));
writeFileSync(join(dataDir, "c.toml"), `provisioning_token = "${TOKEN}"\n`);
const node = spawn(nodeBin, ["--config", join(dataDir, "c.toml"), "--listen", "127.0.0.1:0", "--data-dir", dataDir], { stdio: ["ignore", "pipe", "inherit"] });
const nodeUrl = await new Promise((resolve, reject) => {
  let out = "";
  node.stdout.on("data", (d) => {
    out += d;
    const m = /listening on (\S+)/.exec(out);
    if (m) resolve(`http://${m[1]}`);
  });
  node.on("exit", () => reject(new Error("node exited")));
});

// --- static app + same-origin proxy to the node -----------------------------
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".ttf": "font/ttf" };
const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/node/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const upstream = await fetch(nodeUrl + req.url.slice(5), {
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

// --- browsers -----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: chromePath });
const errors = [];
async function person(name) {
  const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 420, height: 900 } });
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
    await ana.getByText("Organize your community").waitFor();
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
    await ana.getByText("Up to date").waitFor({ timeout: 15000 });
    await shot(ana, "03-community");
  });

  await step("Ana creates an invite link", async () => {
    await ana.getByRole("tab", { name: "People" }).click();
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
    await bia.getByText("Request sent").first().waitFor({ timeout: 10000 });
    await shot(bia, "05-waiting");
  });

  await step("Ana accepts Bia", async () => {
    await ana.getByRole("tab", { name: "Events" }).click();
    await ana.getByRole("tab", { name: "People" }).click(); // reloads requests
    await ana.getByText("Bia").first().waitFor({ timeout: 10000 });
    await shot(ana, "06-request");
    await ana.getByRole("button", { name: "Accept" }).first().click();
    await ana.getByText("No requests right now.").waitFor({ timeout: 15000 });
  });

  await step("Bia is in", async () => {
    await bia.goto(appUrl);
    await bia.getByText("Coletivo Recife").first().click({ timeout: 15000 });
    await bia.getByRole("tab", { name: "Events" }).waitFor({ timeout: 15000 });
    await shot(bia, "07-bia-in");
  });

  await step("Ana creates an event", async () => {
    await ana.getByRole("tab", { name: "Events" }).click();
    await byId(ana, "new-event").click();
    await byId(ana, "event-title").fill("Plenária no Derby");
    await byId(ana, "event-place").fill("Praça do Derby");
    await byId(ana, "event-area").fill("recife");
    await byId(ana, "area-Recife, PE").click();
    await shot(ana, "08-new-event");
    await byId(ana, "event-save").click();
    await ana.getByText("Plenária no Derby").first().waitFor();
    await ana.getByText("Up to date").waitFor({ timeout: 15000 });
    await shot(ana, "09-event-list");
  });

  await step("Bia sees the event and volunteers", async () => {
    await bia.reload();
    await bia.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await byId(bia, "self-volunteer").click();
    await bia.getByText("You offered to help").last().waitFor();
    await shot(bia, "10-volunteered");
  });

  await step("Ana confirms Bia", async () => {
    await ana.reload();
    await ana.getByText("Plenária no Derby").first().click({ timeout: 15000 });
    await ana.getByRole("button", { name: "Confirm" }).first().click({ timeout: 15000 });
    await ana.getByText("Confirmed").last().waitFor();
    await shot(ana, "11-confirmed");
  });

  await step("Bia sees she is going", async () => {
    await bia.reload();
    await bia.getByText("You're going").last().waitFor({ timeout: 15000 });
    await shot(bia, "12-going");
  });

  await step("Calendar settings explain what is read and work without any calendar", async () => {
    await bia.goto(appUrl);
    await byId(bia, "go-settings").click();
    await bia.getByText("nothing from your calendar leaves your phone", { exact: false }).waitFor();
    await shot(bia, "13-calendar-settings");
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
  node.kill("SIGINT");
}
process.exit(exitCode);
