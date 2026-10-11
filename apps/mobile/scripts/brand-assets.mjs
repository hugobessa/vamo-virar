// App icon, splash, Play Store feature graphic and App Store promotional art, rendered from the
// "Marca/Ícone, abertura e destaque" stories in headless Chromium and written to assets/ (wired up in app.json).
//
//   npm run build                      (repo root: workspace packages)
//   npm run brand-assets -w @vamo-virar/mobile

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openStorybook } from "./storybook.mjs";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const S = 1024;

/** file → story, output size, whether transparency is kept, then height and pixel ratio for non-square art. */
const outputs = [
  // iOS (and the App Store listing): square, opaque; the OS rounds the corners.
  // No dark or tinted variants: the icon stays red in every appearance.
  ["icon.png", "icone", S, false],
  // Android adaptive icon layers; the background is a colour in app.json.
  ["android-icon-foreground.png", "android-frente", S, true],
  ["android-icon-monochrome.png", "android-monocromatico", S, true],
  // Play Store listing icon: 512×512, Google applies the mask.
  ["play-store-icon.png", "icone", 512, false],
  ["favicon.png", "icone", 48, false],
  ["splash-icon.png", "abertura", S, true],
  // Play Store listing banner: 1024×500, opaque.
  ["play-feature-graphic.png", "destaque-play-store", 1024, false, 500],
  // App Store promotional art. 5244×2950 serves both the header and search results.
  ["app-store-promo-5244x2950.png", "promocional-app-store", 5244, false, 2950],
  ["app-store-header-3840x1646.png", "promocional-app-store-largo", 3840, false, 1646],
  ["app-store-search-3840x2560.png", "promocional-app-store-3-x-2", 1920, false, 1280, 2],
  ["app-store-search-1920x1280.png", "promocional-app-store-3-x-2", 1920, false, 1280],
];

const storybook = await openStorybook();
let failed = false;
try {
  for (const [file, story, size, transparent, height, ratio = 1] of outputs) {
    // Square artboards are 1024 wide and scaled by the pixel ratio to the size wanted.
    const [w, h, scale] = height ? [size, height, ratio] : [S, S, size / S];
    const page = await storybook.page({ width: w, height: h, scale });
    if (!(await storybook.render(page, `marca-ícone-abertura-e-destaque--${story}`))) {
      failed = true;
    } else {
      await page.screenshot({ path: join(assets, file), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
      console.log(`  ✓ ${w * scale}×${h * scale} assets/${file}`);
    }
    await page.context().close();
  }
} finally {
  await storybook.close();
}
process.exit(failed ? 1 : 0);
