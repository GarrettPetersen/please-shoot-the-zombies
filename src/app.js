/**
 * Please Shoot the Zombies — minimal single-player shooting gallery.
 * One window, zombies appear, click to shoot. No networking.
 */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Fixed resolution for pixel-art look; canvas can be scaled by CSS
const W = 512;
const H = 384;
canvas.width = W;
canvas.height = H;

// Shooting gallery: "window" where zombies appear (centered region)
const WINDOW_X = Math.floor(W * 0.2);
const WINDOW_Y = Math.floor(H * 0.15);
const WINDOW_W = Math.floor(W * 0.6);
const WINDOW_H = Math.floor(H * 0.55);

// Rifle: fire-only sheet 8704×256 (34 frames), reload sheet 19200×256 (75 frames)
const RIFLE_FRAME_W = 256;
const RIFLE_FRAME_H = 256;
const RIFLE_FIRE_FRAME_COUNT = 34;   // all frames of fire-only loop
const RIFLE_RELOAD_FRAME_COUNT = 75; // all frames of fire+reload loop
const RIFLE_FPS = 24;
const RIFLE_CLIP_SIZE = 5;           // fire 5 times, then reload

// Zombie sprite: 512×1024 single frame, scale to fit window
const ZOMBIE_W = 120;
const ZOMBIE_H = 240;

let assets = {};
let score = 0;
let rifleFrame = 0;
let rifleState = 'idle';  // 'idle' | 'firing' | 'reloading'
let rifleFrameTime = 0;
let shotsInClip = RIFLE_CLIP_SIZE;   // after 5 shots, must reload
let currentZombie = null;
let spawnTimer = 0;
const SPAWN_DELAY = 120;  // frames between zombies

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = path;
  });
}

async function loadAssets() {
  const base = 'assets';
  assets.rifleFire = await loadImage(`${base}/lee_enfield-Sheet.png`);
  assets.rifleReload = await loadImage(`${base}/lee_enfield_reload-Sheet.png`);
  assets.zombie = await loadImage(`${base}/german_zombie.png`);
}

function spawnZombie() {
  if (currentZombie) return;
  currentZombie = {
    x: WINDOW_X + (WINDOW_W - ZOMBIE_W) / 2,
    y: WINDOW_Y + WINDOW_H - ZOMBIE_H,
    w: ZOMBIE_W,
    h: ZOMBIE_H,
  };
}

function hitTestZombie(px, py) {
  if (!currentZombie) return false;
  const z = currentZombie;
  return px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h;
}

function killZombie() {
  currentZombie = null;
  score += 1;
  spawnTimer = 0;
}

function drawWindow() {
  // Dark window frame
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(WINDOW_X - 4, WINDOW_Y - 4, WINDOW_W + 8, WINDOW_H + 8);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 4;
  ctx.strokeRect(WINDOW_X - 4, WINDOW_Y - 4, WINDOW_W + 8, WINDOW_H + 8);
  // Sky/dark view
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(WINDOW_X, WINDOW_Y, WINDOW_W, WINDOW_H);
}

function drawZombie() {
  if (!currentZombie || !assets.zombie) return;
  const z = currentZombie;
  ctx.drawImage(assets.zombie, 0, 0, 512, 1024, z.x, z.y, z.w, z.h);
}

function drawRifle(dt) {
  const fireSheet = assets.rifleFire;
  const reloadSheet = assets.rifleReload;
  if (!fireSheet || !reloadSheet) return;

  rifleFrameTime += dt;
  const frameDuration = 1 / RIFLE_FPS;

  if (rifleState === 'firing') {
    if (rifleFrameTime >= frameDuration) {
      rifleFrameTime -= frameDuration;
      rifleFrame += 1;
      if (rifleFrame >= RIFLE_FIRE_FRAME_COUNT) {
        rifleFrame = 0;
        shotsInClip -= 1;
        rifleState = 'idle';  // reload anim (with 5th shot) is started on next click when shotsInClip === 1
      }
    }
  } else if (rifleState === 'reloading') {
    if (rifleFrameTime >= frameDuration) {
      rifleFrameTime -= frameDuration;
      rifleFrame += 1;
      if (rifleFrame >= RIFLE_RELOAD_FRAME_COUNT) {
        rifleFrame = 0;
        shotsInClip = RIFLE_CLIP_SIZE;
        rifleState = 'idle';
      }
    }
  }

  const sheet = rifleState === 'reloading' ? reloadSheet : fireSheet;
  const frameCount = rifleState === 'reloading' ? RIFLE_RELOAD_FRAME_COUNT : RIFLE_FIRE_FRAME_COUNT;
  const frameIndex = Math.min(rifleFrame, frameCount - 1);
  const sx = frameIndex * RIFLE_FRAME_W;
  const sy = 0;

  const scale = 0.7;
  const rw = RIFLE_FRAME_W * scale;
  const rh = RIFLE_FRAME_H * scale;
  const rx = W - rw - 20;
  const ry = H - rh - 20;
  ctx.drawImage(sheet, sx, sy, RIFLE_FRAME_W, RIFLE_FRAME_H, rx, ry, rw, rh);
}

function drawScore() {
  ctx.fillStyle = '#666';
  ctx.font = '16px monospace';
  ctx.fillText(`Score: ${score}`, 12, 24);
}

function draw() {
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 0, W, H);

  drawWindow();
  drawZombie();
  drawRifle(1 / 60);
  drawScore();
}

function tick(dt) {
  spawnTimer += 1;
  if (spawnTimer >= SPAWN_DELAY) spawnZombie();
  draw();
}

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;

  // Only accept fire/reload when idle — no firing while an animation is playing
  if (rifleState !== 'idle') return;

  // Shots 1–4: fire-only animation. Shot 5: reload animation (includes the shot, then reload).
  if (shotsInClip > 1) {
    rifleState = 'firing';
    rifleFrame = 0;
    rifleFrameTime = 0;
    if (hitTestZombie(px, py)) killZombie();
  } else if (shotsInClip === 1) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    if (hitTestZombie(px, py)) killZombie();
  }
  // shotsInClip === 0 shouldn't occur (reload anim ends with full clip)
});

function loop(now = 0) {
  const last = loop.last || now;
  const dt = Math.min((now - last) / 1000, 0.1);
  loop.last = now;
  tick(dt);
  requestAnimationFrame(loop);
}

(async function main() {
  await loadAssets();
  requestAnimationFrame(loop);
})();
