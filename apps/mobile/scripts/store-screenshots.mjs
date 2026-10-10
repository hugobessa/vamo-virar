// App Store and Play Store screenshots, rendered from the Storybook screen
// stories (real screens, synthetic data) in headless Chromium — no simulator.
//
//   npm run build                      (repo root: workspace packages)
//   npm run store-screenshots -w @vamo-virar/mobile
//
// Output: store-screenshots/<device>/<NN>-<story>.png, at the exact pixel
// sizes each store asks for. Pass story ids as arguments to shoot others.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist-storybook");
const out = process.env.STORE_SCREENSHOTS ?? join(root, "store-screenshots");
const chromePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";

/** CSS viewport × scale = the pixel size the store wants. */
const devices = {
  // App Store: 6.9" iPhone (1320×2868) is the one required size; smaller iPhones are scaled from it.
  "ios-iphone-6.9": { width: 440, height: 956, scale: 3 },
  // App Store: 13" iPad (2064×2752), required because the app sets supportsTablet.
  "ios-ipad-13": { width: 1032, height: 1376, scale: 2 },
  // Play Store: phone, 9:16 at 1080×1920.
  "android-phone": { width: 432, height: 768, scale: 2.5 },
  // Play Store: 10" tablet, 1600×2560.
  "android-tablet-10": { width: 800, height: 1280, scale: 2 },
};

/** In store order: the story that sells the app first. */
const stories = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "telas-início--boas-vindas",
      "telas-comunidade--eventos-como-admin",
      "telas-evento--convite-pendente",
      "telas-evento--organizacao-vendo-respostas",
      "telas-comunidade--pessoas-como-admin",
      "telas-evento--concluido-registrando-presenca",
      "telas-ajustes--agenda-em-lugares",
      "telas-comunidade--sem-conexao",
    ];

if (!existsSync(join(dist, "iframe.html"))) {
  console.error("dist-storybook missing; run `npm run build-storybook` first");
  process.exit(1);
}

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(dist, path === "/" ? "index.html" : path);
  if (!file.startsWith(dist) || !existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: chromePath,
  // Web fonts come through the HTTPS proxy, if any; Chromium skips it for loopback on its own.
  args: process.env.HTTPS_PROXY ? [`--proxy-server=${process.env.HTTPS_PROXY}`] : [],
});
let failed = false;
try {
  for (const [device, { width, height, scale }] of Object.entries(devices)) {
    const dir = join(out, device);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    for (const [i, id] of stories.entries()) {
      await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=frame:bare;scheme:light`);
      // Rendered, play function done (tabs clicked), fonts in.
      await page.waitForFunction(
        () => document.body.classList.contains("sb-show-errordisplay") || (document.body.classList.contains("sb-show-main") && document.querySelector("#storybook-root")?.childElementCount),
        null,
        { timeout: 30_000 },
      );
      await page.waitForLoadState("networkidle");
      await page.waitForFunction(() => document.fonts.status === "loaded");
      await page.waitForTimeout(800);
      if (!(await page.evaluate(() => document.fonts.check('900 16px "Archivo"')))) {
        console.warn(`  ! web fonts did not load for ${id}; falling back to system fonts`);
      }
      if (await page.evaluate(() => document.body.classList.contains("sb-show-errordisplay"))) {
        console.error(`  ✗ ${id}: story errored`);
        failed = true;
        continue;
      }
      const file = join(dir, `${String(i + 1).padStart(2, "0")}-${id.split("--")[1]}.png`);
      await page.screenshot({ path: file });
      console.log(`  ✓ ${device} ${width * scale}×${height * scale} ${file.slice(out.length + 1)}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
