// Development-only tool: provide Sharp 0.35.4 via NODE_PATH or your tool environment.
// The app consumes the checked-in PNGs; Sharp is not an application dependency.
/* global __dirname */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const brandRoot = path.resolve(__dirname, '../assets/brand');
const outputRoot = path.join(brandRoot, 'derived');
const entries = [];
const canvas = { light: '#F3F5F2', dark: '#131918' };
const hash = (data) => createHash('sha256').update(data).digest('hex');

async function writeAsset(file, source, transform, render) {
  const original = await fs.readFile(path.join(brandRoot, source));
  const png = await render(sharp(original)).png().toBuffer();
  const metadata = await sharp(png).metadata();
  const target = path.join(outputRoot, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, png);
  entries.push({
    file,
    source,
    sourceSha256: hash(original),
    transform,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha,
    sha256: hash(png),
  });
  return png;
}

async function assertInsideCircle(png, radius) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 0) {
        assert(Math.hypot(x + 0.5 - info.width / 2, y + 0.5 - info.height / 2) <= radius,
          'The character extends outside the platform safe zone.');
      }
    }
  }
}

async function main() {
  for (const theme of ['light', 'dark']) {
    await writeAsset(
      `icons/app-icon-${theme}.png`,
      `approved/icons/icon-square-${theme}.png`,
      `Preserve the full 1024×1024 square composition; flatten onto ${canvas[theme]} and remove the alpha channel for iOS. No baked-in corner mask.`,
      (image) => image.flatten({ background: canvas[theme] }).removeAlpha(),
    );
    const splash = await writeAsset(
      `splash/splash-${theme}.png`,
      `approved/brand/mark-${theme}.svg`,
      'Rasterize the original 1024×1024 SVG canvas to a transparent PNG. Keep the original paths, colors, placement, and cutouts. Expo displays the canvas at 180 points/dp with contain scaling.',
      (image) => image.resize(1024, 1024),
    );
    // Expo SDK 57 centers this image in a 288 dp canvas. Its 192 dp safe circle
    // becomes a radius of (96 / 180) * 1024 pixels in the source image.
    await assertInsideCircle(splash, (96 / 180) * 1024);
  }

  const adaptive = await writeAsset(
    'android/adaptive-foreground.png',
    'approved/brand/mark-dark.svg',
    'Scale the entire SVG canvas uniformly to 780×780, then pad 150 transparent pixels on every side to 1080×1080. The artwork fits inside the central 660 px circle (66 dp of a 108 dp layer). Used unchanged for both foregroundImage and monochromeImage; Android uses its alpha mask for themed icons. The solid background is #131918 in app.json.',
    (image) => image.resize(780, 780).extend({
      top: 150, bottom: 150, left: 150, right: 150,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }),
  );
  await assertInsideCircle(adaptive, 330);

  await writeAsset(
    'web/favicon.png',
    'approved/icons/icon-square-dark.png',
    'Resize the full-square master to 64×64 for the existing Expo web favicon, flatten onto #131918, and remove alpha.',
    (image) => image.resize(64, 64).flatten({ background: canvas.dark }).removeAlpha(),
  );

  await fs.writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify({
    generator: 'apps/mobile/scripts/generate-brand-assets.cjs',
    sharpVersion: sharp.versions.sharp,
    sourceBase: 'apps/mobile/assets/brand',
    files: entries,
  }, null, 2)}\n`);
  console.log(`Generated ${entries.length} PNGs and their provenance manifest.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
