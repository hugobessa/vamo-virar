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

/**
 * CSS viewport × scale = the pixel size the store wants. Apple's sizes follow
 * App Store Connect's screenshot specifications, one per display class; the
 * viewport is the device's size in points where Apple ships one.
 */
const devices = {
  // App Store, iPhone. Only "Dynamic Island (medium)" is required; Apple scales the rest from the next size up.
  "ios-iphone-duo-outer": { width: 466, height: 678, scale: 3 }, // 1398×2034
  "ios-iphone-duo-inner": { width: 669, height: 951, scale: 3 }, // 2007×2853
  "ios-iphone-6.9-dynamic-island-large": { width: 440, height: 956, scale: 3 }, // 1320×2868
  "ios-iphone-6.5-face-id-large": { width: 428, height: 926, scale: 3 }, // 1284×2778
  "ios-iphone-6.3-dynamic-island-medium": { width: 402, height: 874, scale: 3 }, // 1206×2622
  "ios-iphone-6.1-face-id-medium": { width: 390, height: 844, scale: 3 }, // 1170×2532
  "ios-iphone-5.5-home-button-large": { width: 414, height: 736, scale: 3 }, // 1242×2208
  "ios-iphone-4.7-home-button-medium": { width: 375, height: 667, scale: 2 }, // 750×1334
  "ios-iphone-4.0-home-button": { width: 320, height: 568, scale: 2 }, // 640×1136
  "ios-iphone-3.5-home-button": { width: 320, height: 480, scale: 2 }, // 640×960
  // App Store, iPad. 13" is required because the app sets supportsTablet.
  "ios-ipad-13": { width: 1032, height: 1376, scale: 2 }, // 2064×2752
  "ios-ipad-12.9": { width: 1024, height: 1366, scale: 2 }, // 2048×2732
  "ios-ipad-11": { width: 834, height: 1194, scale: 2 }, // 1668×2388
  "ios-ipad-10.5": { width: 834, height: 1112, scale: 2 }, // 1668×2224
  "ios-ipad-9.7": { width: 768, height: 1024, scale: 2 }, // 1536×2048
  // Play Store: phone (9:16), 7" and 10" tablets.
  "android-phone": { width: 432, height: 768, scale: 2.5 }, // 1080×1920
  "android-tablet-7": { width: 600, height: 960, scale: 2 }, // 1200×1920
  "android-tablet-10": { width: 800, height: 1280, scale: 2 }, // 1600×2560
};

/** In store order: the story that sells the app first. */
const stories = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "telas-início--boas-vindas",
      "telas-comunidade--eventos-como-admin",
      "telas-evento--convite-pendente",
      "telas-evento--organizacao-vendo-respostas",
      "telas-comunidade--pessoas-como-moderacao",
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
rmSync(out, { recursive: true, force: true });
let failed = false;
try {
  for (const [device, { width, height, scale }] of Object.entries(devices)) {
    const dir = join(out, device);
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
