// App Store and Play Store screenshots, rendered from the Storybook screen
// stories (real screens, synthetic data) in headless Chromium — no simulator.
//
//   npm run build                      (repo root: workspace packages)
//   npm run store-screenshots -w @vamo-virar/mobile
//
// Output: store-screenshots/<device>/<NN>-<story>.png, at the exact pixel
// sizes each store asks for. Pass story ids as arguments to shoot others.

import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorybook } from "./storybook.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = process.env.STORE_SCREENSHOTS ?? join(root, "store-screenshots");

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

/** In store order. The audience is members, so these are what a member sees. */
const stories = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "telas-comunidade--eventos-como-membro",
      "telas-evento--convite-pendente",
      "telas-evento--voluntariado-aguardando",
      "telas-comunidade--pessoas-como-membro",
      "telas-ajustes--agenda-em-lugares",
      "telas-início--com-comunidades",
    ];

const storybook = await openStorybook();
rmSync(out, { recursive: true, force: true });
let failed = false;
try {
  for (const [device, { width, height, scale }] of Object.entries(devices)) {
    const dir = join(out, device);
    mkdirSync(dir, { recursive: true });
    const page = await storybook.page({ width, height, scale });
    for (const [i, id] of stories.entries()) {
      if (!(await storybook.render(page, id, "frame:bare;scheme:light"))) {
        failed = true;
        continue;
      }
      const file = join(dir, `${String(i + 1).padStart(2, "0")}-${id.split("--")[1]}.png`);
      await page.screenshot({ path: file });
      console.log(`  ✓ ${device} ${width * scale}×${height * scale} ${file.slice(out.length + 1)}`);
    }
    await page.context().close();
  }
} finally {
  await storybook.close();
}
process.exit(failed ? 1 : 0);
