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

// 3D: bunker at world center; camera moves between discrete slots around it.
const WORLD_CENTER_X = 0;
const WORLD_CENTER_Z = 0;
const CAMERA_Y = 1.6;
let cameraX = WORLD_CENTER_X;
let cameraZ = WORLD_CENTER_Z;
let desiredCameraX = WORLD_CENTER_X;
let desiredCameraZ = WORLD_CENTER_Z;
let cameraYaw = 0;   // left-right (rotation around Y)
let cameraPitch = 0; // up-down

const FOV = Math.PI / 3;  // 60° vertical FOV
const IRON_SIGHTS_FOV = Math.PI / 5;  // narrower when aiming down sights (~36°)
const IRON_SIGHTS_SENS = 0.35;  // cursor sensitivity multiplier when holding iron sights
const ASPECT = W / H;
const NEAR = 0.1;
const FAR = 500;

// World colors
const GROUND_COLOR = '#3d3d35';
const SKY_COLOR = '#2a3548';
const FOG_COLOR = '#3a4555';
const FOG_RGB = { r: 0x3a, g: 0x45, b: 0x55 };
const FOG_DENSITY = 0.028;
const FOG_START = 4;  // no fog this close; fog ramps in beyond
const FOG_WISP_COUNT = 5;       // number of wisp sprite variants
const FOG_WISP_POSITIONS = 58;  // world positions (orbit at various distances)
const FOG_WISP_SPRITE_SIZE = 96;
const FOG_WISP_REF_DEPTH = 25;  // reference depth for screen size
const FOG_WISP_BASE_ALPHA = 0.18;
const FOG_WISP_ROT_SPEED = 0.026;  // rad/sec; each wisp gets ± this (clockwise vs counterclockwise)

// Bunker: generate a rectangular ring of discrete standing positions.
const BUNKER_LAYOUT = { north: 3, east: 2, south: 3, west: 2 };
const BUNKER_SLOT_SPACING = 4.5;
const BUNKER_WALL_INSET = 1.35;
const BUNKER_MOVE_LERP = 10;
const BUNKER_CRATE_SIDE = 'south';
const BUNKER_WALL_HEIGHT = 2.85;
const BUNKER_WINDOW_WIDTH = 1.9;
const BUNKER_WINDOW_BOTTOM = 0.9;
const BUNKER_WINDOW_TOP = 2.15;
const BUNKER_CRATE_WIDTH = 1.9;
const BUNKER_CRATE_HEIGHT = 1.15;
const BUNKER_CRATE_DEPTH = 0.95;
let bunker = null;
let bunkerSlots = [];
let activeSlotIndex = 0;

// Trees: 4x4 grid of 256x256 sprites in RetroTree.png; bottom-left two cells (0,3),(1,3) empty → 14 variants
const TREE_SPRITE_SIZE = 256;
const TREE_GRID_COLS = 4;
const TREE_GRID_ROWS = 4;
const TREE_HEIGHT = 25;           // world units (tall so at min dist they use full 256px and dwarf zombies)
const TREE_MIN_DIST = 22;
const TREE_MAX_DIST = 55;
const TREE_COUNT = 32;
const TREE_HP = 100;
const TREE_DAMAGE = 1;   // body only; no headshot, so trees rarely "fully explode"
let trees = [];

// Rifle — 455×256 per frame (fire + reload sheets), same as canvas
const RIFLE_FRAME_W = 455;
const RIFLE_FRAME_H = 256;
const RIFLE_FIRE_FRAME_COUNT = 34;
const RIFLE_RELOAD_FRAME_COUNT = 75;
const RIFLE_FPS = 24;
const RIFLE_CLIP_SIZE = 5;
const MAX_CLIPS = 10;
const IRON_SIGHTS_AIM_X = 166;
const IRON_SIGHTS_AIM_Y = 198;
const IRON_SIGHTS_RIGID_RESPONSE = 0.55;
const IRON_SIGHTS_DEPTH = { front: 0.5, rear: 0.15, barrel: -0.35, stock: -1.25 };
const IRON_SIGHTS_RECOIL_KICK = 42;
const IRON_SIGHTS_RECOIL_DECAY = 0.72;
let ironSightsHeld = false;
let ironSightsRecoilKick = 0;
const RELOAD_FREEZE_FRAME = 22;   // freeze here when out of clips until restocked
const OUT_OF_AMMO_MESSAGE_DURATION = 1.5;

// Zombie: 3D position, sprite size and reference at distance
const ZOMBIE_REF_HEIGHT = 1.8;  // world units (height of zombie)
const ZOMBIE_REF_DIST = 10;     // distance at which zombie appears at "normal" screen size
const ZOMBIE_SPRITE_W = 132;
const ZOMBIE_SPRITE_H = 256;
const ZOMBIE_HP_MAX = 3;
const ZOMBIE_DAMAGE_BODY = 1;
const ZOMBIE_DAMAGE_HEAD = 3;

// Spawn: start far away; they walk toward player
const SPAWN_MIN_DIST = 28;
const SPAWN_MAX_DIST = 55;
const SPAWN_DELAY = 520;
const MAX_ZOMBIES = 20;
const ZOMBIE_SPEED = 0.35;       // world units/sec (average); each zombie has speedMult for variation
const ZOMBIE_ZIGZAG = 0.5;      // lateral sway (world units)
const ZOMBIE_ZIGZAG_SPEED = 2.5; // rad/sec for zigzag phase
const ZOMBIE_BOB_AMPLITUDE = 0.06;
const ZOMBIE_BOB_SPEED = 9;     // rad/sec for walk bob
const ZOMBIE_BREACH_DIST = 0.45;  // bunker lost if zombie reaches its assigned window
const ZOMBIE_DIR_CHANGE_DIST = 2.5;   // world units walked before maybe changing direction
const ZOMBIE_DIR_CHANGE_CHANCE = 0.35; // probability to flip direction when threshold reached
const GAME_OVER_FLASH_DURATION = 0.6;
const ZOMBIE_SOUND_INTERVAL = 4;      // seconds between groans; deterministic from spawnIndex/spawnTime

let assets = {};
let score = 0;
let rifleFrame = 0;
let rifleState = 'idle';
let rifleFrameTime = 0;
let shotsInClip = RIFLE_CLIP_SIZE;
let clipsCarried = MAX_CLIPS;
let outOfAmmoMessageTime = 0;
let zombies = [];  // { x, y, z } in world space
let spawnTimer = 0;
let pointerLocked = false;
let gameOver = false;
let gameOverFlashStart = 0;
let hitFeedbackTime = 0;  // seconds to show hit reticule (CoD-style diagonal)
let audioContext = null;  // Web Audio API context for positional sounds
let gameTime = 0;        // seconds since start (for deterministic zombie sounds)
let spawnCounter = 0;    // increments per spawn so each zombie has a stable spawnIndex
let fogWispSprites = [];
let fogWispPositions = [];

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

function getFOV() {
  return isIronSightsActive() ? IRON_SIGHTS_FOV : FOV;
}

function isIronSightsActive() {
  return ironSightsHeld && rifleState !== 'reloading';
}

function project(wx, wy, wz) {
  const dx = wx - cameraX;
  const dy = wy - CAMERA_Y;
  const dz = wz - cameraZ;
  const { forward, right, up } = getViewVectors();
  const depth = dx * forward.x + dy * forward.y + dz * forward.z;
  if (depth <= NEAR) return null;
  const viewX = dx * right.x + dy * right.y + dz * right.z;
  const viewY = dx * up.x + dy * up.y + dz * up.z;
  const scale = (H / 2) / (Math.tan(getFOV() / 2) * depth);
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
const SFX_PICK_UP_PATH = 'assets/sfx/clean/pick_up.ogg';
const SFX_BOLT_OPEN_PATH = 'assets/sfx/clean/bolt_open.ogg';
const SFX_BOLT_CLOSE_PATH = 'assets/sfx/clean/bolt_close.ogg';
const FIRE_BOLT_OPEN_FRAME = 10;
const FIRE_BOLT_CLOSE_FRAME = 20;
const RELOAD_BOLT_OPEN_FRAME = 10;
const RELOAD_BOLT_CLOSE_FRAME = 60;
// Align reload sound so 0.65s in file matches frame 51 (1-indexed). Trigger at this 0-indexed frame.
const RELOAD_SOUND_ALIGN_FRAME = 51;   // 1-indexed (51st frame)
const RELOAD_SOUND_ALIGN_TIME = 0.65; // seconds into sound file at that frame
const RELOAD_SOUND_EARLY_OFFSET = 0.25; // start sound this many seconds earlier
const RELOAD_SOUND_TRIGGER_FRAME = Math.max(0, Math.floor((RELOAD_SOUND_ALIGN_FRAME - 1) - RELOAD_SOUND_ALIGN_TIME * RIFLE_FPS - RELOAD_SOUND_EARLY_OFFSET * RIFLE_FPS));

/** Extract ImageData from an image (for headshot mask sampling). Returns null if image not loaded. */
function imageDataFromImage(img) {
  if (!img?.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  return cx.getImageData(0, 0, c.width, c.height);
}

function generateFogWisps() {
  fogWispSprites = [];
  const size = FOG_WISP_SPRITE_SIZE;
  function seeded(initial) {
    let s = initial;
    return () => {
      s = (s * 1103515245 + 12345) >>> 0;
      return s / 0x100000000;
    };
  }
  const rng = seeded(12345);
  for (let n = 0; n < FOG_WISP_COUNT; n++) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const cx = c.getContext('2d');
    const particleCount = 35 + Math.floor(rng() * 25);
    for (let i = 0; i < particleCount; i++) {
      const u = rng();
      const v = rng();
      const x = size * (0.15 + u * 0.7);
      const yNorm = v < 0.55 ? v * 0.9 : 0.45 + (v - 0.55) * 1.2;
      const y = size * yNorm;
      const radBase = 0.08 + rng() * 0.22;
      const rad = size * radBase * (0.5 + 0.5 * (1 - yNorm));
      const alpha = 0.06 + rng() * 0.1;
      const grad = cx.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.4})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = grad;
      cx.beginPath();
      cx.arc(x, y, rad, 0, Math.PI * 2);
      cx.fill();
    }
    fogWispSprites.push(c);
  }
  fogWispPositions = [];
  const prng = seeded(67890);
  for (let i = 0; i < FOG_WISP_POSITIONS; i++) {
    const dist = 12 + prng() * 42;
    const baseAngle = prng() * Math.PI * 2;
    const rotSpeed = (prng() < 0.5 ? 1 : -1) * (0.5 + prng() * 0.6) * FOG_WISP_ROT_SPEED;
    fogWispPositions.push({
      dist,
      baseAngle,
      y: 0.1 + prng() * 0.35,
      spriteIndex: Math.floor(prng() * fogWispSprites.length),
      rotSpeed,
    });
  }
}

function generateTrees() {
  function seeded(initial) {
    let s = initial;
    return () => {
      s = (s * 1103515245 + 12345) >>> 0;
      return s / 0x100000000;
    };
  }
  const rng = seeded(99999);
  trees = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    const dist = TREE_MIN_DIST + rng() * (TREE_MAX_DIST - TREE_MIN_DIST);
    const angle = rng() * Math.PI * 2;
    const x = WORLD_CENTER_X + Math.cos(angle) * dist;
    const z = WORLD_CENTER_Z + Math.sin(angle) * dist;
    const spriteIndex = Math.floor(rng() * 14);
    trees.push({ x, z, spriteIndex, hp: TREE_HP });
  }
}

function generateBunkerLayout(layout = BUNKER_LAYOUT) {
  const slots = [];
  const halfW = (Math.max(layout.north, layout.south, 1) - 1) * BUNKER_SLOT_SPACING / 2 + 2.4;
  const halfD = (Math.max(layout.east, layout.west, 1) - 1) * BUNKER_SLOT_SPACING / 2 + 2.4;
  function addSide(side, count, baseYaw, fixedCoord, horizontal, reverse = false) {
    for (let i = 0; i < count; i++) {
      const logicalIndex = reverse ? (count - 1 - i) : i;
      const offset = (logicalIndex - (count - 1) / 2) * BUNKER_SLOT_SPACING;
      slots.push(horizontal
        ? { side, sideIndex: logicalIndex, type: 'window', x: WORLD_CENTER_X + offset, z: fixedCoord, baseYaw }
        : { side, sideIndex: logicalIndex, type: 'window', x: fixedCoord, z: WORLD_CENTER_Z + offset, baseYaw });
    }
  }
  addSide('north', layout.north, 0, WORLD_CENTER_Z - halfD + BUNKER_WALL_INSET, true);
  addSide('east', layout.east, Math.PI / 2, WORLD_CENTER_X + halfW - BUNKER_WALL_INSET, false);
  addSide('south', layout.south, Math.PI, WORLD_CENTER_Z + halfD - BUNKER_WALL_INSET, true, true);
  addSide('west', layout.west, -Math.PI / 2, WORLD_CENTER_X - halfW + BUNKER_WALL_INSET, false, true);

  const preferred = slots.filter((slot) => slot.side === BUNKER_CRATE_SIDE);
  const crateSlot = preferred[Math.floor(preferred.length / 2)] ?? slots[Math.floor(slots.length / 2)];
  if (crateSlot) crateSlot.type = 'crate';

  bunker = { halfW, halfD };
  bunkerSlots = slots;
  activeSlotIndex = Math.max(0, bunkerSlots.findIndex((slot) => slot.type === 'window'));
  setActiveBunkerSlot(activeSlotIndex, true);
}

function getCurrentBunkerSlot() {
  return bunkerSlots[activeSlotIndex] ?? null;
}

function getSideWallCoord(side) {
  if (!bunker) return 0;
  if (side === 'north') return WORLD_CENTER_Z - bunker.halfD;
  if (side === 'south') return WORLD_CENTER_Z + bunker.halfD;
  if (side === 'east') return WORLD_CENTER_X + bunker.halfW;
  return WORLD_CENTER_X - bunker.halfW;
}

function setActiveBunkerSlot(index, snap = false) {
  if (bunkerSlots.length === 0) return;
  activeSlotIndex = (index + bunkerSlots.length) % bunkerSlots.length;
  const slot = getCurrentBunkerSlot();
  desiredCameraX = slot.x;
  desiredCameraZ = slot.z;
  desiredYaw = slot.baseYaw;
  desiredPitch = 0;
  if (snap) {
    cameraX = desiredCameraX;
    cameraZ = desiredCameraZ;
    cameraYaw = desiredYaw;
    cameraPitch = 0;
  } else {
    cameraYaw = desiredYaw;
    cameraPitch = 0;
  }
}

function moveBunkerSlot(step) {
  if (bunkerSlots.length === 0) return;
  setActiveBunkerSlot(activeSlotIndex + step);
}

function getSlotWallCenter(slot) {
  return slot.side === 'north' || slot.side === 'south' ? slot.x : slot.z;
}

function getWindowOpeningsForSide(side) {
  return bunkerSlots
    .filter((slot) => slot.side === side && slot.type === 'window')
    .map((slot) => ({
      min: getSlotWallCenter(slot) - BUNKER_WINDOW_WIDTH / 2,
      max: getSlotWallCenter(slot) + BUNKER_WINDOW_WIDTH / 2,
      bottom: BUNKER_WINDOW_BOTTOM,
      top: BUNKER_WINDOW_TOP,
    }))
    .sort((a, b) => a.min - b.min);
}

function getWindowSlots() {
  return bunkerSlots.filter((slot) => slot.type === 'window');
}

function getZombieWindowTarget(slot) {
  if (!slot) return { x: WORLD_CENTER_X, z: WORLD_CENTER_Z };
  const wall = getSideWallCoord(slot.side);
  if (slot.side === 'north') return { x: slot.x, z: wall };
  if (slot.side === 'south') return { x: slot.x, z: wall };
  if (slot.side === 'east') return { x: wall, z: slot.z };
  return { x: wall, z: slot.z };
}

function chooseZombieTargetSlot(x, z) {
  const windows = getWindowSlots();
  if (windows.length === 0) return null;
  let best = windows[0];
  let bestDistSq = Infinity;
  for (const slot of windows) {
    const target = getZombieWindowTarget(slot);
    const dx = target.x - x;
    const dz = target.z - z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = slot;
    }
  }
  return best;
}

function worldToView(wx, wy, wz) {
  const dx = wx - cameraX;
  const dy = wy - CAMERA_Y;
  const dz = wz - cameraZ;
  const { forward, right, up } = getViewVectors();
  return {
    x: dx * right.x + dy * right.y + dz * right.z,
    y: dx * up.x + dy * up.y + dz * up.z,
    depth: dx * forward.x + dy * forward.y + dz * forward.z,
  };
}

function projectViewPoint(v) {
  const scale = (H / 2) / (Math.tan(getFOV() / 2) * v.depth);
  return {
    sx: W / 2 + v.x * scale,
    sy: H / 2 - v.y * scale,
    depth: v.depth,
  };
}

function clipPolygonToNear(viewPoints) {
  const clipped = [];
  for (let i = 0; i < viewPoints.length; i++) {
    const a = viewPoints[i];
    const b = viewPoints[(i + 1) % viewPoints.length];
    const aInside = a.depth >= NEAR;
    const bInside = b.depth >= NEAR;
    if (aInside) clipped.push(a);
    if (aInside !== bInside) {
      const t = (NEAR - a.depth) / (b.depth - a.depth);
      clipped.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        depth: NEAR,
      });
    }
  }
  return clipped;
}

function pushPolygon(polys, points, fill, stroke = null) {
  const viewPoints = clipPolygonToNear(points.map((p) => worldToView(p.x, p.y, p.z)));
  if (viewPoints.length < 3) return;
  const projected = viewPoints.map(projectViewPoint);
  const avgDepth = viewPoints.reduce((sum, p) => sum + p.depth, 0) / viewPoints.length;
  polys.push({ projected, avgDepth, fill, stroke });
}

function drawProjectedPolygon(poly) {
  const { projected, fill, stroke } = poly;
  ctx.beginPath();
  ctx.moveTo(projected[0].sx, projected[0].sy);
  for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i].sx, projected[i].sy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function getShotDirection(px, py) {
  const { forward, right, up } = getViewVectors();
  const xScale = ((px - W / 2) * Math.tan(getFOV() / 2)) / (H / 2);
  const yScale = (-(py - H / 2) * Math.tan(getFOV() / 2)) / (H / 2);
  const dir = {
    x: forward.x + right.x * xScale + up.x * yScale,
    y: forward.y + right.y * xScale + up.y * yScale,
    z: forward.z + right.z * xScale + up.z * yScale,
  };
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
  return { x: dir.x / len, y: dir.y / len, z: dir.z / len };
}

function shotLeavesThroughWindow(px, py) {
  if (!bunker) return true;
  const dir = getShotDirection(px, py);
  const origin = { x: cameraX, y: CAMERA_Y, z: cameraZ };
  const EPS = 1e-5;
  const hits = [];

  if (dir.z < -EPS) hits.push({ side: 'north', t: (getSideWallCoord('north') - origin.z) / dir.z });
  if (dir.z > EPS) hits.push({ side: 'south', t: (getSideWallCoord('south') - origin.z) / dir.z });
  if (dir.x > EPS) hits.push({ side: 'east', t: (getSideWallCoord('east') - origin.x) / dir.x });
  if (dir.x < -EPS) hits.push({ side: 'west', t: (getSideWallCoord('west') - origin.x) / dir.x });

  const first = hits
    .filter((hit) => hit.t > EPS)
    .map((hit) => {
      const x = origin.x + dir.x * hit.t;
      const y = origin.y + dir.y * hit.t;
      const z = origin.z + dir.z * hit.t;
      return { ...hit, x, y, z };
    })
    .filter((hit) => {
      if (hit.side === 'north' || hit.side === 'south') {
        return hit.x >= WORLD_CENTER_X - bunker.halfW - EPS && hit.x <= WORLD_CENTER_X + bunker.halfW + EPS;
      }
      return hit.z >= WORLD_CENTER_Z - bunker.halfD - EPS && hit.z <= WORLD_CENTER_Z + bunker.halfD + EPS;
    })
    .sort((a, b) => a.t - b.t)[0];

  if (!first) return true;
  if (first.y <= BUNKER_WINDOW_BOTTOM || first.y >= BUNKER_WINDOW_TOP) return false;
  const coord = first.side === 'north' || first.side === 'south' ? first.x : first.z;
  return getWindowOpeningsForSide(first.side).some((opening) => coord >= opening.min && coord <= opening.max);
}

function getCrateAABB() {
  if (!bunker) return null;
  const crateSlot = bunkerSlots.find((slot) => slot.type === 'crate');
  if (!crateSlot) return null;
  const minX = WORLD_CENTER_X - bunker.halfW;
  const maxX = WORLD_CENTER_X + bunker.halfW;
  const minZ = WORLD_CENTER_Z - bunker.halfD;
  const maxZ = WORLD_CENTER_Z + bunker.halfD;
  let crateMinX, crateMaxX, crateMinZ, crateMaxZ;
  if (crateSlot.side === 'north' || crateSlot.side === 'south') {
    crateMinX = crateSlot.x - BUNKER_CRATE_WIDTH / 2;
    crateMaxX = crateSlot.x + BUNKER_CRATE_WIDTH / 2;
    if (crateSlot.side === 'north') {
      crateMinZ = minZ + 0.08;
      crateMaxZ = crateMinZ + BUNKER_CRATE_DEPTH;
    } else {
      crateMaxZ = maxZ - 0.08;
      crateMinZ = crateMaxZ - BUNKER_CRATE_DEPTH;
    }
  } else {
    crateMinZ = crateSlot.z - BUNKER_CRATE_WIDTH / 2;
    crateMaxZ = crateSlot.z + BUNKER_CRATE_WIDTH / 2;
    if (crateSlot.side === 'west') {
      crateMinX = minX + 0.08;
      crateMaxX = crateMinX + BUNKER_CRATE_DEPTH;
    } else {
      crateMaxX = maxX - 0.08;
      crateMinX = crateMaxX - BUNKER_CRATE_DEPTH;
    }
  }
  return {
    minX: crateMinX, maxX: crateMaxX,
    minY: 0, maxY: BUNKER_CRATE_HEIGHT,
    minZ: crateMinZ, maxZ: crateMaxZ,
  };
}

function isReticuleOnCrate(px, py) {
  const box = getCrateAABB();
  if (!box) return false;
  const dir = getShotDirection(px, py);
  const ox = cameraX;
  const oy = CAMERA_Y;
  const oz = cameraZ;
  const tx = 1 / dir.x;
  const tminX = dir.x >= 0 ? (box.minX - ox) * tx : (box.maxX - ox) * tx;
  const tmaxX = dir.x >= 0 ? (box.maxX - ox) * tx : (box.minX - ox) * tx;
  const ty = 1 / dir.y;
  const tminY = dir.y >= 0 ? (box.minY - oy) * ty : (box.maxY - oy) * ty;
  const tmaxY = dir.y >= 0 ? (box.maxY - oy) * ty : (box.minY - oy) * ty;
  const tz = 1 / dir.z;
  const tminZ = dir.z >= 0 ? (box.minZ - oz) * tz : (box.maxZ - oz) * tz;
  const tmaxZ = dir.z >= 0 ? (box.maxZ - oz) * tz : (box.minZ - oz) * tz;
  const t0 = Math.max(tminX, tminY, tminZ);
  const t1 = Math.min(tmaxX, tmaxY, tmaxZ);
  return t0 <= t1 && t1 > 1e-5;
}

function getTreeDrawInfo(t) {
  if (!assets.retrotree) return null;
  const top = project(t.x, TREE_HEIGHT, t.z);
  const base = project(t.x, 0, t.z);
  if (!top || !base || top.depth <= NEAR) return null;
  const screenH = base.sy - top.sy;
  const screenW = screenH;
  const { col, row } = getTreeGridCell(t.spriteIndex);
  return {
    sx: top.sx - screenW / 2,
    sy: top.sy,
    sw: screenW,
    sh: screenH,
    depth: top.depth,
    col,
    row,
  };
}

function getTreeGridCell(spriteIndex) {
  if (spriteIndex < 12) return { col: spriteIndex % 4, row: Math.floor(spriteIndex / 4) };
  return { col: spriteIndex === 12 ? 2 : 3, row: 3 };
}

async function loadAssets() {
  const base = 'assets';
  assets.rifleFire = await loadImage(`${base}/lee_enfield-Sheet.png`);
  assets.rifleReload = await loadImage(`${base}/lee_enfield_reload-Sheet.png`);
  assets.zombie = await loadImage(`${base}/german_zombie.png`);
  assets.zombieFront = await loadImage(`${base}/front_facing_zombie.png`);
  assets.zombiePickelhaube = await loadImage(`${base}/pickelhaube_zombie.png`);
  assets.zombieFemaleGhoul = await loadImage(`${base}/female_ghoul_in_nightgown.png`);
  assets.zombieSprites = [assets.zombie, assets.zombieFront, assets.zombiePickelhaube, assets.zombieFemaleGhoul].filter(Boolean);
  assets.zombieHeadshotMask = await loadImage(`${base}/german_zombie_headshot_area.png`);
  assets.zombieFrontHeadshotMask = await loadImage(`${base}/front_facing_zombie_headshot_area.png`);
  assets.zombiePickelhaubeHeadshotMask = await loadImage(`${base}/pickelhaube_zombie_headshot_area.png`);
  assets.zombieFemaleGhoulHeadshotMask = await loadImage(`${base}/female_ghoul_in_nightgown_headshot_area.png`);
  assets.zombieHeadshotData = imageDataFromImage(assets.zombieHeadshotMask);
  assets.zombieFrontHeadshotData = imageDataFromImage(assets.zombieFrontHeadshotMask);
  assets.zombiePickelhaubeHeadshotData = imageDataFromImage(assets.zombiePickelhaubeHeadshotMask);
  assets.zombieFemaleGhoulHeadshotData = imageDataFromImage(assets.zombieFemaleGhoulHeadshotMask);
  assets.retrotree = await loadImage(`${base}/RetroTree.png`);
  const ironBase = `${base}/lee-enfield_iron_sights`;
  assets.ironSightsFront = await loadImage(`${ironBase}/0_front.png`);
  assets.ironSightsRear = await loadImage(`${ironBase}/1_rear.png`);
  assets.ironSightsBarrel = await loadImage(`${ironBase}/2_barrel.png`);
  assets.ironSightsStock = await loadImage(`${ironBase}/3_stock.png`);
  assets.ironSightsStockEject = await loadImage(`${ironBase}/3_stock_eject.png`);
  assets.ironSights = [assets.ironSightsStock, assets.ironSightsBarrel, assets.ironSightsRear, assets.ironSightsFront].filter(Boolean);
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
  assets.pickUp = new Audio(SFX_PICK_UP_PATH);
  assets.pickUp.preload = 'auto';
  assets.boltOpen = new Audio(SFX_BOLT_OPEN_PATH);
  assets.boltOpen.preload = 'auto';
  assets.boltClose = new Audio(SFX_BOLT_CLOSE_PATH);
  assets.boltClose.preload = 'auto';
  const ZOMBIE_SOUND_NAMES = ['zombie_1', 'zombie_2', 'zombie_3', 'zombie_4', 'zombie_5'];
  const ZOMBIE_FEMALE_SOUND_NAMES = ['female_zombie_1', 'female_zombie_2', 'female_zombie_3', 'female_zombie_4'];
  assets.zombieSoundPaths = ZOMBIE_SOUND_NAMES.map((n) => `${base}/sfx/clean/${n}.ogg`);
  assets.zombieFemaleSoundPaths = ZOMBIE_FEMALE_SOUND_NAMES.map((n) => `${base}/sfx/clean/${n}.ogg`);
  generateFogWisps();
  generateTrees();
}

function playShotSound() {
  if (!assets.shotSounds || assets.shotSounds.length === 0) return;
  const which = Math.floor(Math.random() * assets.shotSounds.length);
  const snd = assets.shotSounds[which];
  snd.currentTime = 0;
  snd.volume = 1.0;
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
let boltOpenSoundPlayed = false;
let boltCloseSoundPlayed = false;

function playReloadSound() {
  if (!assets.reloadSound) return;
  assets.reloadSound.currentTime = 0;
  assets.reloadSound.play().catch(() => { });
}

function playPickUpSound() {
  if (!assets.pickUp) return;
  assets.pickUp.currentTime = 0;
  assets.pickUp.play().catch(() => { });
}

function playBoltOpenSound() {
  if (!assets.boltOpen) return;
  assets.boltOpen.currentTime = 0;
  assets.boltOpen.volume = 0.35;
  assets.boltOpen.play().catch(() => { });
}

function playBoltCloseSound() {
  if (!assets.boltClose) return;
  assets.boltClose.currentTime = 0;
  assets.boltClose.volume = 0.35;
  assets.boltClose.play().catch(() => { });
}

// ---- Positional audio (reusable for SFX, multiplayer, voice chat) ----
// Listener is at the current bunker slot facing cameraYaw. Sources at (worldX, worldZ) get gain + stereo pan.
// Gain uses inverse-square law: loudness falls off as 1/distance² so distant sources are much quieter.

const POSITIONAL_REF_DIST = 6;   // distance at which gain is 0.5 (reference for inverse-square)

/** Returns { gain, pan } for a source at (worldX, worldZ). Gain follows inverse-square law. */
function getPositionalGainPan(worldX, worldZ) {
  const dx = worldX - cameraX;
  const dz = worldZ - cameraZ;
  const distanceSq = dx * dx + dz * dz;
  const refSq = POSITIONAL_REF_DIST * POSITIONAL_REF_DIST;
  const gain = refSq / (refSq + Math.max(distanceSq, 0.01));
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
  const x = WORLD_CENTER_X + Math.cos(angle) * dist;
  const z = WORLD_CENTER_Z + Math.sin(angle) * dist;
  const targetSlot = chooseZombieTargetSlot(x, z);
  const target = getZombieWindowTarget(targetSlot);
  const sprite = assets.zombieSprites.length > 0
    ? assets.zombieSprites[Math.floor(Math.random() * assets.zombieSprites.length)]
    : assets.zombie;
  const spawnIndex = spawnCounter++;
  const spawnTime = gameTime;
  const useFemaleSounds = sprite === assets.zombieFemaleGhoul;
  const paths = useFemaleSounds ? assets.zombieFemaleSoundPaths : assets.zombieSoundPaths;
  const numPaths = paths?.length ?? 0;
  const speedMult = 0.7 + Math.random() * 0.6;
  zombies.push({
    x, y: 0, z, hp: ZOMBIE_HP_MAX,
    walkPhase: Math.random() * Math.PI * 2,
    walkDir: Math.random() < 0.5 ? 1 : -1,
    distanceWalked: 0,
    targetSide: targetSlot?.side ?? null,
    targetWindowX: target.x,
    targetWindowZ: target.z,
    speedMult,
    sprite,
    spriteW: sprite?.naturalWidth ?? ZOMBIE_SPRITE_W,
    spriteH: sprite?.naturalHeight ?? ZOMBIE_SPRITE_H,
    spawnIndex,
    spawnTime,
    lastSoundN: 0,   // 0 = played on spawn; next at n=1, 2, ...
    useFemaleSounds,
  });
  if (numPaths > 0) {
    const which = spawnIndex % numPaths;
    playPositionalSound(paths[which], x, z);
  }
}

function updateZombies(dt) {
  if (gameOver) return;
  for (const z of zombies) {
    const paths = z.useFemaleSounds ? assets.zombieFemaleSoundPaths : assets.zombieSoundPaths;
    const numPaths = paths?.length ?? 0;
    z.walkPhase = (z.walkPhase ?? 0) + dt * ZOMBIE_BOB_SPEED;
    z.bob = Math.sin(z.walkPhase) * ZOMBIE_BOB_AMPLITUDE;
    if (numPaths > 0) {
      const n = Math.floor((gameTime - z.spawnTime) / ZOMBIE_SOUND_INTERVAL);
      if (n > (z.lastSoundN ?? 0)) {
        z.lastSoundN = n;
        const which = (z.spawnIndex + n) % numPaths;
        playPositionalSound(paths[which], z.x, z.z);
      }
    }
    const targetX = z.targetWindowX ?? WORLD_CENTER_X;
    const targetZ = z.targetWindowZ ?? WORLD_CENTER_Z;
    const dx = targetX - z.x;
    const dz = targetZ - z.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    if (d < ZOMBIE_BREACH_DIST) {
      gameOver = true;
      gameOverFlashStart = performance.now() / 1000;
      return;
    }
    const ux = dx / d;
    const uz = dz / d;
    const perpX = -uz;
    const perpZ = ux;
    const walkDir = z.walkDir ?? 1;
    const zigzag = walkDir * Math.sin(z.walkPhase * ZOMBIE_ZIGZAG_SPEED) * ZOMBIE_ZIGZAG;
    const speed = ZOMBIE_SPEED * (z.speedMult ?? 1);
    const vx = (ux * speed + perpX * zigzag) * dt;
    const vz = (uz * speed + perpZ * zigzag) * dt;
    z.x += vx;
    z.z += vz;
    z.distanceWalked = (z.distanceWalked ?? 0) + Math.sqrt(vx * vx + vz * vz);
    if (z.distanceWalked >= ZOMBIE_DIR_CHANGE_DIST && Math.random() < ZOMBIE_DIR_CHANGE_CHANCE) {
      z.walkDir = -walkDir;
      z.distanceWalked = 0;
    }
  }
}

const HIT_FEEDBACK_DURATION = 0.18;  // seconds to show diagonal hit reticule

// Particle system (performance: caps, simple physics, small draw)
const MAX_PARTICLES = 1200;
const HOLE_RADIUS_SPRITE = 18;  // scaled for 132px-wide sprite (was 70 at 512)
const HOLE_JAGGED_POINTS = 24;
const HOLE_JAGGED_AMOUNT = 0.45;
const HOLE_PARTICLE_COUNT = 90;
const DEATH_GRID_STEP = 5;    // sample every N px for death pile (scaled from 20 at 512 width)
const PARTICLE_LIFE = 2.5;
const WORLD_GRAVITY = 18;      // world units/s² (y down)
const PARTICLE_BOUNCE = 0.35;
const PARTICLE_FRICTION = 0.82;
const PARTICLE_REST_VY = 0.5;
const PARTICLE_REST_VXZ = 0.5;

let particles = [];
let zombieSampleCanvas, zombieSampleCtx;
let holeCanvas, holeCtx;  // offscreen buffer for zombie-with-holes (true transparency)
let treeHoleCanvas, treeHoleCtx;  // 256x256 buffer for tree-with-holes
function ensureZombieSampleCanvas(w = ZOMBIE_SPRITE_W, h = ZOMBIE_SPRITE_H) {
  const needW = Math.max(w, 256);
  const needH = Math.max(h, 256);
  if (zombieSampleCtx && zombieSampleCanvas.width >= needW && zombieSampleCanvas.height >= needH) return;
  if (!zombieSampleCanvas || zombieSampleCanvas.width < needW || zombieSampleCanvas.height < needH) {
    zombieSampleCanvas = document.createElement('canvas');
    zombieSampleCanvas.width = needW;
    zombieSampleCanvas.height = needH;
    zombieSampleCtx = zombieSampleCanvas.getContext('2d');
  }
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
  const img = z.sprite || assets.zombie;
  if (!img || particles.length >= MAX_PARTICLES) return;
  const w = info.spriteW ?? ZOMBIE_SPRITE_W;
  const h = info.spriteH ?? ZOMBIE_SPRITE_H;
  ensureZombieSampleCanvas(w, h);
  zombieSampleCtx.clearRect(0, 0, w, h);
  zombieSampleCtx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  const idata = zombieSampleCtx.getImageData(0, 0, w, h);
  const hitTx = info.flip
    ? (info.sx + info.sw - hitPx) / info.sw * w
    : (hitPx - info.sx) / info.sw * w;
  const hitTy = ((hitPy - info.sy) / info.sh) * h;
  const t = Math.max(0, Math.min(1, (hitPy - info.sy) / info.sh));
  const worldY = z.y + (1 - t) * ZOMBIE_REF_HEIGHT;
  const maxR = Math.max(...jaggedRadii);
  let added = 0;
  for (let dy = -maxR; dy <= maxR && added < HOLE_PARTICLE_COUNT; dy += 2) {
    for (let dx = -maxR; dx <= maxR && added < HOLE_PARTICLE_COUNT; dx += 2) {
      if (!insideJaggedShape(dx, dy, jaggedRadii)) continue;
      const tx = Math.floor(hitTx + dx);
      const ty = Math.floor(hitTy + dy);
      if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
      const i = (ty * w + tx) * 4;
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
  const img = z.sprite || assets.zombie;
  if (!img || particles.length >= MAX_PARTICLES) return;
  const w = info.spriteW ?? ZOMBIE_SPRITE_W;
  const h = info.spriteH ?? ZOMBIE_SPRITE_H;
  ensureZombieSampleCanvas(w, h);
  zombieSampleCtx.clearRect(0, 0, w, h);
  zombieSampleCtx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
  const idata = zombieSampleCtx.getImageData(0, 0, w, h);
  const step = Math.max(DEATH_GRID_STEP, Math.floor(DEATH_GRID_STEP * w / ZOMBIE_SPRITE_W));
  for (let ty = 0; ty < h; ty += step) {
    for (let tx = 0; tx < w; tx += step) {
      const i = (ty * w + tx) * 4;
      const a = idata.data[i + 3];
      if (a < 10) continue;
      if (particles.length >= MAX_PARTICLES) return;
      const worldY = z.y + (1 - ty / h) * ZOMBIE_REF_HEIGHT;
      particles.push({
        wx: z.x + (tx / w - 0.5) * 0.4,
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
    const fogF = getFogFactor(proj.depth);
    const r = Math.round(p.r * (1 - fogF) + FOG_RGB.r * fogF);
    const g = Math.round(p.g * (1 - fogF) + FOG_RGB.g * fogF);
    const b = Math.round(p.b * (1 - fogF) + FOG_RGB.b * fogF);
    const a = (p.a / 255) * t * (1 - fogF);
    ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    ctx.fillRect(Math.floor(proj.sx), Math.floor(proj.sy), 2, 2);
  }
}

function isHeadPixel(data, i) {
  const a = data.data[i + 3];
  const r = data.data[i];
  const g = data.data[i + 1];
  const b = data.data[i + 2];
  return a > 64 && r < 140 && g < 140 && b < 140;
}

/** Black (and non-transparent) pixels in the headshot mask = head. hitTx/hitTy are already in sprite image space (flip is handled when computing them). Sample a small neighborhood so edge hits still count. */
function isHeadShotFromMask(z, info, hitTx, hitTy) {
  const spriteW = info.spriteW ?? ZOMBIE_SPRITE_W;
  const spriteH = info.spriteH ?? ZOMBIE_SPRITE_H;
  const data = z.sprite === assets.zombieFront ? assets.zombieFrontHeadshotData
    : z.sprite === assets.zombiePickelhaube ? assets.zombiePickelhaubeHeadshotData
      : z.sprite === assets.zombieFemaleGhoul ? assets.zombieFemaleGhoulHeadshotData
        : assets.zombieHeadshotData;
  if (!data) return false;
  const u = hitTx / spriteW;
  const v = hitTy / spriteH;
  const cx = Math.floor(u * data.width);
  const cy = Math.floor(v * data.height);
  const RAD = 1;
  for (let dy = -RAD; dy <= RAD; dy++) {
    for (let dx = -RAD; dx <= RAD; dx++) {
      const tx = Math.max(0, Math.min(data.width - 1, cx + dx));
      const ty = Math.max(0, Math.min(data.height - 1, cy + dy));
      const i = (ty * data.width + tx) * 4;
      if (isHeadPixel(data, i)) return true;
    }
  }
  return false;
}

function damageZombie(idx, hitPx, hitPy) {
  const z = zombies[idx];
  const info = getZombieDrawInfo(z);
  if (!info) return;
  const spriteW = info.spriteW ?? ZOMBIE_SPRITE_W;
  const spriteH = info.spriteH ?? ZOMBIE_SPRITE_H;
  const hitTx = info.flip
    ? (info.sx + info.sw - hitPx) / info.sw * spriteW
    : (hitPx - info.sx) / info.sw * spriteW;
  const hitTy = ((hitPy - info.sy) / info.sh) * spriteH;
  const headShot = isHeadShotFromMask(z, info, hitTx, hitTy);
  const damage = headShot ? ZOMBIE_DAMAGE_HEAD : ZOMBIE_DAMAGE_BODY;
  z.hp -= damage;
  hitFeedbackTime = HIT_FEEDBACK_DURATION;  // white reticule only when we actually damage an enemy
  const baseRadii = makeJaggedRadii();
  const jaggedRadii = baseRadii.map((r) => r * (spriteW / ZOMBIE_SPRITE_W));
  if (z.hp <= 0) {
    spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii);
    spawnDeathParticles(z, info);
    zombies.splice(idx, 1);
    score += 1;
    spawnTimer = 0;
  } else {
    if (!z.holes) z.holes = [];
    z.holes.push({ tx: hitTx, ty: hitTy, jaggedRadii });
    spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii);
  }
}

// Zombie sprite: flip from walk direction. Uses per-zombie sprite dimensions for aspect.
function getZombieDrawInfo(z) {
  const bob = z.bob ?? 0;
  const feetY = z.y + bob;
  const headY = z.y + ZOMBIE_REF_HEIGHT + bob;
  const headProj = project(z.x, headY, z.z);
  const feetProj = project(z.x, feetY, z.z);
  if (!headProj || headProj.depth <= NEAR || !feetProj) return null;
  const screenH = feetProj.sy - headProj.sy;
  const spriteW = z.spriteW ?? ZOMBIE_SPRITE_W;
  const spriteH = z.spriteH ?? ZOMBIE_SPRITE_H;
  const screenW = screenH * (spriteW / spriteH);
  return {
    sx: headProj.sx - screenW / 2,
    sy: headProj.sy,
    sw: screenW,
    sh: screenH,
    depth: headProj.depth,
    flip: (z.walkDir ?? 1) === -1,
    spriteW,
    spriteH,
  };
}

const PIXEL_HIT_ALPHA_THRESHOLD = 1;

function hitTestZombies(px, py) {
  if (!assets.zombieSprites?.length) return -1;
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

  const spriteToData = new Map();
  function getIdata(z, info) {
    const img = z.sprite || assets.zombie;
    const w = info.spriteW ?? ZOMBIE_SPRITE_W;
    const h = info.spriteH ?? ZOMBIE_SPRITE_H;
    const key = `${img?.src ?? ''}-${w}-${h}`;
    if (!spriteToData.has(key)) {
      ensureZombieSampleCanvas(w, h);
      zombieSampleCtx.clearRect(0, 0, w, h);
      zombieSampleCtx.drawImage(img, 0, 0, w, h, 0, 0, w, h);
      spriteToData.set(key, zombieSampleCtx.getImageData(0, 0, w, h));
    }
    return spriteToData.get(key);
  }

  for (const { i, info, z } of candidates) {
    const spriteW = info.spriteW ?? ZOMBIE_SPRITE_W;
    const spriteH = info.spriteH ?? ZOMBIE_SPRITE_H;
    const idata = getIdata(z, info);
    const tx = info.flip
      ? (info.sx + info.sw - px) / info.sw * spriteW
      : (px - info.sx) / info.sw * spriteW;
    const ty = (py - info.sy) / info.sh * spriteH;
    const txF = Math.floor(tx);
    const tyF = Math.floor(ty);
    if (txF < 0 || txF >= spriteW || tyF < 0 || tyF >= spriteH) continue;
    const idx = (tyF * spriteW + txF) * 4 + 3;
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
  // Pixel-perfect missed (e.g. transparent pixel); still count AABB hit so bullets register
  return candidates[0].i;
}

/** True if (px, py) hits opaque tree pixels (not transparent, not an existing hole). */
function treeBlocksPoint(t, info, px, py) {
  const hitTx = ((px - info.sx) / info.sw) * TREE_SPRITE_SIZE;
  const hitTy = ((py - info.sy) / info.sh) * TREE_SPRITE_SIZE;
  if (t.holes && t.holes.length > 0) {
    for (const hole of t.holes) {
      if (insideJaggedShape(hitTx - hole.tx, hitTy - hole.ty, hole.jaggedRadii)) return false;
    }
  }
  if (!assets.retrotree) return false;
  if (!treeHoleCanvas || treeHoleCanvas.width !== TREE_SPRITE_SIZE || treeHoleCanvas.height !== TREE_SPRITE_SIZE) {
    treeHoleCanvas = document.createElement('canvas');
    treeHoleCanvas.width = TREE_SPRITE_SIZE;
    treeHoleCanvas.height = TREE_SPRITE_SIZE;
    treeHoleCtx = treeHoleCanvas.getContext('2d');
  }
  const { col, row } = getTreeGridCell(t.spriteIndex);
  treeHoleCtx.drawImage(
    assets.retrotree,
    col * TREE_SPRITE_SIZE,
    row * TREE_SPRITE_SIZE,
    TREE_SPRITE_SIZE,
    TREE_SPRITE_SIZE,
    0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE
  );
  const idata = treeHoleCtx.getImageData(0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE);
  const tx = Math.floor(hitTx);
  const ty = Math.floor(hitTy);
  if (tx < 0 || tx >= TREE_SPRITE_SIZE || ty < 0 || ty >= TREE_SPRITE_SIZE) return false;
  const alpha = idata.data[(ty * TREE_SPRITE_SIZE + tx) * 4 + 3];
  return alpha >= PIXEL_HIT_ALPHA_THRESHOLD;
}

/** Returns { type: 'zombie'|'tree', index } for the closest hit, or null. */
function getHitTarget(px, py) {
  const candidates = [];
  const zombieIdx = hitTestZombies(px, py);
  if (zombieIdx >= 0) {
    const info = getZombieDrawInfo(zombies[zombieIdx]);
    if (info) candidates.push({ type: 'zombie', index: zombieIdx, depth: info.depth });
  }
  for (let i = 0; i < trees.length; i++) {
    const info = getTreeDrawInfo(trees[i]);
    if (!info) continue;
    if (px >= info.sx && px <= info.sx + info.sw && py >= info.sy && py <= info.sy + info.sh) {
      if (treeBlocksPoint(trees[i], info, px, py)) {
        candidates.push({ type: 'tree', index: i, depth: info.depth });
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.depth - b.depth);
  return { type: candidates[0].type, index: candidates[0].index };
}

function spawnTreeHoleParticles(t, info, hitPx, hitPy, jaggedRadii) {
  if (!assets.retrotree || particles.length >= MAX_PARTICLES) return;
  const { col, row } = getTreeGridCell(t.spriteIndex);
  if (!treeHoleCanvas || treeHoleCanvas.width !== TREE_SPRITE_SIZE || treeHoleCanvas.height !== TREE_SPRITE_SIZE) {
    treeHoleCanvas = document.createElement('canvas');
    treeHoleCanvas.width = TREE_SPRITE_SIZE;
    treeHoleCanvas.height = TREE_SPRITE_SIZE;
    treeHoleCtx = treeHoleCanvas.getContext('2d');
  }
  treeHoleCtx.drawImage(
    assets.retrotree,
    col * TREE_SPRITE_SIZE,
    row * TREE_SPRITE_SIZE,
    TREE_SPRITE_SIZE,
    TREE_SPRITE_SIZE,
    0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE
  );
  const idata = treeHoleCtx.getImageData(0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE);
  const hitTx = ((hitPx - info.sx) / info.sw) * TREE_SPRITE_SIZE;
  const hitTy = ((hitPy - info.sy) / info.sh) * TREE_SPRITE_SIZE;
  const tNorm = Math.max(0, Math.min(1, (hitPy - info.sy) / info.sh));
  const worldY = (1 - tNorm) * TREE_HEIGHT;
  const maxR = Math.max(...jaggedRadii);
  let added = 0;
  for (let dy = -maxR; dy <= maxR && added < HOLE_PARTICLE_COUNT; dy += 2) {
    for (let dx = -maxR; dx <= maxR && added < HOLE_PARTICLE_COUNT; dx += 2) {
      if (!insideJaggedShape(dx, dy, jaggedRadii)) continue;
      const tx = Math.floor(hitTx + dx);
      const ty = Math.floor(hitTy + dy);
      if (tx < 0 || tx >= TREE_SPRITE_SIZE || ty < 0 || ty >= TREE_SPRITE_SIZE) continue;
      const i = (ty * TREE_SPRITE_SIZE + tx) * 4;
      const r = idata.data[i];
      const g = idata.data[i + 1];
      const b = idata.data[i + 2];
      const a = idata.data[i + 3];
      if (a < 10) continue;
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5);
      const speed = 2.5 + Math.random() * 2.5;
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        wx: t.x + (Math.random() - 0.5) * 0.1,
        wy: worldY + (Math.random() - 0.5) * 0.05,
        wz: t.z + (Math.random() - 0.5) * 0.1,
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

function damageTree(idx, hitPx, hitPy) {
  const t = trees[idx];
  const info = getTreeDrawInfo(t);
  if (!info) return;
  // no hit feedback for trees — white reticule only when damaging an enemy (zombie)
  const hitTx = ((hitPx - info.sx) / info.sw) * TREE_SPRITE_SIZE;
  const hitTy = ((hitPy - info.sy) / info.sh) * TREE_SPRITE_SIZE;
  t.hp = (t.hp ?? TREE_HP) - TREE_DAMAGE;
  const baseRadii = makeJaggedRadii();
  const jaggedRadii = baseRadii.map((r) => (r * (TREE_SPRITE_SIZE / ZOMBIE_SPRITE_W)) / 10);
  if (t.hp <= 0) {
    spawnTreeHoleParticles(t, info, hitPx, hitPy, jaggedRadii);
    trees.splice(idx, 1);
  } else {
    if (!t.holes) t.holes = [];
    t.holes.push({ tx: hitTx, ty: hitTy, jaggedRadii });
    spawnTreeHoleParticles(t, info, hitPx, hitPy, jaggedRadii);
  }
}

// ---- Drawing ----

function getFogFactor(depth) {
  const d = Math.max(0, depth - FOG_START);
  return 1 - Math.exp(-d * FOG_DENSITY);
}

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
  const hx = cameraX + (forward.x / lenXZ) * far;
  const hz = cameraZ + (forward.z / lenXZ) * far;
  const horizonProj = project(hx, 0, hz);
  const horizonY = horizonProj ? horizonProj.sy : H / 2;
  const floorHorizon = Math.floor(horizonY);
  const groundH = Math.max(0, H - floorHorizon);
  ctx.fillStyle = GROUND_COLOR;
  ctx.fillRect(0, floorHorizon, W, groundH);
  const fog = ctx.createLinearGradient(0, floorHorizon, 0, H);
  fog.addColorStop(0, FOG_COLOR + '80');
  fog.addColorStop(1, FOG_COLOR + '00');
  ctx.fillStyle = fog;
  ctx.fillRect(0, floorHorizon, W, groundH);
}

function drawFogWisps() {
  if (fogWispSprites.length === 0 || fogWispPositions.length === 0) return;
  const visible = fogWispPositions
    .map((w) => {
      const angle = w.baseAngle + gameTime * w.rotSpeed;
      const x = WORLD_CENTER_X + Math.cos(angle) * w.dist;
      const z = WORLD_CENTER_Z + Math.sin(angle) * w.dist;
      const p = project(x, w.y, z);
      return p ? { ...w, proj: p } : null;
    })
    .filter(Boolean);
  visible.sort((a, b) => b.proj.depth - a.proj.depth);
  for (const w of visible) {
    const size = (FOG_WISP_SPRITE_SIZE * FOG_WISP_REF_DEPTH) / w.proj.depth;
    const fogF = getFogFactor(w.proj.depth);
    const alpha = FOG_WISP_BASE_ALPHA * fogF;
    if (alpha < 0.02) continue;
    const img = fogWispSprites[w.spriteIndex];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, 0, 0, FOG_WISP_SPRITE_SIZE, FOG_WISP_SPRITE_SIZE, w.proj.sx - size / 2, w.proj.sy - size / 2, size, size);
    ctx.restore();
  }
}

function drawTrees() {
  if (!assets.retrotree) return;
  const visible = trees
    .map((t) => {
      const top = project(t.x, TREE_HEIGHT, t.z);
      const base = project(t.x, 0, t.z);
      if (!top || !base || top.depth <= NEAR) return null;
      const screenH = base.sy - top.sy;
      const screenW = screenH;
      return {
        ...t,
        sx: top.sx - screenW / 2,
        sy: top.sy,
        sw: screenW,
        sh: screenH,
        depth: top.depth,
      };
    })
    .filter(Boolean);
  visible.sort((a, b) => b.depth - a.depth);
  const HOLE_EDGE_ALPHA_THRESHOLD_TREE = 10;
  for (const t of visible) {
    const { col, row } = getTreeGridCell(t.spriteIndex);
    const fogF = getFogFactor(t.depth);
    ctx.save();
    ctx.globalAlpha = 1 - fogF;
    if (t.holes && t.holes.length > 0) {
      if (!treeHoleCanvas || treeHoleCanvas.width !== TREE_SPRITE_SIZE || treeHoleCanvas.height !== TREE_SPRITE_SIZE) {
        treeHoleCanvas = document.createElement('canvas');
        treeHoleCanvas.width = TREE_SPRITE_SIZE;
        treeHoleCanvas.height = TREE_SPRITE_SIZE;
        treeHoleCtx = treeHoleCanvas.getContext('2d');
      }
      treeHoleCtx.clearRect(0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE);
      treeHoleCtx.drawImage(
        assets.retrotree,
        col * TREE_SPRITE_SIZE,
        row * TREE_SPRITE_SIZE,
        TREE_SPRITE_SIZE,
        TREE_SPRITE_SIZE,
        0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE
      );
      const spriteData = treeHoleCtx.getImageData(0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE);
      for (const hole of t.holes) {
        const hx = hole.tx;
        const hy = hole.ty;
        treeHoleCtx.beginPath();
        if (hole.jaggedRadii && hole.jaggedRadii.length > 0) {
          for (let i = 0; i < hole.jaggedRadii.length; i++) {
            const angle = (i / hole.jaggedRadii.length) * 2 * Math.PI;
            const r = hole.jaggedRadii[i];
            const px = hx + Math.cos(angle) * r;
            const py = hy + Math.sin(angle) * r;
            if (i === 0) treeHoleCtx.moveTo(px, py);
            else treeHoleCtx.lineTo(px, py);
          }
          treeHoleCtx.closePath();
        }
        treeHoleCtx.globalCompositeOperation = 'destination-out';
        treeHoleCtx.fillStyle = 'rgba(0,0,0,1)';
        treeHoleCtx.fill();
        treeHoleCtx.globalCompositeOperation = 'source-over';
        treeHoleCtx.strokeStyle = '#000';
        treeHoleCtx.lineWidth = 1;
        if (hole.jaggedRadii && hole.jaggedRadii.length >= 2) {
          const n = hole.jaggedRadii.length;
          for (let i = 0; i < n; i++) {
            const angle0 = (i / n) * 2 * Math.PI;
            const angle1 = ((i + 1) / n) * 2 * Math.PI;
            const v0x = hx + Math.cos(angle0) * hole.jaggedRadii[i];
            const v0y = hy + Math.sin(angle0) * hole.jaggedRadii[i];
            const v1x = hx + Math.cos(angle1) * hole.jaggedRadii[(i + 1) % n];
            const v1y = hy + Math.sin(angle1) * hole.jaggedRadii[(i + 1) % n];
            const mx = (v0x + v1x) / 2;
            const my = (v0y + v1y) / 2;
            const dx = mx - hx;
            const dy = my - hy;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const outX = mx + (dx / len) * 2;
            const outY = my + (dy / len) * 2;
            const tx = Math.max(0, Math.min(TREE_SPRITE_SIZE - 1, Math.floor(outX)));
            const ty = Math.max(0, Math.min(TREE_SPRITE_SIZE - 1, Math.floor(outY)));
            const idx = (ty * TREE_SPRITE_SIZE + tx) * 4 + 3;
            if (spriteData.data[idx] > HOLE_EDGE_ALPHA_THRESHOLD_TREE) {
              treeHoleCtx.beginPath();
              treeHoleCtx.moveTo(v0x, v0y);
              treeHoleCtx.lineTo(v1x, v1y);
              treeHoleCtx.stroke();
            }
          }
        }
      }
      ctx.drawImage(treeHoleCanvas, 0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE, t.sx, t.sy, t.sw, t.sh);
    } else {
      ctx.drawImage(
        assets.retrotree,
        col * TREE_SPRITE_SIZE,
        row * TREE_SPRITE_SIZE,
        TREE_SPRITE_SIZE,
        TREE_SPRITE_SIZE,
        t.sx,
        t.sy,
        t.sw,
        t.sh
      );
    }
    ctx.restore();
  }
}

function drawZombies() {
  if (!assets.zombieSprites?.length) return;
  const withInfo = zombies.map((z) => ({ z, info: getZombieDrawInfo(z) })).filter((o) => o.info);
  withInfo.sort((a, b) => b.info.depth - a.info.depth);
  for (const { z, info } of withInfo) {
    const fogF = getFogFactor(info.depth);
    ctx.save();
    ctx.globalAlpha = 1 - fogF;
    const img = z.sprite || assets.zombieSprites[0];
    const spriteW = info.spriteW ?? ZOMBIE_SPRITE_W;
    const spriteH = info.spriteH ?? ZOMBIE_SPRITE_H;
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
      holeCtx.drawImage(img, 0, 0, spriteW, spriteH, 0, 0, info.sw, info.sh);
      const holeRadiusScreen = (HOLE_RADIUS_SPRITE / ZOMBIE_SPRITE_W) * info.sw;
      ensureZombieSampleCanvas(spriteW, spriteH);
      zombieSampleCtx.clearRect(0, 0, spriteW, spriteH);
      zombieSampleCtx.drawImage(img, 0, 0, spriteW, spriteH, 0, 0, spriteW, spriteH);
      const spriteData = zombieSampleCtx.getImageData(0, 0, spriteW, spriteH);
      const HOLE_EDGE_ALPHA_THRESHOLD = 10;
      for (const hole of z.holes) {
        const hx = (hole.tx / spriteW) * info.sw;
        const hy = (hole.ty / spriteH) * info.sh;
        const scaleX = info.sw / spriteW;
        const scaleY = info.sh / spriteH;
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
            const sx = Math.floor((outX / info.sw) * spriteW);
            const sy = Math.floor((outY / info.sh) * spriteH);
            const tx = Math.max(0, Math.min(spriteW - 1, sx));
            const ty = Math.max(0, Math.min(spriteH - 1, sy));
            const idx = (ty * spriteW + tx) * 4 + 3;
            if (spriteData.data[idx] > HOLE_EDGE_ALPHA_THRESHOLD) {
              holeCtx.beginPath();
              holeCtx.moveTo(v0.x, v0.y);
              holeCtx.lineTo(v1.x, v1.y);
              holeCtx.stroke();
            }
          }
        }
      }
      if (info.flip) {
        ctx.save();
        ctx.translate(info.sx + info.sw, info.sy);
        ctx.scale(-1, 1);
        ctx.drawImage(holeCanvas, 0, 0, info.sw, info.sh, 0, 0, info.sw, info.sh);
        ctx.restore();
      } else {
        ctx.drawImage(holeCanvas, 0, 0, info.sw, info.sh, info.sx, info.sy, info.sw, info.sh);
      }
    } else {
      if (info.flip) {
        ctx.save();
        ctx.translate(info.sx + info.sw, info.sy);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, spriteW, spriteH, 0, 0, info.sw, info.sh);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, spriteW, spriteH, info.sx, info.sy, info.sw, info.sh);
      }
    }
    ctx.restore();
  }
}

function drawBunkerInterior() {
  if (!bunker) return;

  const polys = [];
  const wallColor = '#1e1712';
  const wallShade = '#2a2119';
  const trimColor = '#564536';
  const floorColor = '#1a1511';
  const ceilingColor = '#100c09';
  const crateFront = '#765235';
  const crateSide = '#5b3f29';
  const crateTop = '#8e6944';

  const minX = WORLD_CENTER_X - bunker.halfW;
  const maxX = WORLD_CENTER_X + bunker.halfW;
  const minZ = WORLD_CENTER_Z - bunker.halfD;
  const maxZ = WORLD_CENTER_Z + bunker.halfD;

  pushPolygon(polys, [
    { x: minX, y: 0.02, z: minZ },
    { x: maxX, y: 0.02, z: minZ },
    { x: maxX, y: 0.02, z: maxZ },
    { x: minX, y: 0.02, z: maxZ },
  ], floorColor);
  pushPolygon(polys, [
    { x: minX, y: BUNKER_WALL_HEIGHT, z: maxZ },
    { x: maxX, y: BUNKER_WALL_HEIGHT, z: maxZ },
    { x: maxX, y: BUNKER_WALL_HEIGHT, z: minZ },
    { x: minX, y: BUNKER_WALL_HEIGHT, z: minZ },
  ], ceilingColor);

  function pushWallRect(side, from, to, y0, y1, fill) {
    if (to - from < 0.02 || y1 - y0 < 0.02) return;
    if (side === 'north') {
      pushPolygon(polys, [
        { x: from, y: y0, z: minZ },
        { x: to, y: y0, z: minZ },
        { x: to, y: y1, z: minZ },
        { x: from, y: y1, z: minZ },
      ], fill, trimColor);
    } else if (side === 'south') {
      pushPolygon(polys, [
        { x: to, y: y0, z: maxZ },
        { x: from, y: y0, z: maxZ },
        { x: from, y: y1, z: maxZ },
        { x: to, y: y1, z: maxZ },
      ], fill, trimColor);
    } else if (side === 'east') {
      pushPolygon(polys, [
        { x: maxX, y: y0, z: from },
        { x: maxX, y: y0, z: to },
        { x: maxX, y: y1, z: to },
        { x: maxX, y: y1, z: from },
      ], fill, trimColor);
    } else {
      pushPolygon(polys, [
        { x: minX, y: y0, z: to },
        { x: minX, y: y0, z: from },
        { x: minX, y: y1, z: from },
        { x: minX, y: y1, z: to },
      ], fill, trimColor);
    }
  }

  function addWallSide(side) {
    const openings = getWindowOpeningsForSide(side);
    const rangeMin = side === 'north' || side === 'south' ? minX : minZ;
    const rangeMax = side === 'north' || side === 'south' ? maxX : maxZ;
    let cursor = rangeMin;
    for (const opening of openings) {
      pushWallRect(side, cursor, opening.min, 0, BUNKER_WALL_HEIGHT, wallColor);
      pushWallRect(side, opening.min, opening.max, 0, opening.bottom, wallShade);
      pushWallRect(side, opening.min, opening.max, opening.top, BUNKER_WALL_HEIGHT, wallShade);
      cursor = opening.max;
    }
    pushWallRect(side, cursor, rangeMax, 0, BUNKER_WALL_HEIGHT, wallColor);
  }

  addWallSide('north');
  addWallSide('east');
  addWallSide('south');
  addWallSide('west');

  const crateSlot = bunkerSlots.find((slot) => slot.type === 'crate');
  if (crateSlot) {
    let crateMinX;
    let crateMaxX;
    let crateMinZ;
    let crateMaxZ;
    if (crateSlot.side === 'north' || crateSlot.side === 'south') {
      crateMinX = crateSlot.x - BUNKER_CRATE_WIDTH / 2;
      crateMaxX = crateSlot.x + BUNKER_CRATE_WIDTH / 2;
      if (crateSlot.side === 'north') {
        crateMinZ = minZ + 0.08;
        crateMaxZ = crateMinZ + BUNKER_CRATE_DEPTH;
      } else {
        crateMaxZ = maxZ - 0.08;
        crateMinZ = crateMaxZ - BUNKER_CRATE_DEPTH;
      }
    } else {
      crateMinZ = crateSlot.z - BUNKER_CRATE_WIDTH / 2;
      crateMaxZ = crateSlot.z + BUNKER_CRATE_WIDTH / 2;
      if (crateSlot.side === 'west') {
        crateMinX = minX + 0.08;
        crateMaxX = crateMinX + BUNKER_CRATE_DEPTH;
      } else {
        crateMaxX = maxX - 0.08;
        crateMinX = crateMaxX - BUNKER_CRATE_DEPTH;
      }
    }
    const crateY1 = BUNKER_CRATE_HEIGHT;
    pushPolygon(polys, [
      { x: crateMinX, y: 0, z: crateMinZ },
      { x: crateMaxX, y: 0, z: crateMinZ },
      { x: crateMaxX, y: crateY1, z: crateMinZ },
      { x: crateMinX, y: crateY1, z: crateMinZ },
    ], crateSide, '#3f2b1b');
    pushPolygon(polys, [
      { x: crateMaxX, y: 0, z: crateMinZ },
      { x: crateMaxX, y: 0, z: crateMaxZ },
      { x: crateMaxX, y: crateY1, z: crateMaxZ },
      { x: crateMaxX, y: crateY1, z: crateMinZ },
    ], crateSide, '#3f2b1b');
    pushPolygon(polys, [
      { x: crateMinX, y: 0, z: crateMaxZ },
      { x: crateMinX, y: 0, z: crateMinZ },
      { x: crateMinX, y: crateY1, z: crateMinZ },
      { x: crateMinX, y: crateY1, z: crateMaxZ },
    ], crateSide, '#3f2b1b');
    pushPolygon(polys, [
      { x: crateMinX, y: crateY1, z: crateMinZ },
      { x: crateMaxX, y: crateY1, z: crateMinZ },
      { x: crateMaxX, y: crateY1, z: crateMaxZ },
      { x: crateMinX, y: crateY1, z: crateMaxZ },
    ], crateTop, '#3f2b1b');
    pushPolygon(polys, [
      { x: crateMinX, y: 0, z: crateMaxZ },
      { x: crateMaxX, y: 0, z: crateMaxZ },
      { x: crateMaxX, y: crateY1, z: crateMaxZ },
      { x: crateMinX, y: crateY1, z: crateMaxZ },
    ], crateFront, '#3f2b1b');
  }

  polys.sort((a, b) => b.avgDepth - a.avgDepth);
  for (const poly of polys) drawProjectedPolygon(poly);
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
      if (!boltOpenSoundPlayed && rifleFrame >= FIRE_BOLT_OPEN_FRAME) {
        playBoltOpenSound();
        boltOpenSoundPlayed = true;
      }
      if (!boltCloseSoundPlayed && rifleFrame >= FIRE_BOLT_CLOSE_FRAME) {
        playBoltCloseSound();
        boltCloseSoundPlayed = true;
      }
      if (rifleFrame >= RIFLE_FIRE_FRAME_COUNT) {
        rifleFrame = 0;
        shotsInClip -= 1;
        rifleState = 'idle';
      }
    }
  } else if (rifleState === 'reloading') {
    if (rifleFrameTime >= frameDuration) {
      const nextFrame = rifleFrame + 1;
      const frozen = nextFrame > RELOAD_FREEZE_FRAME && clipsCarried === 0;
      if (!frozen) {
        rifleFrameTime -= frameDuration;
        rifleFrame = nextFrame;
        if (!boltOpenSoundPlayed && rifleFrame >= RELOAD_BOLT_OPEN_FRAME) {
          playBoltOpenSound();
          boltOpenSoundPlayed = true;
        }
        if (!boltCloseSoundPlayed && rifleFrame >= RELOAD_BOLT_CLOSE_FRAME) {
          playBoltCloseSound();
          boltCloseSoundPlayed = true;
        }
        if (!reloadSoundPlayed && rifleFrame >= RELOAD_SOUND_TRIGGER_FRAME) {
          playReloadSound();
          reloadSoundPlayed = true;
        }
        if (rifleFrame >= RIFLE_RELOAD_FRAME_COUNT) {
          rifleFrame = 0;
          shotsInClip = RIFLE_CLIP_SIZE;
          if (clipsCarried > 0) clipsCarried -= 1;
          rifleState = 'idle';
        }
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
  const reticulePx = W / 2 + ro.x;
  const reticulePy = H / 2 + ro.y;
  const pointingAtCrate = getCurrentBunkerSlot()?.type === 'crate' && isReticuleOnCrate(reticulePx, reticulePy);
  const GUN_LOWERED_OFFSET_Y = 140;
  let rifleShiftX = (ro.x + RETICULE_CLAMP_X) * GUN_PX_PER_RETICULE_PX;
  let rifleShiftY = (ro.y + RETICULE_CLAMP_Y) * GUN_PX_PER_RETICULE_PX_Y;
  if (pointingAtCrate) rifleShiftY += GUN_LOWERED_OFFSET_Y;
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

  if (isIronSightsActive() && assets.ironSights?.length === 4) {
    const baseX = W / 2 - IRON_SIGHTS_AIM_X;
    let baseY = H / 2 - IRON_SIGHTS_AIM_Y;
    if (pointingAtCrate) baseY += GUN_LOWERED_OFFSET_Y;
    const layerDepth = [
      IRON_SIGHTS_DEPTH.stock,
      IRON_SIGHTS_DEPTH.barrel,
      IRON_SIGHTS_DEPTH.rear,
      IRON_SIGHTS_DEPTH.front,
    ];
    const rigidX = ro.x * IRON_SIGHTS_RIGID_RESPONSE;
    const rigidY = ro.y * IRON_SIGHTS_RIGID_RESPONSE - ironSightsRecoilKick;
    for (let i = 3; i >= 0; i--) {
      let img = assets.ironSights[i];
      if (!img?.naturalWidth) continue;
      let srcX = 0;
      let srcW = img.naturalWidth;
      let drawW = img.naturalWidth;
      if (i === 0 && rifleState === 'firing' && assets.ironSightsStockEject?.naturalWidth) {
        img = assets.ironSightsStockEject;
        srcW = assets.ironSightsStock?.naturalWidth ?? Math.floor(img.naturalWidth / RIFLE_FIRE_FRAME_COUNT);
        drawW = srcW;
        const ejectFrameCount = Math.max(1, Math.floor(img.naturalWidth / srcW));
        srcX = Math.min(frameIndex, ejectFrameCount - 1) * srcW;
      }
      const px = baseX + layerDepth[i] * rigidX;
      const py = baseY + layerDepth[i] * rigidY;
      ctx.drawImage(img, srcX, 0, srcW, img.naturalHeight, Math.floor(px), Math.floor(py), drawW, img.naturalHeight);
    }
  } else {
    ctx.drawImage(sheet, sx, 0, RIFLE_FRAME_W, RIFLE_FRAME_H, rifleShiftX, rifleShiftY, rw, rh);
  }
}

const FONT_FAMILY = 'Zpix';
const FONT_SIZE = 24;  // multiples of 12 for pixel font

function drawScore() {
  ctx.fillStyle = '#aaa';
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.fillText(`Score: ${score}`, 12, FONT_SIZE + 4);
  ctx.fillText(`Clips: ${clipsCarried}/${MAX_CLIPS}`, 12, FONT_SIZE * 2 + 4);
}

function drawOutOfAmmoMessage() {
  if (outOfAmmoMessageTime <= 0) return;
  const alpha = Math.min(1, outOfAmmoMessageTime * 2);
  ctx.fillStyle = `rgba(255, 200, 100, ${alpha})`;
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('Out of ammo', W / 2, H - 32);
  ctx.textAlign = 'left';
}

function drawPositionLabel() {
  const slot = getCurrentBunkerSlot();
  if (!slot) return;
  ctx.fillStyle = '#aaa';
  ctx.font = `${Math.floor(FONT_SIZE * 0.7)}px ${FONT_FAMILY}`;
  const label = slot.type === 'crate' ? 'Ammo Crate' : `${slot.side[0].toUpperCase()}${slot.side.slice(1)} Window`;
  ctx.fillText(label, 12, FONT_SIZE * 2 + 22);
}

function drawReticule() {
  if (!pointerLocked) return;
  const ro = getReticuleOffset();
  const cx = Math.round(W / 2 + ro.x);
  const cy = Math.round(H / 2 + ro.y);
  const slot = getCurrentBunkerSlot();
  const pointingAtCrate = slot?.type === 'crate' && isReticuleOnCrate(cx, cy);

  if (pointingAtCrate) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = `28px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2340', cx, cy);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return;
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
  ctx.font = `${Math.floor(FONT_SIZE * 0.65)}px ${FONT_FAMILY}`;
  ctx.fillText('Move between windows with A/D or Left/Right', W / 2, H / 2 + 26);
  ctx.textAlign = 'left';
}

function drawGameOver() {
  const elapsed = performance.now() / 1000 - gameOverFlashStart;
  const flash = Math.max(0, 1 - elapsed / GAME_OVER_FLASH_DURATION);
  const alpha = 0.4 + 0.5 * flash;
  ctx.fillStyle = `rgba(180, 0, 0, ${alpha})`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.font = `${FONT_SIZE * 2}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('BUNKER OVERRUN', W / 2, H / 2 - 6);
  ctx.font = `${Math.floor(FONT_SIZE * 0.65)}px ${FONT_FAMILY}`;
  ctx.fillText('A zombie got through a window', W / 2, H / 2 + 18);
  ctx.textAlign = 'left';
}

function draw() {
  drawSky();
  drawGround();
  drawFogWisps();
  drawTrees();
  drawZombies();
  drawParticles();
  drawBunkerInterior();
  if (!gameOver) drawRifle(1 / 60);
  drawScore();
  drawPositionLabel();
  drawReticule();
  drawOutOfAmmoMessage();
  if (gameOver) drawGameOver();
  else if (!pointerLocked) drawHint();
}

function tick(dt) {
  gameTime += dt;
  hitFeedbackTime = Math.max(0, hitFeedbackTime - dt);
  outOfAmmoMessageTime = Math.max(0, outOfAmmoMessageTime - dt);
  ironSightsRecoilKick *= IRON_SIGHTS_RECOIL_DECAY;
  updateParticles(dt);
  if (!gameOver) {
    spawnTimer += 1;
    if (spawnTimer >= SPAWN_DELAY) spawnZombie();
    updateZombies(dt);
  }
  const moveT = 1 - Math.exp(-BUNKER_MOVE_LERP * dt);
  cameraX += (desiredCameraX - cameraX) * moveT;
  cameraZ += (desiredCameraZ - cameraZ) * moveT;
  const chaseT = 1 - Math.exp(-CHASE_LERP * dt);
  cameraYaw += normalizeAngle(desiredYaw - cameraYaw) * chaseT;
  cameraPitch += (desiredPitch - cameraPitch) * chaseT;
  cameraPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraPitch));
  draw();
}

// ---- Input ----

const PITCH_LIMIT = Math.PI / 2 - 0.1;

canvas.addEventListener('click', (e) => {
  if (gameOver) return;
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  const ro = getReticuleOffset();
  const px = W / 2 + ro.x;
  const py = H / 2 + ro.y;
  const slot = getCurrentBunkerSlot();
  const pointingAtCrate = slot?.type === 'crate' && isReticuleOnCrate(px, py);

  if (pointingAtCrate) {
    playPickUpSound();
    clipsCarried = MAX_CLIPS;
    return;
  }

  if (rifleState !== 'idle') {
    playDryFireSound();
    return;
  }

  if (shotsInClip === 0 && clipsCarried === 0) {
    outOfAmmoMessageTime = OUT_OF_AMMO_MESSAGE_DURATION;
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    return;
  }

  if (shotsInClip === 0 && clipsCarried > 0) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    return;
  }

  const canSeeOutside = shotLeavesThroughWindow(px, py);

  if (shotsInClip > 1) {
    rifleState = 'firing';
    rifleFrame = 0;
    rifleFrameTime = 0;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    if (ironSightsHeld) ironSightsRecoilKick = IRON_SIGHTS_RECOIL_KICK;
    playShotSound();
    playEjectCasingSound();
    const hit = canSeeOutside ? getHitTarget(px, py) : null;
    if (hit) {
      if (hit.type === 'zombie') damageZombie(hit.index, px, py);
      else damageTree(hit.index, px, py);
    }
  } else if (shotsInClip === 1) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    if (ironSightsHeld) ironSightsRecoilKick = IRON_SIGHTS_RECOIL_KICK;
    playShotSound();
    playEjectCasingSound();
    const hit = canSeeOutside ? getHitTarget(px, py) : null;
    if (hit) {
      if (hit.type === 'zombie') damageZombie(hit.index, px, py);
      else damageTree(hit.index, px, py);
    }
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (!pointerLocked) {
    const slot = getCurrentBunkerSlot();
    desiredPitch = 0;
    cameraPitch = 0;
    if (slot) {
      desiredYaw = slot.baseYaw;
      cameraYaw = slot.baseYaw;
    } else {
      desiredYaw = 0;
      cameraYaw = 0;
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  const sens = isIronSightsActive() ? IRON_SIGHTS_SENS : 1;
  desiredYaw += e.movementX * MOUSE_SENS * sens;
  desiredPitch += e.movementY * PITCH_SENS * sens;   // mouse down -> look down (positive pitch), reticule leads then camera follows
  desiredPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, desiredPitch));
});

document.addEventListener('keydown', (e) => {
  if (gameOver) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    ironSightsHeld = true;
  } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
    e.preventDefault();
    moveBunkerSlot(-1);
  } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
    e.preventDefault();
    moveBunkerSlot(1);
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') ironSightsHeld = false;
});

function loop(now = 0) {
  const last = loop.last ?? now;
  const dt = Math.min((now - last) / 1000, 0.1);
  loop.last = now;
  tick(dt);
  requestAnimationFrame(loop);
}

(function main() {
  generateBunkerLayout();
  requestAnimationFrame(loop);
  loadAssets().catch((err) => console.error('Asset load failed:', err));
})();

