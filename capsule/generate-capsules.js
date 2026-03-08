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

// Capsule definitions: [name, width, height, filename base, options?]
// options: { noText } = artwork only (no title); { titleOnly } = logo/title only (e.g. library logo overlay)
const CAPSULES = [
  ['header', 920, 430, 'header'],
  ['small', 462, 174, 'small'],
  ['main', 1232, 706, 'main'],
  ['vertical', 748, 896, 'vertical'],
  ['library_capsule', 600, 900, 'library_capsule'],
  ['library_header', 920, 430, 'library_header'],
  ['library_hero', 3840, 1240, 'library_hero', { noText: true }], // Steam: artwork only (no logo)
  ['page_background', 1438, 810, 'page_background', { noText: true }], // optional; subtle background
  ['library_logo', 1280, 720, 'library_logo', { titleOnly: true }], // overlay on library hero
];
// Icons: background + female ghoul centered only (no text, no rifle). [filename base, size, ext]
const ICONS = [
  ['shortcut_icon', 256, 'png'],
  ['app_icon', 184, 'jpg'],
];
const ICON_GHOUL_HEIGHT_RATIO = 2;

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
 * If dim is 0..1, fill with semi-transparent dark overlay to make it subtler (e.g. page background).
 */
function drawBackground(ctx, w, h, bgImage, dim = 0) {
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
  if (dim > 0) {
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, w, h);
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
 * opts: { shiftGhoulLeft, shiftGhoulRight, shiftZombieRight, shiftZombieLeft, anchorBottom, anchorFractionBelow, artScaleMultiplier, zombieCenterFactor, characterShiftDown } for per-capsule layout.
 */
async function drawCharacters(ctx, w, h, femaleGhoul, gasMask, artScale, opts = {}) {
  const margin = Math.min(w, h) * 0.05;
  const left = w * ART_LEFT_RATIO;
  const right = w - margin;
  const maxArtW = right - left;
  const shiftGhoulLeft = opts.shiftGhoulLeft ?? 0;
  const shiftGhoulRight = opts.shiftGhoulRight ?? 0;
  const shiftZombieRight = opts.shiftZombieRight ?? 0;
  const shiftZombieLeft = opts.shiftZombieLeft ?? 0;
  const anchorBottom = opts.anchorBottom ?? false;
  const anchorFractionBelow = opts.anchorFractionBelow ?? 0.5;
  const scale = artScale * (opts.artScaleMultiplier ?? 1);
  // gas mask default position factor (0.3 = 30% from left of art block); lower = closer to center
  const zombieCenterFactor = opts.zombieCenterFactor ?? 0.3;

  const swG = femaleGhoul ? femaleGhoul.width : 0;
  const shG = femaleGhoul ? femaleGhoul.height : 0;
  const swM = gasMask ? gasMask.width : 0;
  const shM = gasMask ? gasMask.height : 0;

  const pw = gasMask && scale >= 1 ? swM * scale : 0;
  const ph = gasMask && scale >= 1 ? shM * scale : 0;
  const artW = femaleGhoul && scale >= 1 ? swG * scale : 0;
  const artH = femaleGhoul && scale >= 1 ? shG * scale : 0;
  const maxH = Math.max(ph, artH);
  const characterShiftDown = opts.characterShiftDown ?? 0;
  const topAnchor = (anchorBottom ? h - maxH * (1 - anchorFractionBelow) : 0) + characterShiftDown;

  if (gasMask && scale >= 1) {
    const px = left + (maxArtW - pw) * zombieCenterFactor + shiftZombieRight - shiftZombieLeft;
    ctx.drawImage(gasMask, 0, 0, swM, shM, Math.round(px), Math.round(topAnchor), pw, ph);
  }

  if (femaleGhoul && scale >= 1) {
    const ghoulLeft = right - artW - shiftGhoulLeft + shiftGhoulRight;
    ctx.drawImage(femaleGhoul, 0, 0, swG, shG, Math.round(ghoulLeft), Math.round(topAnchor), artW, artH);
  }
}

/**
 * Draw Lee Enfield in the bottom right. Scale = artScale * rifleScaleMultiplier.
 * rifleShiftRight shifts gun right (pixels). rifleShiftDown shifts gun down (pixels).
 */
function drawRifle(ctx, w, h, rifleImage, artScale, rifleScaleMultiplier = 1, rifleShiftRight = 0, rifleShiftDown = 0) {
  if (!rifleImage || !artScale) return;
  const frameW = rifleImage.width;
  const frameH = rifleImage.height;
  const scale = artScale * rifleScaleMultiplier;
  const drawW = frameW * scale;
  const drawH = frameH * scale;
  const x = w - drawW + rifleShiftRight;
  const y = h - drawH + rifleShiftDown;
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
 * If centerBox is true (e.g. library logo), use a centered box over most of the canvas.
 * If fullWidthTitle is true (e.g. library_capsule, vertical), use full horizontal space with consistent margins.
 * If titleBoxHalfHeight is true (vertical capsules), title box is half canvas height and text is centered horizontally.
 */
function drawTitle(ctx, w, h, font, centerBox = false, fullWidthTitle = false, titleBoxHalfHeight = false, centerHorizontally = false) {
  if (!font) return;
  const margin = Math.min(w, h) * TITLE_MARGIN_RATIO;
  const isWide = w >= h;

  let boxLeft, boxTop, boxWidth, boxHeight;
  if (centerBox) {
    boxWidth = w * 0.9;
    boxHeight = h * 0.7;
    boxLeft = (w - boxWidth) / 2;
    boxTop = (h - boxHeight) / 2;
  } else if (isWide) {
    boxHeight = h * TITLE_USE_DIMENSION_RATIO;
    boxTop = (h - boxHeight) / 2;
    boxLeft = margin;
    boxWidth = Math.min(w * 0.48, w * ART_LEFT_RATIO - margin - w * TEXT_GAP_RATIO);
  } else {
    boxTop = margin;
    // Tall + fullWidthTitle: half height when titleBoxHalfHeight, else most of height.
    boxHeight = fullWidthTitle ? (titleBoxHalfHeight ? h * 0.5 : h * TITLE_USE_DIMENSION_RATIO) : h * 0.38;
    boxLeft = margin;
    boxWidth = fullWidthTitle ? w - 2 * margin : Math.min(w * TITLE_USE_DIMENSION_RATIO, w * ART_LEFT_RATIO - margin - w * TEXT_GAP_RATIO);
  }

  const unitsPerEm = font.unitsPerEm || 1000;
  const ascender = font.ascender != null ? font.ascender : 800;

  const maxWidthAtCap = Math.min(...LINES.map((line) => font.getAdvanceWidth(line, MAX_FONT_SIZE)));
  let targetWidth = Math.min(boxWidth, maxWidthAtCap);

  // Find largest targetWidth so totalHeight <= boxHeight (fill the box; no scale-down).
  if (!centerBox) {
    let low = 1;
    let high = Math.min(boxWidth, maxWidthAtCap);
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      const sizes = LINES.map((line) => fontSizeForWidth(font, line, mid));
      let th = 0;
      sizes.forEach((fs, idx) => {
        th += fs * LINE_HEIGHT_RATIO + (idx < LINES.length - 1 ? LINE_SPACING_PX : 0);
      });
      if (th <= boxHeight) low = mid;
      else high = mid;
    }
    targetWidth = (low + high) / 2;
  }

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

  let lineTop = boxTop + (boxHeight - totalHeight) / 2;
  const white = '#ffffff';
  ctx.fillStyle = white;

  LINES.forEach((line, i) => {
    const fontSize = fontSizes[i];
    const baseline = lineTop + (ascender / unitsPerEm) * fontSize;
    const lineWidth = font.getAdvanceWidth(line, fontSize);
    const x = centerHorizontally ? boxLeft + (boxWidth - lineWidth) / 2 : boxLeft;
    const path = font.getPath(line, x, baseline, fontSize);
    if (path.fill !== undefined) path.fill = white;
    ctx.fillStyle = white;
    path.draw(ctx);
    lineTop += fontSize * LINE_HEIGHT_RATIO + LINE_SPACING_PX;
  });
}

async function generateOne(name, width, height, filenameBase, femaleGhoul, gasMask, rifleImage, backgroundImage, font, options = {}) {
  const { noText = false, titleOnly = false } = options;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = false;

  if (titleOnly) {
    // Library logo: title only on transparent background (overlays on hero)
    drawTitle(ctx, width, height, font, true);
  } else if (name === 'page_background') {
    drawBackground(ctx, width, height, backgroundImage, 0);
  } else {
    drawBackground(ctx, width, height, backgroundImage, 0);
    const margin = Math.min(width, height) * 0.05;
    const maxArtW = (width - margin) - width * ART_LEFT_RATIO;
    const maxArtH = height * ART_HEIGHT_RATIO;
    const maxSw = Math.max(femaleGhoul?.width ?? 0, gasMask?.width ?? 0) || 1;
    const maxSh = Math.max(femaleGhoul?.height ?? 0, gasMask?.height ?? 0) || 1;
    let artScale = integerScale(maxSw, maxSh, maxArtW, maxArtH * 1.15);
    if (name !== 'small') artScale *= 2;

    const shift = width / 5;
    const w8 = width / 8;
    const w6 = width / 6;
    const w4 = width / 4;
    const w16 = width / 16;
    const h20 = height / 20;
    const charOpts = {};
    let rifleShiftRight = 0;
    let rifleShiftDown = 0;

    if (name === 'header' || name === 'library_header') {
      charOpts.shiftGhoulLeft = shift;
      charOpts.shiftZombieRight = shift;
      charOpts.shiftGhoulRight = w8;
      rifleShiftRight = w8;
      rifleShiftDown = name === 'library_header' ? height / 12 : h20;
    } else if (name === 'library_capsule' || name === 'vertical') {
      charOpts.anchorBottom = true;
      charOpts.anchorFractionBelow = 0.5;
      charOpts.artScaleMultiplier = 2;
      charOpts.zombieCenterFactor = 0.5;
      charOpts.characterShiftDown = h20;
      charOpts.shiftGhoulRight = w6;
      rifleShiftDown = h20;
      rifleShiftRight = w6;
    } else if (name === 'library_hero') {
      charOpts.shiftGhoulLeft = shift + w16;
      charOpts.shiftZombieRight = shift;
      charOpts.shiftGhoulRight = w4;
      rifleShiftDown = h20;
    } else if (name === 'main') {
      charOpts.shiftGhoulRight = w8 + w16 + w16;
      charOpts.shiftZombieRight = w8 + w16;
      rifleShiftRight = w8;
    } else if (name === 'small') {
      charOpts.shiftGhoulLeft = width * 0.36;
      charOpts.shiftGhoulRight = width / 3;
      charOpts.shiftZombieRight = width * 0.45;
    }

    const rifleMultiplier = (name === 'main' || name === 'library_hero' || name === 'small') ? 0.5 : 1;

    await drawCharacters(ctx, width, height, femaleGhoul, null, artScale, charOpts);
    drawRifle(ctx, width, height, rifleImage, artScale, rifleMultiplier, rifleShiftRight, rifleShiftDown);

    const isVerticalCapsule = name === 'library_capsule' || name === 'vertical';
    const fullWidthTitle = isVerticalCapsule;
    const titleBoxHalfHeight = isVerticalCapsule;
    const centerHorizontally = isVerticalCapsule;
    if (!noText) drawTitle(ctx, width, height, font, false, fullWidthTitle, titleBoxHalfHeight, centerHorizontally);
  }

  const outPath = path.join(OUT_DIR, `${filenameBase}_english.png`);
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath}`);
}

/**
 * Generate app/shortcut icon: spooky forest background + female ghoul centered. No text or other sprites.
 */
async function generateIcon(size, filenameBase, ext, femaleGhoul, backgroundImage) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  drawBackground(ctx, size, size, backgroundImage, 0);

  if (femaleGhoul) {
    const maxH = size * ICON_GHOUL_HEIGHT_RATIO;
    const sw = femaleGhoul.width;
    const sh = femaleGhoul.height;
    const scale = maxH / sh; // scale by height only so she reaches portrait size (may overflow sides)
    const drawW = sw * scale;
    const drawH = sh * scale;
    const x = (size - drawW) / 2;
    const y = 0; // top-aligned so face is at top of icon
    ctx.drawImage(femaleGhoul, 0, 0, sw, sh, Math.round(x), Math.round(y), drawW, drawH);
  }

  const outPath = path.join(OUT_DIR, `${filenameBase}_english.${ext}`);
  if (ext === 'jpg') {
    const buf = canvas.toBuffer('image/jpeg', { quality: 0.92 });
    fs.writeFileSync(outPath, buf);
  } else {
    const buf = canvas.toBuffer('image/png');
    fs.writeFileSync(outPath, buf);
  }
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

  for (const row of CAPSULES) {
    const [name, w, h, base] = row;
    const options = row[4] || {};
    await generateOne(name, w, h, base, femaleGhoul, gasMask, rifleImage, backgroundImage, font, options);
  }

  // Icons: spooky forest + female ghoul centered only
  for (const [base, iconSize, ext] of ICONS) {
    await generateIcon(iconSize, base, ext, femaleGhoul, backgroundImage);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
