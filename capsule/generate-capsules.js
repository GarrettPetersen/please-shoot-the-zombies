#!/usr/bin/env node
/**
 * Generates all capsule images per CAPSULE_ART_GUIDE.md.
 * - Dark purple gradient background
 * - Female ghoul on the right, pickelhaube zombie behind her
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
const PICKELHAUBE_PATH = path.join(ASSETS, 'pickelhaube_zombie.png');
const LEE_ENFIELD_PATH = path.join(ASSETS, 'lee_enfield_reload-Sheet.png');
const LEE_ENFIELD_FRAME_W = 455;
const LEE_ENFIELD_FRAME_H = 256;

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

// Dark purple gradient (top to bottom)
const GRADIENT_TOP = '#1a0a2e';
const GRADIENT_BOTTOM = '#2d1b4e';

// Text: "Zombies" with 0 (skull) as the second letter
const LINES = ['Please', 'Shoot the', 'Z0mbies'];
const TEXT_COLOR = '#ffffff';
const TARGET_WIDTH_RATIO = 0.58; // fraction of capsule width for text block
const TEXT_LEFT_MARGIN_RATIO = 0.06;
const LINE_SPACING_RATIO = 0.003; // minimal gap so lines are almost touching
const LINE_HEIGHT_RATIO = 1.02; // line height multiplier (tight)
const TEXT_BLOCK_TOP_RATIO = 0.25; // start text block at 25% from top

// Title text rendered with opentype.js from gogozombie.ttf (avoids node-canvas registerFont issues)

function drawGradient(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, GRADIENT_TOP);
  g.addColorStop(1, GRADIENT_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
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
 * Draw character art: female ghoul on the right, pickelhaube over her shoulder (drawn on top so visible).
 * Both at integer scale only (pixel art never stretched).
 */
async function drawCharacters(ctx, w, h, femaleGhoul, pickelhaube) {
  const margin = Math.min(w, h) * 0.05;
  const maxArtW = w * 0.55;
  const maxArtH = h * 0.85;
  const right = w - margin;
  const bottom = h - margin;

  let left = right - maxArtW;
  let top = bottom - maxArtH;
  let artW = maxArtW;
  let artH = maxArtH;

  if (femaleGhoul) {
    const sw = femaleGhoul.width;
    const sh = femaleGhoul.height;
    const scale = integerScale(sw, sh, maxArtW, maxArtH);
    artW = sw * scale;
    artH = sh * scale;
    left = right - artW;
    top = bottom - artH;
    ctx.drawImage(femaleGhoul, 0, 0, sw, sh, Math.round(left), Math.round(top), artW, artH);
  }

  if (pickelhaube) {
    const sw = pickelhaube.width;
    const sh = pickelhaube.height;
    const scale = integerScale(sw, sh, maxArtW * 0.55, maxArtH * 0.55);
    const pw = sw * scale;
    const ph = sh * scale;
    // Over her shoulder: overlap her left side, slightly higher (shoulder height)
    const px = left + artW * 0.15 - pw * 0.4;
    const py = top + artH * 0.12;
    ctx.drawImage(pickelhaube, 0, 0, sw, sh, Math.round(px), Math.round(py), pw, ph);
  }
}

/**
 * Draw Lee Enfield in the bottom right (no rotation). Integer scale only.
 */
function drawRifle(ctx, w, h, rifleImage) {
  if (!rifleImage) return;
  const margin = Math.min(w, h) * 0.04;
  const frameW = rifleImage.width;
  const frameH = rifleImage.height;
  const maxRifleW = w * 0.35;
  const maxRifleH = h * 0.25;
  const scale = integerScale(frameW, frameH, maxRifleW, maxRifleH);
  const drawW = frameW * scale;
  const drawH = frameH * scale;
  const x = w - margin - drawW;
  const y = h - margin - drawH;
  ctx.drawImage(rifleImage, 0, 0, frameW, frameH, Math.round(x), Math.round(y), drawW, drawH);
}

/**
 * Compute font size so that line width (via opentype) equals targetWidth.
 */
function fontSizeForWidth(font, line, targetWidth, maxFontSize = 400) {
  let low = 1;
  let high = maxFontSize;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const w = font.getAdvanceWidth(line, mid);
    if (Math.abs(w - targetWidth) < 1) return mid;
    if (w < targetWidth) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Draw title using opentype.js so gogozombie.ttf is used directly (no node-canvas font loading).
 */
function drawTitle(ctx, w, h, targetWidth, font) {
  if (!font) return;
  const left = w * TEXT_LEFT_MARGIN_RATIO;
  const blockTop = h * TEXT_BLOCK_TOP_RATIO;
  const lineSpacing = h * LINE_SPACING_RATIO;
  const fontSizes = LINES.map((line) => fontSizeForWidth(font, line, targetWidth));

  let lineTop = blockTop;
  ctx.fillStyle = TEXT_COLOR;

  const unitsPerEm = font.unitsPerEm || 1000;
  const ascender = font.ascender != null ? font.ascender : 800;

  LINES.forEach((line, i) => {
    const fontSize = fontSizes[i];
    const baseline = lineTop + (ascender / unitsPerEm) * fontSize;
    const path = font.getPath(line, left, baseline, fontSize);
    ctx.fillStyle = TEXT_COLOR;
    path.draw(ctx);
    lineTop += fontSize * LINE_HEIGHT_RATIO + lineSpacing;
  });
}

async function generateOne(name, width, height, filenameBase, femaleGhoul, pickelhaube, rifleImage, font) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  drawGradient(ctx, width, height);
  await drawCharacters(ctx, width, height, femaleGhoul, pickelhaube);
  drawRifle(ctx, width, height, rifleImage);

  const targetWidth = width * TARGET_WIDTH_RATIO;
  drawTitle(ctx, width, height, targetWidth, font);

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
  let pickelhaube = null;
  if (fs.existsSync(FEMALE_GHOUL_PATH)) {
    femaleGhoul = await loadImage(FEMALE_GHOUL_PATH);
  } else {
    console.warn(`Missing ${FEMALE_GHOUL_PATH}, skipping female ghoul`);
  }
  if (fs.existsSync(PICKELHAUBE_PATH)) {
    pickelhaube = await loadImage(PICKELHAUBE_PATH);
  } else {
    console.warn(`Missing ${PICKELHAUBE_PATH}, skipping pickelhaube zombie`);
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

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [name, w, h, base] of CAPSULES) {
    await generateOne(name, w, h, base, femaleGhoul, pickelhaube, rifleImage, font);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
