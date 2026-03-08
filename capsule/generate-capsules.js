#!/usr/bin/env node
/**
 * Generates all capsule images per CAPSULE_ART_GUIDE.md.
 * - Spooky forest background (tiled horizontally if not wide enough)
 * - Female ghoul on the right, gas mask zombie behind her
 * - Lee Enfield rifle in the bottom right, aiming at the zombies
 * - Gogozombie font (white): "Please", "Shoot the", "Z0mbies" (0 = skull, second letter)
 * - Font sizes adjusted so all three lines have the same width
 * English only for now.
 */

const { createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const opentype = require('opentype.js');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const OUT_DIR = path.join(ROOT, 'capsule');
const FONT_PATH = path.resolve(ROOT, 'assets', 'font', 'gogozombie.ttf');
const FEMALE_GHOUL_PATH = path.join(ASSETS, 'female_ghoul_in_nightgown.png');
const GAS_MASK_PATH = path.join(ASSETS, 'gas_mask_zombie.png');
const LEE_ENFIELD_PATH = path.join(ASSETS, 'lee_enfield_reload-Sheet.png');
const LEE_ENFIELD_FRAME_W = 455;
const LEE_ENFIELD_FRAME_H = 256;
const BACKGROUND_PATH = path.join(ASSETS, 'backgrounds', 'spooky_forest.png');

// Capsule definitions: [name, width, height, filename base]
const CAPSULES = [
  ['header', 920, 430, 'header'],
  ['small', 462, 174, 'small'],
  ['main', 1232, 706, 'main'],
  ['vertical', 748, 896, 'vertical'],
  ['library_capsule', 600, 900, 'library_capsule'],
  ['library_header', 920, 430, 'library_header'],
  ['library_hero', 3840, 1240, 'library_hero'],
];

// Text: "Zombies" with 0 (skull) as the second letter
const LINES = ['Please', 'Shoot the', 'Z0mbies'];
const TEXT_COLOR = '#ffffff';
// Title box: wide capsule = most of height, equidistant from left two corners (vert centered left).
//            tall capsule = most of width, equidistant from top two corners (horiz centered top).
const TITLE_MARGIN_RATIO = 0.05; // inset from edges
const TITLE_USE_DIMENSION_RATIO = 0.88; // use 88% of the "main" dimension (height if wide, width if tall)
const LINE_HEIGHT_RATIO = 0.82; // tight line height (lines almost touching)
const LINE_SPACING_PX = 0; // no extra gap between lines
const MAX_FONT_SIZE = 1200; // cap so binary search doesn't blow up on library hero

// Character block is to the right of the text (no overlap)
const ART_LEFT_RATIO = 0.50; // character block starts here (text must end before this)
const ART_HEIGHT_RATIO = 0.94; // character block height for scale
const TEXT_GAP_RATIO = 0.02; // gap between text right edge and character left

// Title text rendered with opentype.js from gogozombie.ttf (avoids node-canvas registerFont issues)

/**
 * Draw background: spooky_forest.png scaled to canvas height, tiled horizontally if not wide enough.
 */
function drawBackground(ctx, w, h, bgImage) {
  if (!bgImage) {
    ctx.fillStyle = '#1a0a2e';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const iw = bgImage.width;
  const ih = bgImage.height;
  if (iw <= 0 || ih <= 0) return;
  const scale = h / ih;
  const drawW = iw * scale;
  const drawH = h;
  for (let x = 0; x < w; x += drawW) {
    ctx.drawImage(bgImage, 0, 0, iw, ih, x, 0, drawW, drawH);
  }
}

/**
 * Integer scale for pixel art (1:1 pixels, no stretch). Returns scale so image fits in maxW×maxH.
 */
function integerScale(srcW, srcH, maxW, maxH) {
  if (srcW <= 0 || srcH <= 0) return 1;
  const scale = Math.floor(Math.min(maxW / srcW, maxH / srcH));
  return Math.max(1, scale);
}

/**
 * Draw character art: gas mask behind, female ghoul on the right (on top).
 * Block is to the right of text (ART_LEFT_RATIO); top-anchored; feet extend below.
 */
async function drawCharacters(ctx, w, h, femaleGhoul, gasMask, artScale) {
  const margin = Math.min(w, h) * 0.05;
  const left = w * ART_LEFT_RATIO;
  const right = w - margin;
  const maxArtW = right - left;
  const topAnchor = 0;

  const swG = femaleGhoul ? femaleGhoul.width : 0;
  const shG = femaleGhoul ? femaleGhoul.height : 0;
  const swM = gasMask ? gasMask.width : 0;
  const shM = gasMask ? gasMask.height : 0;
  const scale = artScale;

  if (gasMask && scale >= 1) {
    const pw = swM * scale;
    const ph = shM * scale;
    const px = left + (maxArtW - pw) * 0.3;
    ctx.drawImage(gasMask, 0, 0, swM, shM, Math.round(px), Math.round(topAnchor), pw, ph);
  }

  if (femaleGhoul && scale >= 1) {
    const artW = swG * scale;
    const artH = shG * scale;
    const ghoulLeft = right - artW;
    ctx.drawImage(femaleGhoul, 0, 0, swG, shG, Math.round(ghoulLeft), Math.round(topAnchor), artW, artH);
  }
}

/**
 * Draw Lee Enfield flush in the bottom right corner. Uses same integer scale as zombies (artScale).
 */
function drawRifle(ctx, w, h, rifleImage, artScale) {
  if (!rifleImage || !artScale) return;
  const frameW = rifleImage.width;
  const frameH = rifleImage.height;
  const drawW = frameW * artScale;
  const drawH = frameH * artScale;
  const x = w - drawW;
  const y = h - drawH;
  ctx.drawImage(rifleImage, 0, 0, frameW, frameH, Math.round(x), Math.round(y), drawW, drawH);
}

/**
 * Compute font size so that line width (via opentype) equals targetWidth.
 */
function fontSizeForWidth(font, line, targetWidth, maxFontSize = MAX_FONT_SIZE) {
  let low = 1;
  let high = maxFontSize;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const width = font.getAdvanceWidth(line, mid);
    if (Math.abs(width - targetWidth) < 0.5) return mid;
    if (width < targetWidth) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Draw title so it fits inside the title box. White text.
 * Wide capsule: most of height, equidistant from top-left and bottom-left (vertically centered on left).
 * Tall capsule: most of width, equidistant from top-left and top-right (horizontally centered at top).
 */
function drawTitle(ctx, w, h, font) {
  if (!font) return;
  const margin = Math.min(w, h) * TITLE_MARGIN_RATIO;
  const isWide = w >= h;

  let boxLeft, boxTop, boxWidth, boxHeight;
  if (isWide) {
    // Text stays left of character block (zombies to the right)
    boxHeight = h * TITLE_USE_DIMENSION_RATIO;
    boxTop = (h - boxHeight) / 2;
    boxLeft = margin;
    boxWidth = Math.min(w * 0.48, w * ART_LEFT_RATIO - margin - w * TEXT_GAP_RATIO);
  } else {
    // Text stays left of character block (zombies to the right)
    boxTop = margin;
    boxHeight = h * 0.38;
    boxLeft = margin;
    boxWidth = Math.min(w * TITLE_USE_DIMENSION_RATIO, w * ART_LEFT_RATIO - margin - w * TEXT_GAP_RATIO);
  }

  const unitsPerEm = font.unitsPerEm || 1000;
  const ascender = font.ascender != null ? font.ascender : 800;

  // Use a target width all three lines can achieve (cap by max font size so library hero stays consistent)
  const maxWidthAtCap = Math.min(...LINES.map((line) => font.getAdvanceWidth(line, MAX_FONT_SIZE)));
  const targetWidth = Math.min(boxWidth, maxWidthAtCap);
  let fontSizes = LINES.map((line) => fontSizeForWidth(font, line, targetWidth));

  let totalHeight = 0;
  fontSizes.forEach((fs, i) => {
    totalHeight += fs * LINE_HEIGHT_RATIO + (i < LINES.length - 1 ? LINE_SPACING_PX : 0);
  });

  if (totalHeight > boxHeight && totalHeight > 0) {
    const scale = boxHeight / totalHeight;
    fontSizes = fontSizes.map((fs) => fs * scale);
    totalHeight = boxHeight;
  }

  // Vertically center the block within the box
  let lineTop = boxTop + (boxHeight - totalHeight) / 2;
  const white = '#ffffff';
  ctx.fillStyle = white;

  LINES.forEach((line, i) => {
    const fontSize = fontSizes[i];
    const baseline = lineTop + (ascender / unitsPerEm) * fontSize;
    const path = font.getPath(line, boxLeft, baseline, fontSize);
    if (path.fill !== undefined) path.fill = white;
    ctx.fillStyle = white;
    path.draw(ctx);
    lineTop += fontSize * LINE_HEIGHT_RATIO + LINE_SPACING_PX;
  });
}

async function generateOne(name, width, height, filenameBase, femaleGhoul, gasMask, rifleImage, backgroundImage, font) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = false;

  drawBackground(ctx, width, height, backgroundImage);

  const margin = Math.min(width, height) * 0.05;
  const maxArtW = (width - margin) - width * ART_LEFT_RATIO;
  const maxArtH = height * ART_HEIGHT_RATIO;
  const maxSw = Math.max(femaleGhoul?.width ?? 0, gasMask?.width ?? 0) || 1;
  const maxSh = Math.max(femaleGhoul?.height ?? 0, gasMask?.height ?? 0) || 1;
  let artScale = integerScale(maxSw, maxSh, maxArtW, maxArtH * 1.15);
  if (name !== 'small') artScale *= 2;

  await drawCharacters(ctx, width, height, femaleGhoul, gasMask, artScale);
  drawRifle(ctx, width, height, rifleImage, artScale);

  drawTitle(ctx, width, height, font);

  const outPath = path.join(OUT_DIR, `${filenameBase}_english.png`);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath}`);
}

async function main() {
  if (!fs.existsSync(FONT_PATH)) {
    throw new Error(`Font not found: ${FONT_PATH}`);
  }
  const font = await new Promise((resolve, reject) => {
    opentype.load(FONT_PATH, (err, f) => (err ? reject(err) : resolve(f)));
  });

  let femaleGhoul = null;
  let gasMask = null;
  if (fs.existsSync(FEMALE_GHOUL_PATH)) {
    femaleGhoul = await loadImage(FEMALE_GHOUL_PATH);
  } else {
    console.warn(`Missing ${FEMALE_GHOUL_PATH}, skipping female ghoul`);
  }
  if (fs.existsSync(GAS_MASK_PATH)) {
    gasMask = await loadImage(GAS_MASK_PATH);
  } else {
    console.warn(`Missing ${GAS_MASK_PATH}, skipping gas mask zombie`);
  }

  let rifleImage = null;
  if (fs.existsSync(LEE_ENFIELD_PATH)) {
    const firstFrameBuffer = await sharp(LEE_ENFIELD_PATH)
      .extract({ left: 0, top: 0, width: LEE_ENFIELD_FRAME_W, height: LEE_ENFIELD_FRAME_H })
      .png()
      .toBuffer();
    rifleImage = await loadImage(firstFrameBuffer);
  } else {
    console.warn(`Missing ${LEE_ENFIELD_PATH}, skipping Lee Enfield`);
  }

  let backgroundImage = null;
  if (fs.existsSync(BACKGROUND_PATH)) {
    backgroundImage = await loadImage(BACKGROUND_PATH);
  } else {
    console.warn(`Missing ${BACKGROUND_PATH}, using fallback fill`);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, w, h, base] of CAPSULES) {
    await generateOne(name, w, h, base, femaleGhoul, gasMask, rifleImage, backgroundImage, font);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
