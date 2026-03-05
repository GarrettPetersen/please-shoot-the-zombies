/**
 * Please Shoot the Zombies — minimal single-player 3D shooting gallery.
 * Player at fixed position, pivot with mouse (FPS-style). Zombies at 3D positions, scaled by distance.
 */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Resolution
const W = 512;
const H = 384;
canvas.width = W;
canvas.height = H;

// 3D: camera fixed position, yaw/pitch for look (radians)
const CAMERA_X = 0;
const CAMERA_Y = 1.6;
const CAMERA_Z = 0;
let cameraYaw = 0;   // left-right (rotation around Y)
let cameraPitch = 0; // up-down

const FOV = Math.PI / 3;  // 60° vertical FOV
const ASPECT = W / H;
const NEAR = 0.1;
const FAR = 500;

// World colors
const GROUND_COLOR = '#3d3d35';
const SKY_COLOR = '#2a3548';

// Rifle (unchanged from before)
const RIFLE_FRAME_W = 256;
const RIFLE_FRAME_H = 256;
const RIFLE_FIRE_FRAME_COUNT = 34;
const RIFLE_RELOAD_FRAME_COUNT = 75;
const RIFLE_FPS = 24;
const RIFLE_CLIP_SIZE = 5;

// Zombie: 3D position, sprite 512×1024; reference size at reference distance
const ZOMBIE_REF_HEIGHT = 1.8;  // world units (height of zombie)
const ZOMBIE_REF_DIST = 10;     // distance at which zombie appears at "normal" screen size

// Spawn: random XZ in annulus so they appear around the player
const SPAWN_MIN_DIST = 8;
const SPAWN_MAX_DIST = 35;
const SPAWN_DELAY = 90;
const MAX_ZOMBIES = 50;

let assets = {};
let score = 0;
let rifleFrame = 0;
let rifleState = 'idle';
let rifleFrameTime = 0;
let shotsInClip = RIFLE_CLIP_SIZE;
let zombies = [];  // { x, y, z } in world space
let spawnTimer = 0;
let pointerLocked = false;

// ---- 3D projection ----

function getViewVectors() {
  const cp = Math.cos(cameraPitch);
  const sp = Math.sin(cameraPitch);
  const cy = Math.cos(cameraYaw);
  const sy = Math.sin(cameraYaw);
  const forward = {
    x: sy * cp,
    y: -sp,
    z: -cy * cp,
  };
  const right = {
    x: cy,
    y: 0,
    z: sy,
  };
  const up = {
    x: -sy * sp,
    y: -cp,
    z: cy * sp,
  };
  return { forward, right, up };
}

function project(wx, wy, wz) {
  const dx = wx - CAMERA_X;
  const dy = wy - CAMERA_Y;
  const dz = wz - CAMERA_Z;
  const { forward, right, up } = getViewVectors();
  const depth = dx * forward.x + dy * forward.y + dz * forward.z;
  if (depth <= NEAR) return null;
  const viewX = dx * right.x + dy * right.y + dz * right.z;
  const viewY = dx * up.x + dy * up.y + dz * up.z;
  const scale = (H / 2) / (Math.tan(FOV / 2) * depth);
  const sx = W / 2 + viewX * scale;
  const sy = H / 2 - viewY * scale;
  return { sx, sy, depth };
}

// ---- Assets ----

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

// ---- Zombies ----

function spawnZombie() {
  if (zombies.length >= MAX_ZOMBIES) return;
  const angle = Math.random() * Math.PI * 2;
  const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
  const x = CAMERA_X + Math.cos(angle) * dist;
  const z = CAMERA_Z + Math.sin(angle) * dist;
  zombies.push({ x, y: 0, z });
}

function killZombieAtIndex(i) {
  zombies.splice(i, 1);
  score += 1;
  spawnTimer = 0;
}

// Zombie sprite: 512×1024. Draw as billboard: scale by distance (perspective)
function getZombieDrawInfo(z) {
  const projScale = (H / 2) / Math.tan(FOV / 2);
  const proj = project(z.x, z.y + ZOMBIE_REF_HEIGHT, z.z);
  if (!proj || proj.depth <= NEAR) return null;
  const screenH = (ZOMBIE_REF_HEIGHT * projScale) / proj.depth;
  const screenW = screenH * (512 / 1024);
  return {
    sx: proj.sx - screenW / 2,
    sy: proj.sy - screenH,
    sw: screenW,
    sh: screenH,
    depth: proj.depth,
  };
}

function hitTestZombies(px, py) {
  let best = -1;
  let bestDepth = Infinity;
  for (let i = 0; i < zombies.length; i++) {
    const info = getZombieDrawInfo(zombies[i]);
    if (!info) continue;
    if (px >= info.sx && px <= info.sx + info.sw && py >= info.sy && py <= info.sy + info.sh) {
      if (info.depth < bestDepth) {
        bestDepth = info.depth;
        best = i;
      }
    }
  }
  return best;
}

// ---- Drawing ----

function drawSky() {
  ctx.fillStyle = SKY_COLOR;
  ctx.fillRect(0, 0, W, H);
}

function drawGround() {
  // Horizon = where ground (y=0) meets sky. Project a point on the ground in our horizontal look direction.
  const { forward } = getViewVectors();
  const lenXZ = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  if (lenXZ < 1e-6) {
    ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const far = 10000;
  const hx = CAMERA_X + (forward.x / lenXZ) * far;
  const hz = CAMERA_Z + (forward.z / lenXZ) * far;
  const horizonProj = project(hx, 0, hz);
  const horizonY = horizonProj ? horizonProj.sy : H / 2;
  ctx.fillStyle = GROUND_COLOR;
  ctx.fillRect(0, Math.floor(horizonY), W, Math.max(0, H - Math.floor(horizonY)));
}

function drawZombies() {
  if (!assets.zombie) return;
  const withInfo = zombies.map((z) => ({ z, info: getZombieDrawInfo(z) })).filter((o) => o.info);
  withInfo.sort((a, b) => b.info.depth - a.info.depth);
  for (const { z, info } of withInfo) {
    ctx.drawImage(assets.zombie, 0, 0, 512, 1024, info.sx, info.sy, info.sw, info.sh);
  }
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
        rifleState = 'idle';
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
  const scale = 0.7;
  const rw = RIFLE_FRAME_W * scale;
  const rh = RIFLE_FRAME_H * scale;
  const rx = W - rw - 20;
  const ry = H - rh - 20;
  ctx.drawImage(sheet, sx, 0, RIFLE_FRAME_W, RIFLE_FRAME_H, rx, ry, rw, rh);
}

function drawScore() {
  ctx.fillStyle = '#aaa';
  ctx.font = '16px monospace';
  ctx.fillText(`Score: ${score}`, 12, 24);
}

function drawHint() {
  if (pointerLocked) return;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = '18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Click to lock mouse and play', W / 2, H / 2);
  ctx.textAlign = 'left';
}

function draw() {
  drawSky();
  drawGround();
  drawZombies();
  drawRifle(1 / 60);
  drawScore();
  if (!pointerLocked) drawHint();
}

function tick(dt) {
  spawnTimer += 1;
  if (spawnTimer >= SPAWN_DELAY) spawnZombie();
  draw();
}

// ---- Input ----

const MOUSE_SENS = 0.002;
const PITCH_LIMIT = Math.PI / 2 - 0.1;

canvas.addEventListener('click', (e) => {
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const scaleY = H / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;

  if (rifleState !== 'idle') return;

  if (shotsInClip > 1) {
    rifleState = 'firing';
    rifleFrame = 0;
    rifleFrameTime = 0;
    const idx = hitTestZombies(px, py);
    if (idx >= 0) killZombieAtIndex(idx);
  } else   if (shotsInClip === 1) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    const idx = hitTestZombies(px, py);
    if (idx >= 0) killZombieAtIndex(idx);
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
});

canvas.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  cameraYaw += e.movementX * MOUSE_SENS;     // mouse right = turn right
  cameraPitch -= e.movementY * MOUSE_SENS;   // joystick style: mouse up = look down
  cameraPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraPitch));
});

function loop(now = 0) {
  const last = loop.last ?? now;
  const dt = Math.min((now - last) / 1000, 0.1);
  loop.last = now;
  tick(dt);
  requestAnimationFrame(loop);
}

(function main() {
  requestAnimationFrame(loop);
  loadAssets().catch((err) => console.error('Asset load failed:', err));
})();

