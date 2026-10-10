// Serves the built Storybook (dist-storybook) and renders stories in headless
// Chromium, for the scripts that turn stories into image files.

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist-storybook");
const chromePath = process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

export async function openStorybook() {
  if (!existsSync(join(dist, "iframe.html"))) {
    console.error("dist-storybook missing; run `npm run build-storybook` first");
    process.exit(1);
  }
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

  return {
    /** A page with this viewport and pixel ratio. */
    async page({ width, height, scale = 1 }) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, ignoreHTTPSErrors: true });
      return context.newPage();
    },
    /** Opens a story and waits for it, its play function and its fonts. False if the story errored. */
    async render(page, id, globals = "scheme:light") {
      await page.goto(`${base}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=${globals}`);
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
        return false;
      }
      return true;
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}
