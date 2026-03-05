/**
 * Please Shoot the Zombies — minimal single-player 3D shooting gallery.
 * Player at fixed position, pivot with mouse (FPS-style). Zombies at 3D positions, scaled by distance.
 */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Resolution
const W = 455;
const H = 256;
canvas.width = W;
canvas.height = H;

// Pixel art: nearest-neighbor scaling, no anti-aliasing on sprites
ctx.imageSmoothingEnabled = false;

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

// Rifle — 455×256 per frame (fire + reload sheets), same as canvas
const RIFLE_FRAME_W = 455;
const RIFLE_FRAME_H = 256;
const RIFLE_FIRE_FRAME_COUNT = 34;
const RIFLE_RELOAD_FRAME_COUNT = 75;
const RIFLE_FPS = 24;
const RIFLE_CLIP_SIZE = 5;

// Zombie: 3D position, sprite 512×1024; reference size at reference distance
const ZOMBIE_REF_HEIGHT = 1.8;  // world units (height of zombie)
const ZOMBIE_REF_DIST = 10;     // distance at which zombie appears at "normal" screen size
const ZOMBIE_SPRITE_W = 512;
const ZOMBIE_SPRITE_H = 1024;
const ZOMBIE_NECK_PX = 185;    // pixels from top of sprite; above = head
const ZOMBIE_HP_MAX = 3;
const ZOMBIE_DAMAGE_BODY = 1;
const ZOMBIE_DAMAGE_HEAD = 3;

// Spawn: random XZ in annulus so they appear around the player
const SPAWN_MIN_DIST = 2;
const SPAWN_MAX_DIST = 14;
const SPAWN_DELAY = 480;  // frames between spawns (~8s at 60fps) — much slower
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
let hitFeedbackTime = 0;  // seconds to show hit reticule (CoD-style diagonal)
let audioContext = null;  // Web Audio API context for positional sounds

// Aiming: desired direction (reticule leads), camera chases with delay — turn any direction
let desiredYaw = 0;
let desiredPitch = 0;
const RETICULE_CLAMP_X = W / 2;      // allow reticule to reach left/right edges
const RETICULE_CLAMP_Y = H / 2;      // allow reticule to reach top/bottom edges
const CHASE_LERP = 2.2;              // lower = smoother, slower slide toward cursor (view follows reticule gently)
const MOUSE_SENS = 0.001;            // radians per pixel (yaw)
const PITCH_SENS = 0.0018;           // radians per pixel (pitch) — higher so up/down feels as responsive as left/right
const RETICULE_ANGLE_SCALE = 0.35;   // rad of error -> reticule scale
const RAD_TO_PIXEL = Math.min(RETICULE_CLAMP_X, RETICULE_CLAMP_Y) / RETICULE_ANGLE_SCALE;
const GUN_PX_PER_RETICULE_PX = 1 / 3;   // 3 px cursor -> 1 px rifle (horizontal)
const GUN_PX_PER_RETICULE_PX_Y = 0.55; // vertical: rifle moves down more when aiming down (less "aiming high")

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

// Reticule offset from center (px); view chases desired so this drifts to 0
function getReticuleOffset() {
  const yawErr = normalizeAngle(desiredYaw - cameraYaw);
  const dx = yawErr * RAD_TO_PIXEL;
  const dy = (desiredPitch - cameraPitch) * RAD_TO_PIXEL;  // aim down -> reticule below center
  return {
    x: Math.max(-RETICULE_CLAMP_X, Math.min(RETICULE_CLAMP_X, dx)),
    y: Math.max(-RETICULE_CLAMP_Y, Math.min(RETICULE_CLAMP_Y, dy)),
  };
}

// ---- 3D projection ----

function getViewVectors() {
  // Use negated pitch so positive cameraPitch (mouse down) = look down in 3D view
  const pitch = -cameraPitch;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(cameraYaw);
  const sy = Math.sin(cameraYaw);
  const forward = {
    x: sy * cp,
    y: sp,   // sin(pitch): positive pitch (look down) -> forward.y positive in view; negated so cameraPitch up = look down
    z: -cy * cp,
  };
  const right = {
    x: cy,
    y: 0,
    z: sy,
  };
  const up = {
    x: -sy * sp,
    y: cp,   // keep up right-side up when pitch is negated
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

const SFX_SHOT_PATHS = [
  'assets/sfx/clean/lee-enfield_shot_1.ogg',
  'assets/sfx/clean/lee-enfield_shot_2.ogg',
];
const SFX_DRY_FIRE_PATH = 'assets/sfx/clean/lee-enfield_dry_fire.ogg';
const SFX_EJECT_CASING_PATH = 'assets/sfx/clean/lee-enfield_eject_casing.ogg';
const SFX_RELOAD_PATH = 'assets/sfx/clean/lee-enfield_reload.ogg';
// Align reload sound so 0.65s in file matches frame 51 (1-indexed). Trigger at this 0-indexed frame.
const RELOAD_SOUND_ALIGN_FRAME = 51;   // 1-indexed (51st frame)
const RELOAD_SOUND_ALIGN_TIME = 0.65; // seconds into sound file at that frame
const RELOAD_SOUND_EARLY_OFFSET = 0.25; // start sound this many seconds earlier
const RELOAD_SOUND_TRIGGER_FRAME = Math.max(0, Math.floor((RELOAD_SOUND_ALIGN_FRAME - 1) - RELOAD_SOUND_ALIGN_TIME * RIFLE_FPS - RELOAD_SOUND_EARLY_OFFSET * RIFLE_FPS));

async function loadAssets() {
  const base = 'assets';
  assets.rifleFire = await loadImage(`${base}/lee_enfield-Sheet.png`);
  assets.rifleReload = await loadImage(`${base}/lee_enfield_reload-Sheet.png`);
  assets.zombie = await loadImage(`${base}/german_zombie.png`);
  assets.shotSounds = SFX_SHOT_PATHS.map((path) => {
    const a = new Audio(path);
    a.preload = 'auto';
    return a;
  });
  assets.dryFire = new Audio(SFX_DRY_FIRE_PATH);
  assets.dryFire.preload = 'auto';
  assets.ejectCasing = new Audio(SFX_EJECT_CASING_PATH);
  assets.ejectCasing.preload = 'auto';
  assets.reloadSound = new Audio(SFX_RELOAD_PATH);
  assets.reloadSound.preload = 'auto';
  const ZOMBIE_SOUND_NAMES = ['zombie_1', 'zombie_2', 'zombie_3', 'zombie_4', 'zombie_5'];
  assets.zombieSoundPaths = ZOMBIE_SOUND_NAMES.map((n) => `${base}/sfx/clean/${n}.ogg`);
}

function playShotSound() {
  if (!assets.shotSounds || assets.shotSounds.length === 0) return;
  const which = Math.floor(Math.random() * assets.shotSounds.length);
  const snd = assets.shotSounds[which];
  snd.currentTime = 0;
  snd.play().catch(() => { });
}

function playEjectCasingSound() {
  if (!assets.ejectCasing) return;
  assets.ejectCasing.currentTime = 0;
  assets.ejectCasing.play().catch(() => { });
}

function playDryFireSound() {
  if (!assets.dryFire) return;
  assets.dryFire.currentTime = 0;
  assets.dryFire.play().catch(() => { });
}

let reloadSoundPlayed = false;

function playReloadSound() {
  if (!assets.reloadSound) return;
  assets.reloadSound.currentTime = 0;
  assets.reloadSound.play().catch(() => { });
}

// ---- Positional audio (reusable for SFX, multiplayer, voice chat) ----
// Listener is at (CAMERA_X, CAMERA_Z) facing cameraYaw. Sources at (worldX, worldZ) get gain + stereo pan.

const POSITIONAL_REF_DIST = 5;
const POSITIONAL_ROLLOFF = 0.25;

/** Returns { gain, pan } for a source at (worldX, worldZ). Use for one-shots or to update continuous sources (e.g. voice) each frame. */
function getPositionalGainPan(worldX, worldZ) {
  const dx = worldX - CAMERA_X;
  const dz = worldZ - CAMERA_Z;
  const distance = Math.sqrt(dx * dx + dz * dz) || 0.001;
  const gain = 1 / (1 + (distance / POSITIONAL_REF_DIST) * POSITIONAL_ROLLOFF);
  const soundAngle = Math.atan2(dz, dx);
  const lookAngle = Math.atan2(-Math.cos(cameraYaw), Math.sin(cameraYaw));
  const relativeAngle = normalizeAngle(soundAngle - lookAngle);
  const pan = Math.max(-1, Math.min(1, relativeAngle / (Math.PI / 2)));
  return { gain, pan };
}

function getAudioContext() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

/** One-shot: play a sound from URL at world position (e.g. zombie spawn, impact). */
function playPositionalSound(url, worldX, worldZ) {
  if (!url) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const { gain, pan } = getPositionalGainPan(worldX, worldZ);
  const audio = new Audio(url);
  const source = ctx.createMediaElementSource(audio);
  const gainNode = ctx.createGain();
  const panner = ctx.createStereoPanner();
  gainNode.gain.value = gain;
  panner.pan.value = pan;
  source.connect(gainNode);
  gainNode.connect(panner);
  panner.connect(ctx.destination);
  audio.play().catch(() => {});
}

/** For continuous sources (e.g. voice chat): create graph, connect your source to .gainNode, then each frame/tick set gainNode.gain.value and panner.pan.value from getPositionalGainPan(sourceX, sourceZ). */
function createPositionalGraph(worldX, worldZ) {
  const ctx = getAudioContext();
  if (!ctx) return null;
  const { gain, pan } = getPositionalGainPan(worldX, worldZ);
  const gainNode = ctx.createGain();
  const panner = ctx.createStereoPanner();
  gainNode.gain.value = gain;
  panner.pan.value = pan;
  gainNode.connect(panner);
  panner.connect(ctx.destination);
  return { gainNode, panner };
}

// ---- Zombies ----

function spawnZombie() {
  if (zombies.length >= MAX_ZOMBIES) return;
  const angle = Math.random() * Math.PI * 2;
  const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
  const x = CAMERA_X + Math.cos(angle) * dist;
  const z = CAMERA_Z + Math.sin(angle) * dist;
  zombies.push({ x, y: 0, z, hp: ZOMBIE_HP_MAX });
  if (assets.zombieSoundPaths && assets.zombieSoundPaths.length > 0) {
    const which = Math.floor(Math.random() * assets.zombieSoundPaths.length);
    playPositionalSound(assets.zombieSoundPaths[which], x, z);
  }
}

const HIT_FEEDBACK_DURATION = 0.18;  // seconds to show diagonal hit reticule

// Particle system (performance: caps, simple physics, small draw)
const MAX_PARTICLES = 1200;
const HOLE_RADIUS_SPRITE = 70;  // 2.5x original (28*2.5) for big visible hole
const HOLE_JAGGED_POINTS = 24;  // number of points around the hole for jagged shape
const HOLE_JAGGED_AMOUNT = 0.45; // 0 = circle, larger = more irregular (radius *= 1 ± this)
const HOLE_PARTICLE_COUNT = 90;
const DEATH_GRID_STEP = 20;   // sample zombie texture every N px for death pile
const PARTICLE_LIFE = 2.5;
const WORLD_GRAVITY = 18;      // world units/s² (y down)
const PARTICLE_BOUNCE = 0.35;
const PARTICLE_FRICTION = 0.82;
const PARTICLE_REST_VY = 0.5;
const PARTICLE_REST_VXZ = 0.5;

let particles = [];
let zombieSampleCanvas, zombieSampleCtx;
let holeCanvas, holeCtx;  // offscreen buffer for zombie-with-holes (true transparency)

function ensureZombieSampleCanvas() {
  if (zombieSampleCtx) return;
  zombieSampleCanvas = document.createElement('canvas');
  zombieSampleCanvas.width = ZOMBIE_SPRITE_W;
  zombieSampleCanvas.height = ZOMBIE_SPRITE_H;
  zombieSampleCtx = zombieSampleCanvas.getContext('2d');
}

function makeJaggedRadii() {
  const radii = [];
  for (let i = 0; i < HOLE_JAGGED_POINTS; i++) {
    const r = HOLE_RADIUS_SPRITE * (1 + (Math.random() - 0.5) * 2 * HOLE_JAGGED_AMOUNT);
    radii.push(Math.max(8, r));
  }
  return radii;
}

function insideJaggedShape(dx, dy, radii) {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1e-6) return true;
  let angle = Math.atan2(dy, dx);
  if (angle < 0) angle += 2 * Math.PI;
  const step = (2 * Math.PI) / radii.length;
  const i = Math.floor(angle / step) % radii.length;
  const j = (i + 1) % radii.length;
  const frac = (angle / step) - Math.floor(angle / step);
  const r = radii[i] * (1 - frac) + radii[j] * frac;
  return dist <= r;
}

function spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii) {
  if (!assets.zombie || particles.length >= MAX_PARTICLES) return;
  ensureZombieSampleCanvas();
  zombieSampleCtx.drawImage(assets.zombie, 0, 0);
  const idata = zombieSampleCtx.getImageData(0, 0, ZOMBIE_SPRITE_W, ZOMBIE_SPRITE_H);
  const hitTx = ((hitPx - info.sx) / info.sw) * ZOMBIE_SPRITE_W;
  const hitTy = ((hitPy - info.sy) / info.sh) * ZOMBIE_SPRITE_H;
  const t = Math.max(0, Math.min(1, (hitPy - info.sy) / info.sh));
  const worldY = z.y + (1 - t) * ZOMBIE_REF_HEIGHT;
  const maxR = Math.max(...jaggedRadii);
  let added = 0;
  for (let dy = -maxR; dy <= maxR && added < HOLE_PARTICLE_COUNT; dy += 2) {
    for (let dx = -maxR; dx <= maxR && added < HOLE_PARTICLE_COUNT; dx += 2) {
      if (!insideJaggedShape(dx, dy, jaggedRadii)) continue;
      const tx = Math.floor(hitTx + dx);
      const ty = Math.floor(hitTy + dy);
      if (tx < 0 || tx >= ZOMBIE_SPRITE_W || ty < 0 || ty >= ZOMBIE_SPRITE_H) continue;
      const i = (ty * ZOMBIE_SPRITE_W + tx) * 4;
      const r = idata.data[i];
      const g = idata.data[i + 1];
      const b = idata.data[i + 2];
      const a = idata.data[i + 3];
      if (a < 10) continue;
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5);
      const speed = 2.5 + Math.random() * 2.5;
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        wx: z.x + (Math.random() - 0.5) * 0.1,
        wy: worldY + (Math.random() - 0.5) * 0.05,
        wz: z.z + (Math.random() - 0.5) * 0.1,
        vwx: Math.cos(angle) * speed * 0.8,
        vwy: Math.sin(angle) * speed * 0.5 + 1.5,
        vwz: Math.sin(angle) * speed * 0.8,
        r, g, b, a,
        life: PARTICLE_LIFE,
        maxLife: PARTICLE_LIFE,
      });
      added++;
    }
  }
}

function spawnDeathParticles(z, info) {
  if (!assets.zombie || particles.length >= MAX_PARTICLES) return;
  ensureZombieSampleCanvas();
  zombieSampleCtx.drawImage(assets.zombie, 0, 0);
  const idata = zombieSampleCtx.getImageData(0, 0, ZOMBIE_SPRITE_W, ZOMBIE_SPRITE_H);
  for (let ty = 0; ty < ZOMBIE_SPRITE_H; ty += DEATH_GRID_STEP) {
    for (let tx = 0; tx < ZOMBIE_SPRITE_W; tx += DEATH_GRID_STEP) {
      const i = (ty * ZOMBIE_SPRITE_W + tx) * 4;
      const a = idata.data[i + 3];
      if (a < 10) continue;
      if (particles.length >= MAX_PARTICLES) return;
      const worldY = z.y + (1 - ty / ZOMBIE_SPRITE_H) * ZOMBIE_REF_HEIGHT;
      particles.push({
        wx: z.x + (tx / ZOMBIE_SPRITE_W - 0.5) * 0.4,
        wy: worldY,
        wz: z.z + (Math.random() - 0.5) * 0.2,
        vwx: (Math.random() - 0.5) * 0.8,
        vwy: (Math.random() - 0.5) * 0.3,
        vwz: (Math.random() - 0.5) * 0.8,
        r: idata.data[i], g: idata.data[i + 1], b: idata.data[i + 2], a,
        life: PARTICLE_LIFE,
        maxLife: PARTICLE_LIFE,
      });
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    p.life -= dt;
    if (p.atRest) continue;
    p.vwy -= WORLD_GRAVITY * dt;
    p.wx += p.vwx * dt;
    p.wy += p.vwy * dt;
    p.wz += p.vwz * dt;
    if (p.wy <= 0) {
      p.wy = 0;
      p.vwy = -p.vwy * PARTICLE_BOUNCE;
      p.vwx *= PARTICLE_FRICTION;
      p.vwz *= PARTICLE_FRICTION;
      if (Math.abs(p.vwy) < PARTICLE_REST_VY && Math.abs(p.vwx) < PARTICLE_REST_VXZ && Math.abs(p.vwz) < PARTICLE_REST_VXZ) {
        p.vwy = 0;
        p.vwx = 0;
        p.vwz = 0;
        p.atRest = true;
      }
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    const proj = project(p.wx, p.wy, p.wz);
    if (!proj || proj.depth <= NEAR) continue;
    if (proj.sx < -4 || proj.sx > W + 4 || proj.sy < -4 || proj.sy > H + 4) continue;
    const t = p.life / p.maxLife;
    ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${(p.a / 255) * t})`;
    ctx.fillRect(Math.floor(proj.sx), Math.floor(proj.sy), 2, 2);
  }
}

function isHeadShot(info, py) {
  const neckY = info.sy + info.sh * (ZOMBIE_NECK_PX / ZOMBIE_SPRITE_H);
  return py < neckY;
}

function damageZombie(idx, hitPx, hitPy) {
  const z = zombies[idx];
  const info = getZombieDrawInfo(z);
  if (!info) return;
  const headShot = isHeadShot(info, hitPy);
  const damage = headShot ? ZOMBIE_DAMAGE_HEAD : ZOMBIE_DAMAGE_BODY;
  z.hp -= damage;
  const hitTx = ((hitPx - info.sx) / info.sw) * ZOMBIE_SPRITE_W;
  const hitTy = ((hitPy - info.sy) / info.sh) * ZOMBIE_SPRITE_H;
  const jaggedRadii = makeJaggedRadii();
  if (z.hp <= 0) {
    spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii);
    spawnDeathParticles(z, info);
    zombies.splice(idx, 1);
    score += 1;
    spawnTimer = 0;
    hitFeedbackTime = HIT_FEEDBACK_DURATION;
  } else {
    if (!z.holes) z.holes = [];
    z.holes.push({ tx: hitTx, ty: hitTy, jaggedRadii });
    spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii);
  }
}

// Zombie sprite: 512×1024. Anchor by head and feet so they sit on the ground (no floating)
function getZombieDrawInfo(z) {
  const headProj = project(z.x, z.y + ZOMBIE_REF_HEIGHT, z.z);
  const feetProj = project(z.x, z.y, z.z);
  if (!headProj || headProj.depth <= NEAR || !feetProj) return null;
  const screenH = feetProj.sy - headProj.sy;  // head above feet on screen; height = projected span
  const screenW = screenH * (512 / 1024);
  return {
    sx: headProj.sx - screenW / 2,
    sy: headProj.sy,
    sw: screenW,
    sh: screenH,
    depth: headProj.depth,
  };
}

const PIXEL_HIT_ALPHA_THRESHOLD = 10;

function hitTestZombies(px, py) {
  if (!assets.zombie) return -1;
  const candidates = [];
  for (let i = 0; i < zombies.length; i++) {
    const info = getZombieDrawInfo(zombies[i]);
    if (!info) continue;
    if (px >= info.sx && px <= info.sx + info.sw && py >= info.sy && py <= info.sy + info.sh) {
      candidates.push({ i, info, z: zombies[i], depth: info.depth });
    }
  }
  if (candidates.length === 0) return -1;
  candidates.sort((a, b) => a.depth - b.depth);

  ensureZombieSampleCanvas();
  zombieSampleCtx.drawImage(assets.zombie, 0, 0);
  const idata = zombieSampleCtx.getImageData(0, 0, ZOMBIE_SPRITE_W, ZOMBIE_SPRITE_H);

  for (const { i, info, z } of candidates) {
    const tx = (px - info.sx) / info.sw * ZOMBIE_SPRITE_W;
    const ty = (py - info.sy) / info.sh * ZOMBIE_SPRITE_H;
    const txF = Math.floor(tx);
    const tyF = Math.floor(ty);
    if (txF < 0 || txF >= ZOMBIE_SPRITE_W || tyF < 0 || tyF >= ZOMBIE_SPRITE_H) continue;
    const idx = (tyF * ZOMBIE_SPRITE_W + txF) * 4 + 3;
    if (idata.data[idx] < PIXEL_HIT_ALPHA_THRESHOLD) continue;
    if (z.holes && z.holes.length > 0) {
      let inHole = false;
      for (const hole of z.holes) {
        if (insideJaggedShape(tx - hole.tx, ty - hole.ty, hole.jaggedRadii)) {
          inHole = true;
          break;
        }
      }
      if (inHole) continue;
    }
    return i;
  }
  return -1;
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
    if (z.holes && z.holes.length > 0) {
      const rw = Math.ceil(info.sw);
      const rh = Math.ceil(info.sh);
      if (!holeCanvas || holeCanvas.width < rw || holeCanvas.height < rh) {
        holeCanvas = document.createElement('canvas');
        holeCanvas.width = Math.max(rw, 1);
        holeCanvas.height = Math.max(rh, 1);
        holeCtx = holeCanvas.getContext('2d');
      }
      holeCtx.clearRect(0, 0, holeCanvas.width, holeCanvas.height);
      holeCtx.drawImage(assets.zombie, 0, 0, ZOMBIE_SPRITE_W, ZOMBIE_SPRITE_H, 0, 0, info.sw, info.sh);
      const holeRadiusScreen = (HOLE_RADIUS_SPRITE / ZOMBIE_SPRITE_W) * info.sw;
      ensureZombieSampleCanvas();
      zombieSampleCtx.drawImage(assets.zombie, 0, 0);
      const spriteData = zombieSampleCtx.getImageData(0, 0, ZOMBIE_SPRITE_W, ZOMBIE_SPRITE_H);
      const HOLE_EDGE_ALPHA_THRESHOLD = 10;
      for (const hole of z.holes) {
        const hx = (hole.tx / ZOMBIE_SPRITE_W) * info.sw;
        const hy = (hole.ty / ZOMBIE_SPRITE_H) * info.sh;
        const scaleX = info.sw / ZOMBIE_SPRITE_W;
        const scaleY = info.sh / ZOMBIE_SPRITE_H;
        let vertices = [];
        holeCtx.beginPath();
        if (hole.jaggedRadii && hole.jaggedRadii.length > 0) {
          for (let i = 0; i < hole.jaggedRadii.length; i++) {
            const angle = (i / hole.jaggedRadii.length) * 2 * Math.PI;
            const r = hole.jaggedRadii[i];
            const px = hx + Math.cos(angle) * r * scaleX;
            const py = hy + Math.sin(angle) * r * scaleY;
            vertices.push({ x: px, y: py });
            if (i === 0) holeCtx.moveTo(px, py);
            else holeCtx.lineTo(px, py);
          }
          holeCtx.closePath();
        } else {
          holeCtx.arc(hx, hy, holeRadiusScreen, 0, Math.PI * 2);
          for (let i = 0; i < HOLE_JAGGED_POINTS; i++) {
            const angle = (i / HOLE_JAGGED_POINTS) * 2 * Math.PI;
            vertices.push({
              x: hx + Math.cos(angle) * holeRadiusScreen,
              y: hy + Math.sin(angle) * holeRadiusScreen,
            });
          }
        }
        holeCtx.globalCompositeOperation = 'destination-out';
        holeCtx.fillStyle = 'rgba(0,0,0,1)';
        holeCtx.fill();
        holeCtx.globalCompositeOperation = 'source-over';
        holeCtx.strokeStyle = '#000';
        holeCtx.lineWidth = 1;
        if (vertices.length >= 2) {
          const n = vertices.length;
          for (let i = 0; i < n; i++) {
            const v0 = vertices[i];
            const v1 = vertices[(i + 1) % n];
            const mx = (v0.x + v1.x) / 2;
            const my = (v0.y + v1.y) / 2;
            const dx = mx - hx;
            const dy = my - hy;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const outX = mx + (dx / len) * 2;
            const outY = my + (dy / len) * 2;
            const sx = Math.floor((outX / info.sw) * ZOMBIE_SPRITE_W);
            const sy = Math.floor((outY / info.sh) * ZOMBIE_SPRITE_H);
            const tx = Math.max(0, Math.min(ZOMBIE_SPRITE_W - 1, sx));
            const ty = Math.max(0, Math.min(ZOMBIE_SPRITE_H - 1, sy));
            const idx = (ty * ZOMBIE_SPRITE_W + tx) * 4 + 3;
            if (spriteData.data[idx] > HOLE_EDGE_ALPHA_THRESHOLD) {
              holeCtx.beginPath();
              holeCtx.moveTo(v0.x, v0.y);
              holeCtx.lineTo(v1.x, v1.y);
              holeCtx.stroke();
            }
          }
        }
      }
      ctx.drawImage(holeCanvas, 0, 0, info.sw, info.sh, info.sx, info.sy, info.sw, info.sh);
    } else {
      ctx.drawImage(assets.zombie, 0, 0, ZOMBIE_SPRITE_W, ZOMBIE_SPRITE_H, info.sx, info.sy, info.sw, info.sh);
    }
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
      if (!reloadSoundPlayed && rifleFrame >= RELOAD_SOUND_TRIGGER_FRAME) {
        playReloadSound();
        reloadSoundPlayed = true;
      }
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
  const scale = H / RIFLE_FRAME_H;
  const rw = RIFLE_FRAME_W * scale;
  const rh = RIFLE_FRAME_H * scale;
  // Gun lines up with screen only when reticule is top-left; else 1 gun px per 2 reticule px
  const ro = getReticuleOffset();
  let rifleShiftX = (ro.x + RETICULE_CLAMP_X) * GUN_PX_PER_RETICULE_PX;
  let rifleShiftY = (ro.y + RETICULE_CLAMP_Y) * GUN_PX_PER_RETICULE_PX_Y;
  // During reload: move gun toward (0,0) (slower out), peak at frame 52 when bullets go in, faster back
  if (rifleState === 'reloading') {
    const RELOAD_PEAK_FRAME = 51; // 0-indexed; frame 52 = push bullets in
    const smoothstep = (t) => t * t * (3 - 2 * t);
    let reloadBlend;
    if (rifleFrame <= RELOAD_PEAK_FRAME) {
      const t = RELOAD_PEAK_FRAME > 0 ? rifleFrame / RELOAD_PEAK_FRAME : 1;
      reloadBlend = smoothstep(t);
    } else {
      const framesBack = RIFLE_RELOAD_FRAME_COUNT - 1 - RELOAD_PEAK_FRAME;
      const t = framesBack > 0 ? (rifleFrame - RELOAD_PEAK_FRAME) / framesBack : 1;
      reloadBlend = 1 - smoothstep(t);
    }
    rifleShiftX *= 1 - reloadBlend;
    rifleShiftY *= 1 - reloadBlend;
  }
  ctx.drawImage(sheet, sx, 0, RIFLE_FRAME_W, RIFLE_FRAME_H, rifleShiftX, rifleShiftY, rw, rh);
}

const FONT_FAMILY = 'Zpix';
const FONT_SIZE = 24;  // multiples of 12 for pixel font

function drawScore() {
  ctx.fillStyle = '#aaa';
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillText(`Score: ${score}`, 12, FONT_SIZE + 4);
}

function drawReticule() {
  if (!pointerLocked) return;
  if (rifleState === 'reloading') return;
  const ro = getReticuleOffset();
  const cx = Math.round(W / 2 + ro.x);
  const cy = Math.round(H / 2 + ro.y);
  const size = 4;
  const stroke = 1;
  const canFire = rifleState === 'idle';

  if (hitFeedbackTime > 0) {
    // CoD-style: diagonal X for a split second after a hit
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy + size);
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx - size, cy + size);
    ctx.stroke();
  } else if (!canFire) {
    // Can't fire (firing or reloading): X reticule, dimmed
    ctx.strokeStyle = 'rgba(180, 180, 180, 0.25)';
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy - size);
    ctx.lineTo(cx + size, cy + size);
    ctx.moveTo(cx + size, cy - size);
    ctx.lineTo(cx - size, cy + size);
    ctx.stroke();
  } else {
    // Normal crosshair when ready to fire
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(cx - size, cy);
    ctx.lineTo(cx + size, cy);
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx, cy + size);
    ctx.stroke();
  }
}

function drawHint() {
  if (pointerLocked) return;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('Click to lock mouse and play', W / 2, H / 2);
  ctx.textAlign = 'left';
}

function draw() {
  drawSky();
  drawGround();
  drawZombies();
  drawParticles();
  drawRifle(1 / 60);
  drawScore();
  drawReticule();
  if (!pointerLocked) drawHint();
}

function tick(dt) {
  spawnTimer += 1;
  if (spawnTimer >= SPAWN_DELAY) spawnZombie();
  hitFeedbackTime = Math.max(0, hitFeedbackTime - dt);
  updateParticles(dt);
  // View chases desired aim (shortest path for yaw); reticule drifts to center as body follows
  const chaseT = 1 - Math.exp(-CHASE_LERP * dt);
  cameraYaw += normalizeAngle(desiredYaw - cameraYaw) * chaseT;
  cameraPitch += (desiredPitch - cameraPitch) * chaseT;
  cameraPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraPitch));
  draw();
}

// ---- Input ----

const PITCH_LIMIT = Math.PI / 2 - 0.1;

canvas.addEventListener('click', (e) => {
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  const ro = getReticuleOffset();
  const px = W / 2 + ro.x;
  const py = H / 2 + ro.y;

  if (rifleState !== 'idle') {
    playDryFireSound();
    return;
  }

  if (shotsInClip > 1) {
    rifleState = 'firing';
    rifleFrame = 0;
    rifleFrameTime = 0;
    playShotSound();
    playEjectCasingSound();
    const idx = hitTestZombies(px, py);
    if (idx >= 0) damageZombie(idx, px, py);
  } else if (shotsInClip === 1) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    playShotSound();
    playEjectCasingSound();
    const idx = hitTestZombies(px, py);
    if (idx >= 0) damageZombie(idx, px, py);
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) {
    desiredYaw = desiredPitch = 0;
    cameraYaw = cameraPitch = 0;
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  desiredYaw += e.movementX * MOUSE_SENS;
  desiredPitch += e.movementY * PITCH_SENS;   // mouse down -> look down (positive pitch), reticule leads then camera follows
  desiredPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, desiredPitch));
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

