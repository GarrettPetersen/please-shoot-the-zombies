/**
 * Please Shoot the Zombies — minimal single-player 3D shooting gallery.
 * Player at fixed position, pivot with mouse (FPS-style). Zombies at 3D positions, scaled by distance.
 */

const worldCanvas = document.getElementById('world3d');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Resolution
const W = 455;
const H = 256;
if (worldCanvas) {
  worldCanvas.width = W;
  worldCanvas.height = H;
}
canvas.width = W;
canvas.height = H;

// Pixel art: nearest-neighbor scaling, no anti-aliasing on sprites
ctx.imageSmoothingEnabled = false;
let worldRenderer = null;
let worldStaticDirty = true;

// Steam (matchmaking, voice) — App ID for Please Shoot the Zombies
const STEAM_APP_ID = 4516500;

// 3D: bunker at world center; camera moves between discrete slots around it.
const WORLD_CENTER_X = 0;
const WORLD_CENTER_Z = 0;
const CAMERA_Y = 1.6;
let cameraX = WORLD_CENTER_X;
let cameraZ = WORLD_CENTER_Z;
let desiredCameraX = WORLD_CENTER_X;
let desiredCameraZ = WORLD_CENTER_Z;
let movementStartTime = null;  // gameTime when run between slots started
let movementStartX = 0;
let movementStartZ = 0;
let movementEndX = 0;
let movementEndZ = 0;
let movementPathPoints = [];
let movementPathLengths = [];
let movementPathTotalLength = 0;
let cameraYaw = 0;   // left-right (rotation around Y)
let cameraPitch = 0; // up-down

const FOV = Math.PI / 4.5;  // ~40° vertical FOV for tighter "window shooter" framing
const IRON_SIGHTS_FOV = Math.PI / 7.5;  // ~24° ADS
const IRON_SIGHTS_SENS = 0.35;  // cursor sensitivity multiplier when holding iron sights
const ASPECT = W / H;
const NEAR = 0.1;
const FAR = 500;

// World colors (set from horizon background image at load; these are fallbacks if no image)
let GROUND_COLOR = '#3d3d35';
let SKY_COLOR = '#2a3548';
const FOG_COLOR = '#3a4555';
const FOG_RGB = { r: 0x3a, g: 0x45, b: 0x55 };

// Horizon background: one source for tiled ring + derived sky/ground colors (swap path to change scene)
const HORIZON_BACKGROUND_PATH = 'backgrounds/spooky_forest.png';
const FOG_DENSITY = 0.028;
const FOG_START = 4;  // no fog this close; fog ramps in beyond
const FOG_WISP_COUNT = 5;        // number of wisp sprite variants
const FOG_WISP_POSITIONS = 116;  // world positions (orbit at various distances); doubled for more wisps
const FOG_WISP_SPRITE_SIZE = 96;
const FOG_WISP_REF_DEPTH = 25;  // reference depth for screen size
const FOG_WISP_BASE_ALPHA = 0.18;
const FOG_WISP_ROT_SPEED = 0.026;  // rad/sec; each wisp gets ± this (clockwise vs counterclockwise)

// Bunker layouts: arbitrary polygons defined in wall-tile units.
// Each edge gets one sprite key per 1-tile segment. Ammo only on perimeter (never on interior walls) so players can reach it clockwise/counterclockwise. Tally near ammo (can be on interior).
const BUNKER_LAYOUTS = {
  // Narrow L: one wall-segment-wide corridor everywhere.
  l_redoubt: {
    id: 'l_redoubt',
    name: 'L Redoubt',
    unitCorners: [
      { x: -8, z: -5 },
      { x: 5, z: -5 },
      { x: 5, z: -4 },
      { x: -7, z: -4 },
      { x: -7, z: 5 },
      { x: -8, z: 5 },
    ],
    segmentTiles: [
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window'],
      ['wall', 'window', 'wall', 'door', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall'],
      ['wall', 'wall', 'window', 'wall'],
      ['wall', 'ammo', 'wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall'],
    ],
  },
  // Smallest: one door, ammo behind it, no other openings. Tally near crate.
  shooting_gallery: {
    id: 'shooting_gallery',
    name: 'Shooting Gallery',
    unitCorners: [
      { x: -2, z: -2 },
      { x: 2, z: -2 },
      { x: 2, z: 2 },
      { x: -2, z: 2 },
    ],
    segmentTiles: [
      ['wall', 'door', 'ammo', 'wall'],
      ['wall', 'wall', 'wall', 'wall'],
      ['wall', 'wall', 'wall', 'wall'],
      ['wall', 'wall', 'wall', 'wall'],
    ],
  },
  // 1×2 units: ammo, tally, 4 openings.
  small_1x2: {
    id: 'small_1x2',
    name: 'Small 1×2',
    unitCorners: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
      { x: 1, z: 2 },
      { x: 0, z: 2 },
    ],
    segmentTiles: [
      ['window'],
      ['ammo', 'window'],
      ['window'],
      ['window', 'wall'],
    ],
  },
  // Zigzag: L with another bend the other way (S shape).
  zigzag: {
    id: 'zigzag',
    name: 'Zigzag',
    unitCorners: [
      { x: -8, z: -5 },
      { x: 5, z: -5 },
      { x: 5, z: -4 },
      { x: -2, z: -4 },
      { x: -2, z: 2 },
      { x: 2, z: 2 },
      { x: 2, z: 3 },
      { x: -8, z: 3 },
    ],
    segmentTiles: [
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'window'],
      ['wall', 'window', 'wall', 'door', 'wall', 'window', 'wall', 'wall', 'window', 'wall', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window'],
      ['wall', 'window'],
      ['wall', 'ammo', 'wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall'],
    ],
  },
  // Pentagon with non-right angles; interior keep loop so main area is hallway-width around inner wall.
  pentagon_rampart: {
    id: 'pentagon_rampart',
    name: 'Pentagon Rampart',
    unitCorners: [
      { x: 0, z: -5 },
      { x: 4.76, z: -1.55 },
      { x: 2.94, z: 4.05 },
      { x: -2.94, z: 4.05 },
      { x: -4.76, z: -1.55 },
    ],
    segmentTiles: [
      ['wall', 'window', 'wall', 'ammo', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'wall'],
    ],
    interiorWallLoops: [
      {
        points: [
          { x: 0, z: -2 },
          { x: 1.9, z: -0.62 },
          { x: 1.18, z: 1.62 },
          { x: -1.18, z: 1.62 },
          { x: -1.9, z: -0.62 },
        ],
        segmentTiles: [
          ['wall', 'wall', 'wall'],
          ['wall', 'wall', 'wall'],
          ['wall', 'wall', 'wall'],
          ['wall', 'wall', 'wall'],
          ['wall', 'wall', 'wall'],
        ],
      },
    ],
  },
  // Star fort: points poking out for overlapping fields of fire; interior keep loop so you can't see across.
  star_fort: {
    id: 'star_fort',
    name: 'Star Fort',
    unitCorners: [
      { x: 0, z: -6 },
      { x: 2.5, z: -2 },
      { x: 6, z: 0 },
      { x: 2.5, z: 2 },
      { x: 0, z: 6 },
      { x: -2.5, z: 2 },
      { x: -6, z: 0 },
      { x: -2.5, z: -2 },
    ],
    segmentTiles: [
      ['wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'wall'],
      ['wall', 'ammo', 'wall', 'window', 'wall'],
      ['wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'wall'],
    ],
    interiorWallLoops: [
      {
        points: [
          { x: 0, z: -2 },
          { x: 1.41, z: -1.41 },
          { x: 2, z: 0 },
          { x: 1.41, z: 1.41 },
          { x: 0, z: 2 },
          { x: -1.41, z: 1.41 },
          { x: -2, z: 0 },
          { x: -1.41, z: -1.41 },
        ],
        segmentTiles: [
          ['wall', 'wall'],
          ['wall', 'wall'],
          ['wall', 'wall'],
          ['wall', 'wall'],
          ['wall', 'wall'],
          ['wall', 'wall'],
          ['wall', 'wall'],
          ['wall', 'wall'],
        ],
      },
    ],
  },
  rectangle_fort: {
    id: 'rectangle_fort',
    name: 'Rectangle Fort',
    unitCorners: [
      { x: -7, z: -4 },
      { x: 5, z: -4 },
      { x: 5, z: 4 },
      { x: -7, z: 4 },
    ],
    segmentTiles: [
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall', 'window', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall', 'ammo', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall'],
    ],
  },
  horseshoe_keep: {
    id: 'horseshoe_keep',
    name: 'Horseshoe Keep',
    unitCorners: [
      { x: -7, z: -4 },
      { x: 5, z: -4 },
      { x: 5, z: 4 },
      { x: 2, z: 4 },
      { x: 2, z: -1 },
      { x: -4, z: -1 },
      { x: -4, z: 4 },
      { x: -7, z: 4 },
    ],
    interiorHoles: [
      [{ x: -4, z: -1 }, { x: 2, z: -1 }, { x: 2, z: 4 }, { x: -4, z: 4 }],
    ],
    segmentTiles: [
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall', 'window', 'wall', 'window', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window', 'wall', 'wall'],
      ['wall', 'window', 'wall'],
      ['wall', 'door', 'wall', 'window', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'window'],
      ['wall', 'door', 'wall', 'window', 'wall'],
      ['wall', 'window', 'wall'],
      ['wall', 'window', 'wall', 'window', 'wall', 'ammo', 'wall', 'wall'],
    ],
  },
};
const DEFAULT_BUNKER_LAYOUT_ID = 'l_redoubt';
const BUNKER_SLOT_SPACING = 4.5;
const BUNKER_WALL_INSET = 2.8;
const BUNKER_MOVE_LERP = 10;
const BUNKER_MOVE_DURATION = 2;  // seconds to run between slots
const RUN_BOB_STEPS_PER_SEC = 2.4;
const RUN_BOB_LEFT = 28;   // gun held left (running pose)
const RUN_BOB_DOWN = 72;   // gun held low
const RUN_BOB_SWAY = 52;   // horizontal swing (arms)
const RUN_BOB_BOUNCE = 22; // vertical dip per step
const BUNKER_CRATE_SIDE = 'south';
const BUNKER_EMPTY_WALL_SIDE = 'west';
const BUNKER_WALL_HEIGHT = 2.85;
const BUNKER_WALL_TILE_SCALE = 1.6; // scales wall sprite aspect into world-space tile width
  const BUNKER_WALL_TEXTURE_SLICES = 24;
  const BUNKER_WALL_ALPHA_PASS_THRESHOLD = 8;
  const BUNKER_INTER_STATION_WALL_TILES = 1; // non-walkable spacer walls between walkable stations
const BUNKER_CORNER_WALL_TILES = 1; // extra wall tiles at each corner so windows sit away from corners
const BUNKER_PEEK_MAX_YAW = 1.42;             // very wide peek (~81°)
const BUNKER_PEEK_WINDOW_MARGIN = 0.12;       // keep center ray away from window edges/frame
const BUNKER_PEEK_FORWARD_PUSH_MAX = 0.35;    // slight forward push while peeking hard
const BUNKER_PEEK_FADE_START_YAW = 1.05;      // start fading pivot when turning away from own window
const BUNKER_PEEK_FADE_END_YAW = 1.75;        // fully centered again by this yaw (~100°)
const BUNKER_WINDOW_WIDTH = 1.9;
const BUNKER_WINDOW_BOTTOM = 0.9;
const BUNKER_WINDOW_TOP = 2.15;
const BUNKER_FLOOR_Y = 0.02;
/** Max distance (world units) between two slots for partial voice volume when no wall blocks. Beyond this = no audio. */
const VOICE_PARTIAL_MAX_DISTANCE_MULTIPLIER = 2.5;  // in units of bunkerTileWorldWidth
/** Volumes below this are stored and treated as 0 so we don't send barely audible audio over the network. */
const VOICE_MIN_VOLUME_THRESHOLD = 0.2;
const BUNKER_CRATE_WIDTH = 1.9;
const BUNKER_CRATE_HEIGHT = 1.15;
const BUNKER_CRATE_DEPTH = 0.95;
const BOARDS_PER_WINDOW = 3;
const BOARD_PLACE_DURATION = 2.5;
const BOARD_ATTACK_DURATION = 5;
const BOARD_BREACH_DELAY = 2;
const BOARD_AT_WINDOW_DIST = 0.8;
const BOARD_TILT_MAX = 0.12;          // max tilt in rad (~7°) so boards stay horizontal
const BOARD_WINDOW_Y_LOW = 1.0;       // hip height and up (no boards below hip)
const BOARD_WINDOW_Y_MID = 1.45;
const BOARD_WINDOW_Y_HIGH = 1.9;
const BOARD_FALL_DURATION = 1.5;      // seconds for board to fall when broken
let bunker = null;
let bunkerSlots = [];
/** Precomputed at game start: slotVoiceVolumeMatrix[i][j] = 1 (same), 0.5 (partial), or 0 (distant/wall between). */
let slotVoiceVolumeMatrix = null;
let bunkerWallTiles = { north: [], east: [], south: [], west: [] };
let bunkerWallSegments = [];
let bunkerTileWorldWidth = BUNKER_SLOT_SPACING;
let activeSlotIndex = 0;
let windowBoards = {};  // slotKey -> number of boards on window (0–3); floor has remainder
let boardPlaceState = null;  // { slotKey, startTime, endTime } while placing
let fallingBoards = [];    // { slotKey, startTime, endTime, fromPos, toPos, rot, flip }

// Trees: 4x4 grid of 256x256 sprites in RetroTree.png; bottom-left two cells (0,3),(1,3) empty → 14 variants
const TREE_SPRITE_SIZE = 256;
const TREE_GRID_COLS = 4;
const TREE_GRID_ROWS = 4;
const TREE_HEIGHT = 16;           // world units; tuned to sit closer to zombie scale and perspective
const TREE_BASE_SINK_RATIO = 0.06; // sprite bottoms have a little transparent padding; sink into ground slightly
const TREE_MIN_DIST = 22;
const TREE_MAX_DIST = 55;
const TREE_COUNT = 32;
const TREE_HP = 100;
const TREE_DAMAGE = 1;   // body only; no headshot, so trees rarely "fully explode"
const TREE_HOLE_RADIUS_SCALE = 0.2;
let trees = [];
let nextTreeId = 1;

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
const IRON_SIGHTS_MAX_OFFSET = 38;   // clamp aim offset so the 4 sprites don't separate visibly
const IRON_SIGHTS_DEPTH = { front: 0.5, rear: 0.15, barrel: -0.35, stock: -1.25 };
const IRON_SIGHTS_RECOIL_KICK = 42;
const IRON_SIGHTS_RECOIL_DECAY = 0.72;
let ironSightsHeld = false;
let ironSightsRecoilKick = 0;
const RELOAD_FREEZE_FRAME = 22;   // freeze here when out of clips until restocked
const OUT_OF_AMMO_MESSAGE_DURATION = 1.5;
const UPGRADE_SPITZER_AT = 100;
const UPGRADE_MAD_MINUTE_AT = 200;
const UPGRADE_MESSAGE_DURATION = 4;
const ZOMBIE_RAY_RADIUS = 0.45;   // for Spitzer pass-through ray test

// Zombie: 3D position, sprite size and reference at distance
const ZOMBIE_REF_HEIGHT = 1.8;  // world units (height of zombie)
const ZOMBIE_REF_DIST = 10;     // distance at which zombie appears at "normal" screen size
const ZOMBIE_SPRITE_W = 132;
const ZOMBIE_SPRITE_H = 256;
const ZOMBIE_HP_MAX = 3;
const ZOMBIE_DAMAGE_BODY = 1;
const ZOMBIE_DAMAGE_HEAD = 3;

// Spawn: start far away; they walk toward player
const SPAWN_MIN_DIST = 58;
const SPAWN_MAX_DIST = 112;
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
const GAME_OVER_FACE_DURATION = 2;  // seconds of zombie face + red tint before showing "game over" text
const ENDGAME_RESULTS_DELAY = 3; // seconds before stats/button appear
const ZOMBIE_SOUND_INTERVAL = 4;      // seconds between groans; deterministic from spawnIndex/spawnTime
const GAME_PARAM_SEED = 13371337;
const GAME_PARAM_WAVE_COUNT = 11;
const WAVE_TRIANGLE_CONSTANT = 3;
const WAVE_TRIANGLE_OFFSET = 1; // waveSize = constant + T(waveIndex1Based + offset)
const WAVE_SPAWN_INTERVAL = 1.3;
const WAVE_GAP_BASE_SECONDS = 5.6;
const WAVE_GAP_WAVE_STEP_SECONDS = 0.7;
const WAVE_HOT_WINDOW_WEIGHT = 0.72;
const WAVE_HOT_SEGMENT_WEIGHT = 0.16;
const ZOMBIE_COUNT_MULTIPLIER = 20;
const ZOMBIE_MIN_PATH_LENGTH = 46;
const TREE_BLOCK_RADIUS = 0.9;

let assets = {};
let score = 0;
let rifleFrame = 0;
let rifleState = 'idle';
let rifleFrameTime = 0;
let shotsInClip = RIFLE_CLIP_SIZE;
let clipsCarried = MAX_CLIPS;
let outOfAmmoMessageTime = 0;
let outOfAmmoMessageText = 'Out of ammo';
let outOfAmmoShownCrateHint = false;
let upgradeMessageTime = 0;
let upgradeMessageLines = [];
let upgradeSpitzerShown = false;
let upgradeMadMinuteShown = false;
let zombies = [];  // { x, y, z } in world space
let zombieSpawnPlan = [];
let nextZombiePlanIndex = 0;
let pointerLocked = false;
let gameOver = false;
let gameOverFlashStart = 0;
let gameOverZombie = null;  // zombie that breached (for face + sound)
let gameWon = false;
let gameWonAt = 0;
let hitFeedbackTime = 0;  // seconds to show hit reticule (CoD-style diagonal)
let audioContext = null;  // Web Audio API context for positional sounds
let gameTime = 0;        // seconds since start (for deterministic zombie sounds)
let spawnCounter = 0;    // increments per spawn so each zombie has a stable spawnIndex
let fogWispSprites = [];
let fogWispPositions = [];
let gameParams = null;
let gameParamsHash = '';
let tallyWallTileRef = null; // { segmentIndex, tileIndex }
let tallyWallLastKilled = -1;
let tallyWallLastRemaining = -1;
const BOARD_BREAK_ALERT_DURATION = 10; // seconds
let boardBreakAlerts = []; // [{ slotKey, expiresAt }]
let playerMatchStats = new Map(); // playerId -> { playerId,name,isBot,kills,boards,headshots,shotsFired,shotsHit }
let leaderboardScrollRow = 0;
let endgameReturnButton = null; // { x,y,w,h }
let appMode = 'menu'; // 'menu' | 'game'

const MENU_BUTTON_W = 290;
const MENU_BUTTON_H = 24;
const MENU_BUTTON_GAP = 7;
const MENU_PAN_SPEED = 6; // px/sec at base resolution
const MENU_LANGUAGES = {
  en: {
    titleMain: 'Please Shoot the Z0mbies',
    subtitleMain: 'Defend the bunker',
    startLocal: 'Start Local Game',
    playOnline: 'Multiplayer',
    options: 'Options',
    back: 'Back',
    hostPublic: 'Host Public Match',
    hostPrivate: 'Host Private Match',
    joinPublic: 'Join Public Match',
    joinPrivate: 'Join Private Match (Code)',
    language: 'Language',
    settingsTitle: 'Match Settings',
    privacy: 'Privacy',
    bunker: 'Bunker',
    maxPlayers: 'Max Players',
    difficulty: 'Difficulty',
    createMatch: 'Create Match',
    lobbyTitle: 'Match Lobby',
    lobbyWaiting: 'Waiting for players',
    lobbyStart: 'Start Match',
    lobbyLeave: 'Leave Lobby',
    lobbyJoinCode: 'Join Code',
    lobbyPlayers: 'Players',
    lobbyHostOnly: 'Only host can start',
    publicLabel: 'Public',
    privateLabel: 'Private',
    onLabel: 'On',
    offLabel: 'Off',
    diffNormal: 'Normal',
    diffHard: 'Hard',
    diffNightmare: 'Nightmare',
    statusMpSoon: 'Multiplayer setup in progress',
    statusStartingLocal: 'Starting local game',
    statusHostSoon: 'Hosting flow coming next',
    statusJoinSoon: 'Join flow coming next',
    statusConnecting: 'Connecting to server',
    statusConnected: 'Connected',
    statusHosted: 'Match hosted',
    statusJoined: 'Joined match',
    statusMatchCreating: 'Creating match',
    statusMatchStarting: 'Starting match',
    statusWaitingInLobby: 'Waiting in lobby',
    statusLeftLobby: 'Left lobby',
    statusHostFailed: 'Could not host match',
    statusJoinFailed: 'Could not join match',
    statusNoPublic: 'No public matches available',
    statusNeedCode: 'Join code required',
    statusSocketClosed: 'Disconnected from match server',
  },
  es: {
    titleMain: 'Please Shoot the Z0mbies',
    subtitleMain: 'Defiende el bunker',
    startLocal: 'Iniciar partida local',
    playOnline: 'Multijugador',
    options: 'Opciones',
    back: 'Atras',
    hostPublic: 'Crear partida publica',
    hostPrivate: 'Crear partida privada',
    joinPublic: 'Unirse publica',
    joinPrivate: 'Unirse privada (codigo)',
    language: 'Idioma',
    settingsTitle: 'Configuracion de partida',
    privacy: 'Privacidad',
    bunker: 'Bunker',
    maxPlayers: 'Max jugadores',
    difficulty: 'Dificultad',
    createMatch: 'Crear partida',
    lobbyTitle: 'Sala de partida',
    lobbyWaiting: 'Esperando jugadores',
    lobbyStart: 'Iniciar partida',
    lobbyLeave: 'Salir de la sala',
    lobbyJoinCode: 'Codigo',
    lobbyPlayers: 'Jugadores',
    lobbyHostOnly: 'Solo el host puede iniciar',
    publicLabel: 'Publica',
    privateLabel: 'Privada',
    onLabel: 'Si',
    offLabel: 'No',
    diffNormal: 'Normal',
    diffHard: 'Dificil',
    diffNightmare: 'Pesadilla',
    statusMpSoon: 'Multijugador en progreso',
    statusStartingLocal: 'Iniciando partida local',
    statusHostSoon: 'Crear partida pronto',
    statusJoinSoon: 'Unirse pronto',
    statusConnecting: 'Conectando al servidor',
    statusConnected: 'Conectado',
    statusHosted: 'Partida creada',
    statusJoined: 'Unido a la partida',
    statusMatchCreating: 'Creando partida',
    statusMatchStarting: 'Iniciando partida',
    statusWaitingInLobby: 'Esperando en sala',
    statusLeftLobby: 'Saliste de la sala',
    statusHostFailed: 'No se pudo crear la partida',
    statusJoinFailed: 'No se pudo unir',
    statusNoPublic: 'No hay partidas publicas',
    statusNeedCode: 'Se requiere codigo',
    statusSocketClosed: 'Desconectado del servidor',
  },
};
let menuLanguage = 'en';
let menuPage = 'main';
let menuSelectedIndex = 0;
let menuHoverIndex = -1;
let menuPanX = 0;
let menuButtons = [];
let menuToast = '';
let menuToastUntil = 0;
let confirmMainMenuOpen = false;
const confirmMainMenuButtons = []; // updated when dialog draws
let currentBunkerLayoutId = DEFAULT_BUNKER_LAYOUT_ID;
const menuState = {
  matchSettings: {
    privacy: 'private',
    maxPlayers: 8,
    difficulty: 'normal',
    bunkerLayoutId: DEFAULT_BUNKER_LAYOUT_ID,
  },
};
const DEFAULT_MULTIPLAYER_HTTP_BASE = 'http://100.52.203.69:3000';
let multiplayerHttpBase = DEFAULT_MULTIPLAYER_HTTP_BASE;
let multiplayerWs = null;
let multiplayerSession = null; // { sessionId, playerId, joinCode, privacy, maxPlayers }
let multiplayerLobbyPlayers = []; // [{playerId,name,isHost,slotIndex}]
let multiplayerConnected = false;
let multiplayerAgreedHash = '';
let multiplayerGameSeed = GAME_PARAM_SEED;
let multiplayerWaveCount = GAME_PARAM_WAVE_COUNT;
let multiplayerBunkerLayoutId = DEFAULT_BUNKER_LAYOUT_ID;
let multiplayerStartAt = 0;
let pendingLossProposalId = '';
let multiplayerDisconnecting = false;
let multiplayerPlayers = new Map(); // playerId -> state
let multiplayerArrivalCounter = 1;
const MP_MOVE_DURATION = BUNKER_MOVE_DURATION;
const MP_BOB_SPEED = 8;
const MP_SPRITE_HEIGHT = 1.82;
const MP_QUEUE_SPACING = 0.38;

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

function t(key) {
  const table = MENU_LANGUAGES[menuLanguage] || MENU_LANGUAGES.en;
  return table[key] ?? MENU_LANGUAGES.en[key] ?? key;
}

try {
  const saved = window.localStorage?.getItem('multiplayerHttpBase');
  if (saved && /^https?:\/\//i.test(saved)) multiplayerHttpBase = saved.replace(/\/+$/, '');
} catch {
  // ignore storage errors
}

function getCanvasPointerPos(evt) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: W / 2, y: H / 2 };
  // Canvas is displayed with object-fit: contain, so clicks must be remapped
  // from the letterboxed DOM rect into the actual rendered game area.
  const targetAspect = W / H;
  const rectAspect = rect.width / rect.height;
  let drawW = rect.width;
  let drawH = rect.height;
  let offsetX = 0;
  let offsetY = 0;
  if (rectAspect > targetAspect) {
    drawH = rect.height;
    drawW = drawH * targetAspect;
    offsetX = (rect.width - drawW) * 0.5;
  } else if (rectAspect < targetAspect) {
    drawW = rect.width;
    drawH = drawW / targetAspect;
    offsetY = (rect.height - drawH) * 0.5;
  }
  const rawX = (evt.clientX - rect.left - offsetX) * (W / Math.max(1, drawW));
  const rawY = (evt.clientY - rect.top - offsetY) * (H / Math.max(1, drawH));
  return {
    x: Math.max(0, Math.min(W, rawX)),
    y: Math.max(0, Math.min(H, rawY)),
  };
}

function showMenuToast(text, duration = 1.5) {
  menuToast = text || '';
  menuToastUntil = performance.now() / 1000 + duration;
}

function cycleValue(options, current, dir = 1) {
  const idx = Math.max(0, options.indexOf(current));
  return options[(idx + dir + options.length) % options.length];
}

function setMenuPage(pageId) {
  menuPage = pageId;
  menuSelectedIndex = 0;
  menuHoverIndex = -1;
}

function getBunkerLayoutOptions() {
  return Object.values(BUNKER_LAYOUTS);
}

function getBunkerLayoutById(layoutId) {
  const id = String(layoutId || '');
  return BUNKER_LAYOUTS[id] || BUNKER_LAYOUTS[DEFAULT_BUNKER_LAYOUT_ID];
}

function getBunkerLayoutName(layoutId) {
  return getBunkerLayoutById(layoutId)?.name || getBunkerLayoutById(DEFAULT_BUNKER_LAYOUT_ID)?.name || 'Bunker';
}

function setCurrentBunkerLayout(layoutId) {
  const resolved = getBunkerLayoutById(layoutId);
  currentBunkerLayoutId = resolved.id;
  generateBunkerLayout(resolved);
}

function startLocalGame(opts = {}) {
  const seed = Number.isFinite(opts.seed) ? opts.seed : GAME_PARAM_SEED;
  const waveCount = Number.isFinite(opts.waveCount) ? opts.waveCount : GAME_PARAM_WAVE_COUNT;
  const bunkerLayoutId = String(opts.bunkerLayoutId || multiplayerBunkerLayoutId || currentBunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID);
  const playerCount = Math.max(1, Number.isFinite(opts.playerCount)
    ? Math.floor(opts.playerCount)
    : (multiplayerLobbyPlayers.length || 1));
  const agreedHash = typeof opts.agreedHash === 'string' ? opts.agreedHash : '';
  gameTime = 0;
  score = 0;
  rifleFrame = 0;
  rifleState = 'idle';
  rifleFrameTime = 0;
  shotsInClip = RIFLE_CLIP_SIZE;
  clipsCarried = MAX_CLIPS;
  outOfAmmoMessageTime = 0;
  outOfAmmoMessageText = 'Out of ammo';
  outOfAmmoShownCrateHint = false;
  upgradeMessageTime = 0;
  upgradeMessageLines = [];
  upgradeSpitzerShown = false;
  upgradeMadMinuteShown = false;
  reloadSoundPlayed = false;
  boltOpenSoundPlayed = false;
  boltCloseSoundPlayed = false;
  ironSightsHeld = false;
  ironSightsRecoilKick = 0;
  zombies = [];
  particles = [];
  tracers = [];
  hitFeedbackTime = 0;
  nextZombiePlanIndex = 0;
  spawnCounter = 0;
  gameOver = false;
  gameOverZombie = null;
  gameOverFlashStart = 0;
  gameWon = false;
  gameWonAt = 0;
  boardPlaceState = null;
  fallingBoards = [];
  movementStartTime = null;
  movementPathPoints = [];
  movementPathLengths = [];
  movementPathTotalLength = 0;
  pendingLossProposalId = '';
  boardBreakAlerts = [];
  resetMatchStats();
  syncMatchStatsRosterFromLobby();
  if (assets.runningSound) { assets.runningSound.pause(); assets.runningSound.currentTime = 0; }
  setCurrentBunkerLayout(bunkerLayoutId);

  const planned = generateGameParameters(seed, waveCount, playerCount);
  gameParams = planned.params;
  gameParamsHash = planned.hash;
  if (agreedHash && gameParamsHash !== agreedHash) {
    showMenuToast(`State hash mismatch (${gameParamsHash} != ${agreedHash})`, 2.2);
    appMode = 'menu';
    return false;
  }
  zombieSpawnPlan = gameParams.zombies ?? [];
  window.__gameParameters = gameParams;
  window.__gameParametersHash = gameParamsHash;
  generateTrees();
  initWindowBoards();
  tallyWallLastKilled = -1;
  tallyWallLastRemaining = -1;
  updateTallyWallTextures();

  activeSlotIndex = Math.max(0, bunkerSlots.findIndex((slot) => slot.type === 'window' || slot.type === 'crate'));
  setActiveBunkerSlot(activeSlotIndex, true);
  const localId = multiplayerSession?.playerId || '__local__';
  const me = ensureMpPlayer(localId, 'You');
  ensurePlayerMatchStats(localId, me.name || 'You', false);
  me.isLocal = true;
  me.slotIndex = activeSlotIndex;
  me.moveFromIndex = activeSlotIndex;
  me.moveToIndex = activeSlotIndex;
  me.moving = false;
  me.arrivalOrder = multiplayerArrivalCounter++;
  desiredPitch = 0;
  cameraPitch = 0;
  appMode = 'game';
  logBoardOrientations();
  return true;
}

function logBoardOrientations() {
  if (!bunkerSlots?.length) return;
  const rad2deg = (r) => (r * 180 / Math.PI).toFixed(1);
  console.log('[Board orientations] All wall boards should be up-and-down (vertical). rotation.y = -segmentYaw.');
  for (let i = 0; i < bunkerSlots.length; i++) {
    const slot = bunkerSlots[i];
    if (slot.type !== 'window') continue;
    const tx = slot.tangent?.x ?? 0;
    const tz = slot.tangent?.z ?? 0;
    const segmentYaw = Math.atan2(tz, tx);
    const rotationY = -segmentYaw;
    console.log(
      `  slot ${i} segment ${slot.segmentIndex}: tangent(${tx.toFixed(3)}, ${tz.toFixed(3)}) ` +
      `segmentYaw=${rad2deg(segmentYaw)}° rotation.y=${rad2deg(rotationY)}°`
    );
  }
}

function getPlayerNameForMatchmaking() {
  try {
    let name = window.localStorage?.getItem('playerDisplayName') || '';
    if (!name) {
      name = `Survivor-${Math.floor(1000 + Math.random() * 9000)}`;
      window.localStorage?.setItem('playerDisplayName', name);
    }
    return name;
  } catch {
    return `Survivor-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

function wsBaseFromHttp(httpUrl) {
  return String(httpUrl || '')
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://')
    .replace(/\/+$/, '');
}

async function apiJson(path, method = 'GET', body = undefined) {
  const url = `${multiplayerHttpBase.replace(/\/+$/, '')}${path}`;
  const init = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }
  return data;
}

function closeMultiplayerSocket() {
  multiplayerDisconnecting = true;
  if (multiplayerWs && multiplayerWs.readyState === WebSocket.OPEN) {
    try { multiplayerWs.send(JSON.stringify({ type: 'disconnect', at: Date.now() })); } catch {}
  }
  if (multiplayerWs) {
    try { multiplayerWs.close(1000, 'Client disconnect'); } catch {}
  }
  multiplayerWs = null;
  multiplayerConnected = false;
  multiplayerPlayers.clear();
  multiplayerLobbyPlayers = [];
  if (assets.runningSound) {
    try { assets.runningSound.pause(); assets.runningSound.currentTime = 0; } catch {}
  }
}

function sendMultiplayerPayload(type, payload = {}) {
  if (!multiplayerWs || multiplayerWs.readyState !== WebSocket.OPEN) return;
  if (!multiplayerSession?.sessionId || !multiplayerSession?.playerId) return;
  multiplayerWs.send(JSON.stringify({ type, ...payload }));
}

function setLobbyPlayers(players = []) {
  multiplayerLobbyPlayers = (players || []).map((p) => ({
    playerId: p.playerId,
    name: p.name || 'Player',
    isHost: !!p.isHost,
    isBot: !!p.isBot,
    slotIndex: Number.isFinite(p.slotIndex) ? Math.floor(p.slotIndex) : 0,
  }));
  syncMatchStatsRosterFromLobby();
}

function upsertLobbyPlayer(player) {
  if (!player?.playerId) return;
  const idx = multiplayerLobbyPlayers.findIndex((p) => p.playerId === player.playerId);
  const value = {
    playerId: player.playerId,
    name: player.name || 'Player',
    isHost: !!player.isHost,
    isBot: !!player.isBot,
    slotIndex: Number.isFinite(player.slotIndex) ? Math.floor(player.slotIndex) : 0,
  };
  if (idx >= 0) multiplayerLobbyPlayers[idx] = value;
  else multiplayerLobbyPlayers.push(value);
  ensurePlayerMatchStats(value.playerId, value.name, value.isBot);
}

function removeLobbyPlayer(playerId) {
  multiplayerLobbyPlayers = multiplayerLobbyPlayers.filter((p) => p.playerId !== playerId);
}

function isLobbyHost() {
  if (!multiplayerSession?.playerId) return false;
  const me = multiplayerLobbyPlayers.find((p) => p.playerId === multiplayerSession.playerId);
  return !!me?.isHost;
}

function startMatchFromLobby() {
  if (!multiplayerSession || !multiplayerConnected) return;
  if (!isLobbyHost()) {
    showMenuToast(t('lobbyHostOnly'), 1.4);
    return;
  }
  showMenuToast(t('statusMatchStarting'), 1.5);
  sendMultiplayerPayload('start_match', { at: Date.now() });
}

function leaveLobby() {
  closeMultiplayerSocket();
  multiplayerSession = null;
  multiplayerConnected = false;
  multiplayerAgreedHash = '';
  multiplayerBunkerLayoutId = menuState.matchSettings.bunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID;
  setCurrentBunkerLayout(multiplayerBunkerLayoutId);
  multiplayerStartAt = 0;
  showMenuToast(t('statusLeftLobby'), 1.2);
  setMenuPage('online');
}

function getSlotByIndex(idx) {
  if (!bunkerSlots.length) return null;
  const i = Math.max(0, Math.min(bunkerSlots.length - 1, Math.floor(idx)));
  return bunkerSlots[i] ?? null;
}

function ensureMpPlayer(playerId, name = '') {
  let p = multiplayerPlayers.get(playerId);
  if (!p) {
    p = {
      playerId,
      name: name || `Player-${playerId.slice(-4)}`,
      slotIndex: activeSlotIndex,
      arrivalOrder: multiplayerArrivalCounter++,
      moving: false,
      moveStartAt: 0,
      moveFromIndex: activeSlotIndex,
      moveToIndex: activeSlotIndex,
      bobPhase: Math.random() * Math.PI * 2,
      isLocal: playerId === multiplayerSession?.playerId,
    };
    multiplayerPlayers.set(playerId, p);
    ensurePlayerMatchStats(playerId, p.name, false);
  } else if (name) {
    p.name = name;
    ensurePlayerMatchStats(playerId, name, false);
  }
  return p;
}

function setMpPlayerSlot(playerId, slotIndex, nowMs = Date.now()) {
  const p = ensureMpPlayer(playerId);
  const toIdx = Math.max(0, Math.min(bunkerSlots.length - 1, Math.floor(slotIndex)));
  if (p.slotIndex === toIdx && !p.moving) return p;
  p.moveFromIndex = p.slotIndex;
  p.moveToIndex = toIdx;
  p.moveStartAt = nowMs;
  p.moving = true;
  p.slotIndex = toIdx;
  p.arrivalOrder = multiplayerArrivalCounter++;
  return p;
}

function removeMpPlayer(playerId) {
  multiplayerPlayers.delete(playerId);
}

function ensurePlayerMatchStats(playerId, name = '', isBot = false) {
  if (!playerId) return null;
  let s = playerMatchStats.get(playerId);
  if (!s) {
    s = {
      playerId,
      name: name || 'Player',
      isBot: !!isBot,
      kills: 0,
      boards: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
    };
    playerMatchStats.set(playerId, s);
  } else {
    if (name) s.name = name;
    s.isBot = !!isBot;
  }
  return s;
}

function resetMatchStats() {
  playerMatchStats = new Map();
  leaderboardScrollRow = 0;
}

function syncMatchStatsRosterFromLobby() {
  for (const p of multiplayerLobbyPlayers) {
    ensurePlayerMatchStats(p.playerId, p.name || 'Player', !!p.isBot);
  }
  const localId = multiplayerSession?.playerId || '__local__';
  ensurePlayerMatchStats(localId, localId === '__local__' ? 'You' : getPlayerNameForMatchmaking(), false);
}

function recordShotStat(playerId, hit = null) {
  const p = ensurePlayerMatchStats(playerId);
  if (!p) return;
  p.shotsFired += 1;
  if (hit?.type === 'zombie') {
    p.shotsHit += 1;
    if (hit.headshot) p.headshots += 1;
    if (hit.killed) p.kills += 1;
  }
}

function recordBoardCompleteStat(playerId) {
  const p = ensurePlayerMatchStats(playerId);
  if (!p) return;
  p.boards += 1;
}

function getSortedMatchStats() {
  return Array.from(playerMatchStats.values()).sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    if (b.headshots !== a.headshots) return b.headshots - a.headshots;
    const aAcc = a.shotsFired > 0 ? a.shotsHit / a.shotsFired : 0;
    const bAcc = b.shotsFired > 0 ? b.shotsHit / b.shotsFired : 0;
    if (bAcc !== aAcc) return bAcc - aAcc;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

function clampLeaderboardScroll(totalRows, visibleRows) {
  const maxStart = Math.max(0, totalRows - visibleRows);
  leaderboardScrollRow = Math.max(0, Math.min(maxStart, leaderboardScrollRow));
}

function getMpPlayerWorldPos(p, nowMs = Date.now()) {
  const toSlot = getSlotByIndex(p.moveToIndex ?? p.slotIndex);
  const fromSlot = getSlotByIndex(p.moveFromIndex ?? p.slotIndex) || toSlot;
  if (!toSlot || !fromSlot) return { x: cameraX, y: 0, z: cameraZ, moving: false };
  let t = 1;
  if (p.moving) {
    t = Math.max(0, Math.min(1, (nowMs - p.moveStartAt) / (MP_MOVE_DURATION * 1000)));
    if (t >= 1) p.moving = false;
  }
  const s = t * t * (3 - 2 * t);
  const x = fromSlot.x + (toSlot.x - fromSlot.x) * s;
  const z = fromSlot.z + (toSlot.z - fromSlot.z) * s;
  const bob = p.moving ? Math.sin((nowMs / 1000) * MP_BOB_SPEED + p.bobPhase) * 0.03 : 0;
  return { x, y: bob, z, moving: p.moving, slot: toSlot };
}

function getOutwardShotDirForSlot(slotIndex) {
  const slot = Number.isFinite(slotIndex) ? getSlotByIndex(slotIndex) : null;
  if (!slot?.normal) return null;
  const ox = -(slot.normal.x ?? 0);
  const oz = -(slot.normal.z ?? 0);
  const len = Math.hypot(ox, oz) || 0;
  if (len <= 1e-6) return null;
  return { x: ox / len, y: 0, z: oz / len };
}

function resolveRemoteShotDir(payloadDir, slotIndex) {
  const hasPayloadDir = payloadDir
    && Number.isFinite(payloadDir.x)
    && Number.isFinite(payloadDir.y)
    && Number.isFinite(payloadDir.z);
  const outward = getOutwardShotDirForSlot(slotIndex);
  if (!hasPayloadDir && outward) return outward;
  if (!hasPayloadDir) return null;
  const len = Math.hypot(payloadDir.x, payloadDir.y, payloadDir.z) || 1;
  let dir = { x: payloadDir.x / len, y: payloadDir.y / len, z: payloadDir.z / len };
  if (outward) {
    const dotOut = dir.x * outward.x + dir.z * outward.z;
    if (dotOut < 0.05) {
      // Invert obviously inward vectors (seen in some bot payloads).
      dir = { x: -dir.x, y: -dir.y, z: -dir.z };
    }
  }
  return dir;
}

function getSlotQueueMap() {
  const bySlot = new Map();
  const localId = multiplayerSession?.playerId || '__local__';
  const localEntry = ensureMpPlayer(localId, 'You');
  localEntry.isLocal = true;
  localEntry.slotIndex = activeSlotIndex;
  if (!bySlot.has(localEntry.slotIndex)) bySlot.set(localEntry.slotIndex, []);
  bySlot.get(localEntry.slotIndex).push(localEntry);
  multiplayerPlayers.forEach((p) => {
    if (p.playerId === localId) return;
    if (!bySlot.has(p.slotIndex)) bySlot.set(p.slotIndex, []);
    bySlot.get(p.slotIndex).push(p);
  });
  bySlot.forEach((arr) => arr.sort((a, b) => {
    if (a.isLocal && !b.isLocal) return -1;
    if (!a.isLocal && b.isLocal) return 1;
    return String(a.playerId).localeCompare(String(b.playerId));
  }));
  return bySlot;
}

function playPositionalClip(audioTemplate, worldX, worldZ, gainMul = 1, decayMs = 0, refDist = POSITIONAL_REF_DIST) {
  if (!audioTemplate) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const { gain, pan } = getPositionalGainPan(worldX, worldZ, refDist);
  const audio = audioTemplate.cloneNode(true);
  audio.preload = 'auto';
  const startGain = Math.max(0.001, gain * gainMul);
  let source = null;
  let gainNode = null;
  let panner = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { audio.pause(); } catch {}
    try { source?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { panner?.disconnect(); } catch {}
    try { audio.removeAttribute('src'); } catch {}
    try { audio.load(); } catch {}
  };
  try {
    source = ctx.createMediaElementSource(audio);
    gainNode = ctx.createGain();
    panner = ctx.createStereoPanner();
    gainNode.gain.value = startGain;
    panner.pan.value = pan;
    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(ctx.destination);
    if (decayMs > 0) {
      gainNode.gain.setValueAtTime(startGain, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + decayMs / 1000);
    }
  } catch {
    // Fallback path: still play if WebAudio node creation fails on this element.
    audio.volume = Math.min(1, startGain);
  }
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  const hardStopMs = Math.max(900, (decayMs || 0) + 1500);
  setTimeout(cleanup, hardStopMs);
  if (ctx.state === 'suspended') {
    ctx.resume().finally(() => { audio.play().catch(cleanup); });
  } else {
    audio.play().catch(cleanup);
  }
}

function isLossConditionMet() {
  if (gameOver || gameWon) return false;
  for (const z of zombies) {
    const targetX = z.targetWindowX ?? WORLD_CENTER_X;
    const targetZ = z.targetWindowZ ?? WORLD_CENTER_Z;
    const dx = targetX - z.x;
    const dz = targetZ - z.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    if (d >= BOARD_AT_WINDOW_DIST) continue;
    const slotKey = z.targetSlot ? getSlotKey(z.targetSlot) : '';
    const boardsAtWindow = slotKey ? (windowBoards[slotKey] ?? 0) : 0;
    if (boardsAtWindow > 0) continue;
    const started = z.breachStartTime != null;
    if (started && (gameTime - z.breachStartTime) >= BOARD_BREACH_DELAY) return true;
  }
  return false;
}

function proposeGameOver(z) {
  if (!multiplayerSession || !multiplayerConnected) return;
  if (pendingLossProposalId) return;
  pendingLossProposalId = `local_${Date.now()}`;
  sendMultiplayerPayload('game_over_proposal', {
    reason: 'window_breach',
    meta: {
      zombieSpawnIndex: z?.spawnIndex ?? null,
      targetSlotKey: z?.targetSlot ? getSlotKey(z.targetSlot) : '',
    },
  });
}

function connectMultiplayerSocket(sessionId, playerId, wsUrlFromServer = '') {
  closeMultiplayerSocket();
  const wsBase = wsUrlFromServer || `${wsBaseFromHttp(multiplayerHttpBase)}/ws`;
  const sep = wsBase.includes('?') ? '&' : '?';
  const wsUrl = `${wsBase}${sep}sessionId=${encodeURIComponent(sessionId)}&playerId=${encodeURIComponent(playerId)}`;
  multiplayerWs = new WebSocket(wsUrl);
  multiplayerWs.addEventListener('open', () => {
    multiplayerDisconnecting = false;
    multiplayerConnected = true;
    showMenuToast(t('statusConnected'), 1.2);
  });
  multiplayerWs.addEventListener('message', (ev) => {
    if (multiplayerDisconnecting) return;
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'welcome' && msg.session) {
        multiplayerSession = {
          sessionId: msg.session.sessionId,
          joinCode: msg.session.joinCode,
          privacy: msg.session.privacy,
          maxPlayers: msg.session.maxPlayers,
          playerId,
        };
        multiplayerPlayers.clear();
        setLobbyPlayers(msg.session.players || []);
        if (appMode === 'menu') setMenuPage('lobby');
        if (Array.isArray(msg.session.players)) {
          for (const pl of msg.session.players) {
            const ps = ensureMpPlayer(pl.playerId, pl.name || '');
            ps.isLocal = pl.playerId === playerId;
            const idx = Number.isFinite(pl.slotIndex) ? pl.slotIndex : activeSlotIndex;
            ps.slotIndex = Math.max(0, Math.min(Math.max(0, bunkerSlots.length - 1), Math.floor(idx)));
            ps.moveFromIndex = ps.slotIndex;
            ps.moveToIndex = ps.slotIndex;
          }
        }
        multiplayerGameSeed = Number(msg.session.gameSeed || GAME_PARAM_SEED);
        multiplayerWaveCount = Number(msg.session.waveCount || GAME_PARAM_WAVE_COUNT);
        multiplayerBunkerLayoutId = String(msg.session.bunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID);
        setCurrentBunkerLayout(multiplayerBunkerLayoutId);
        if (msg.session.agreedHash) {
          multiplayerAgreedHash = msg.session.agreedHash;
          multiplayerStartAt = Number(msg.session.startedAt || 0);
        }
        showMenuToast(t('statusWaitingInLobby'), 1.3);
        return;
      }
      if (msg.type === 'handshake_request') {
        multiplayerGameSeed = Number(msg.seed || GAME_PARAM_SEED);
        multiplayerWaveCount = Number(msg.waveCount || GAME_PARAM_WAVE_COUNT);
        multiplayerBunkerLayoutId = String(msg.bunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID);
        setCurrentBunkerLayout(multiplayerBunkerLayoutId);
        const multiplayerPlayerCount = Math.max(1, Number(msg.playerCount || multiplayerLobbyPlayers.length || 1));
        const planned = generateGameParameters(multiplayerGameSeed, multiplayerWaveCount, multiplayerPlayerCount);
        sendMultiplayerPayload('state_hash', {
          hash: planned.hash,
          clientVersion: 'prototype',
        });
        return;
      }
      if (msg.type === 'start_game') {
        multiplayerGameSeed = Number(msg.seed || GAME_PARAM_SEED);
        multiplayerWaveCount = Number(msg.waveCount || GAME_PARAM_WAVE_COUNT);
        multiplayerBunkerLayoutId = String(msg.bunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID);
        const multiplayerPlayerCount = Math.max(1, Number(msg.playerCount || multiplayerLobbyPlayers.length || 1));
        multiplayerAgreedHash = String(msg.agreedHash || '');
        multiplayerStartAt = Number(msg.startAt || 0);
        if (startLocalGame({
          seed: multiplayerGameSeed,
          waveCount: multiplayerWaveCount,
          bunkerLayoutId: multiplayerBunkerLayoutId,
          playerCount: multiplayerPlayerCount,
          agreedHash: multiplayerAgreedHash,
        })) {
          showMenuToast(`${t('statusJoined')} (${multiplayerSession?.joinCode || ''})`, 1.8);
          canvas.requestPointerLock();
        }
        return;
      }
      if (msg.type === 'player_joined' && msg.player) {
        upsertLobbyPlayer(msg.player);
        const ps = ensureMpPlayer(msg.player.playerId, msg.player.name || '');
        ps.isLocal = msg.player.playerId === multiplayerSession?.playerId;
        if (Number.isFinite(msg.player.slotIndex)) {
          ps.slotIndex = Math.floor(msg.player.slotIndex);
          ps.moveFromIndex = ps.slotIndex;
          ps.moveToIndex = ps.slotIndex;
        }
        ps.arrivalOrder = multiplayerArrivalCounter++;
        return;
      }
      if (msg.type === 'player_left') {
        removeLobbyPlayer(msg.playerId);
        removeMpPlayer(msg.playerId);
        return;
      }
      if (msg.type === 'host_changed') {
        if (msg.playerId) {
          multiplayerLobbyPlayers = multiplayerLobbyPlayers.map((p) => ({ ...p, isHost: p.playerId === msg.playerId }));
        }
        return;
      }
      if (msg.type === 'server_overloaded') {
        showMenuToast(String(msg.error || t('statusJoinFailed')), 2.8);
        return;
      }
      if (msg.type === 'hash_mismatch') {
        showMenuToast(`Hash mismatch: ${msg.yourHash} vs ${msg.agreedHash}`, 2.8);
        closeMultiplayerSocket();
        multiplayerSession = null;
        appMode = 'menu';
        setMenuPage('main');
        return;
      }
      if (msg.type === 'game_over_vote_request') {
        pendingLossProposalId = String(msg.proposalId || '');
        const agree = isLossConditionMet();
        sendMultiplayerPayload('game_over_vote', { proposalId: pendingLossProposalId, agree });
        return;
      }
      if (msg.type === 'game_over_confirm') {
        pendingLossProposalId = '';
        const zombieSpawnIndex = msg?.meta?.zombieSpawnIndex;
        if (zombieSpawnIndex != null) {
          gameOverZombie = zombies.find((z) => z.spawnIndex === zombieSpawnIndex) || gameOverZombie;
        }
        gameOver = true;
        gameOverFlashStart = performance.now() / 1000;
        return;
      }
      if (msg.type === 'game_over_canceled') {
        pendingLossProposalId = '';
        return;
      }
      if (msg.type === 'relay') {
        if (appMode !== 'game' || gameOver || gameWon) return;
        const from = String(msg.fromPlayerId || '');
        const payload = msg.payload || {};
        const remote = ensureMpPlayer(from);
        const nowMs = Date.now();
        if (payload.type === 'player_move') {
          const to = Number(payload.toSlotIndex);
          if (Number.isFinite(to)) {
            setMpPlayerSlot(from, to, nowMs);
            const pos = getMpPlayerWorldPos(remote, nowMs);
            if (assets.runningSound) playPositionalClip(assets.runningSound, pos.x, pos.z, 0.35, 1300);
          }
        } else if (payload.type === 'player_shot') {
          if (Number.isFinite(payload.slotIndex)) setMpPlayerSlot(from, Number(payload.slotIndex), nowMs);
          const pos = getMpPlayerWorldPos(remote, nowMs);
          recordShotStat(from, payload.hit || null);
          const resolvedDir = resolveRemoteShotDir(payload?.dir, Number(payload.slotIndex));
          if (resolvedDir) {
            addTracer(
              { x: pos.x, y: (pos.y ?? BUNKER_FLOOR_Y) + MP_SPRITE_HEIGHT * 0.62, z: pos.z },
              resolvedDir,
            );
          }
          const shotList = assets.shotSounds || [];
          if (shotList.length > 0) {
            const sfx = shotList[Math.floor(Math.random() * shotList.length)];
            // Gunshots carry further than other SFX; keep them loud at distance.
            playPositionalClip(sfx, pos.x, pos.z, 1.35, 1500, POSITIONAL_REF_DIST * 40);
          }
          if (assets.ejectCasing) playPositionalClip(assets.ejectCasing, pos.x, pos.z, 0.7, 220, POSITIONAL_REF_DIST * 1.4);
          applyRemoteZombieHit(payload, remote);
        } else if (payload.type === 'player_board_start') {
          const pos = getMpPlayerWorldPos(remote, nowMs);
          if (Number.isFinite(payload.slotIndex)) setMpPlayerSlot(from, Number(payload.slotIndex), nowMs);
          if (assets.hammerSound) playPositionalClip(assets.hammerSound, pos.x, pos.z, 0.75, 900);
        } else if (payload.type === 'player_board_complete') {
          const pos = getMpPlayerWorldPos(remote, nowMs);
          recordBoardCompleteStat(from);
          if (assets.hammerSound) playPositionalClip(assets.hammerSound, pos.x, pos.z, 0.7, 500);
        } else if (payload.type === 'player_ammo_pickup') {
          const pos = getMpPlayerWorldPos(remote, nowMs);
          if (Number.isFinite(payload.slotIndex)) setMpPlayerSlot(from, Number(payload.slotIndex), nowMs);
          if (assets.pickUp) playPositionalClip(assets.pickUp, pos.x, pos.z, 0.8, 700);
          if (assets.reloadSound) playPositionalClip(assets.reloadSound, pos.x, pos.z, 0.65, 1200);
        } else if (payload.type === 'player_reload_start') {
          const pos = getMpPlayerWorldPos(remote, nowMs);
          if (Number.isFinite(payload.slotIndex)) setMpPlayerSlot(from, Number(payload.slotIndex), nowMs);
          if (assets.reloadSound) playPositionalClip(assets.reloadSound, pos.x, pos.z, 0.7, 1200);
        }
        return;
      }
    } catch {
      // ignore non-json
    }
  });
  multiplayerWs.addEventListener('close', () => {
    multiplayerWs = null;
    multiplayerConnected = false;
    if (appMode === 'game' && multiplayerSession) showMenuToast(t('statusSocketClosed'), 1.4);
    if (appMode === 'menu' && menuPage === 'lobby') setMenuPage('online');
  });
}

async function hostMatchFromSettings() {
  showMenuToast(t('statusMatchCreating'), 2);
  const s = menuState.matchSettings;
  const name = getPlayerNameForMatchmaking();
  const created = await apiJson('/api/sessions/create', 'POST', {
    privacy: s.privacy,
    maxPlayers: s.maxPlayers,
    botsFill: true,
    difficulty: s.difficulty,
    bunkerLayoutId: s.bunkerLayoutId,
    playerName: name,
  });
  multiplayerSession = {
    sessionId: created.sessionId,
    playerId: created.playerId,
    joinCode: created.joinCode,
    privacy: created.privacy,
    maxPlayers: created.maxPlayers,
  };
  multiplayerAgreedHash = '';
  multiplayerStartAt = 0;
  multiplayerBunkerLayoutId = String(created.bunkerLayoutId || s.bunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID);
  setCurrentBunkerLayout(multiplayerBunkerLayoutId);
  connectMultiplayerSocket(created.sessionId, created.playerId, created.wsUrl);
  showMenuToast(`${t('statusHosted')} (${created.joinCode})`, 2.2);
  setMenuPage('lobby');
}

async function joinPublicMatch() {
  showMenuToast(t('statusConnecting'), 2);
  const list = await apiJson('/api/sessions/public');
  const sessions = Array.isArray(list.sessions) ? list.sessions : [];
  if (sessions.length === 0) {
    showMenuToast(t('statusNoPublic'), 1.8);
    return;
  }
  const pick = sessions.sort((a, b) => b.playerCount - a.playerCount)[0];
  const joined = await apiJson('/api/sessions/join', 'POST', {
    sessionId: pick.sessionId,
    playerName: getPlayerNameForMatchmaking(),
  });
  multiplayerSession = {
    sessionId: joined.sessionId,
    playerId: joined.playerId,
    joinCode: joined.joinCode,
    privacy: joined.privacy,
    maxPlayers: joined.maxPlayers,
  };
  multiplayerAgreedHash = '';
  multiplayerStartAt = 0;
  connectMultiplayerSocket(joined.sessionId, joined.playerId, joined.wsUrl);
  showMenuToast(t('statusWaitingInLobby'), 1.8);
  setMenuPage('lobby');
}

async function joinPrivateMatch() {
  const code = (window.prompt('Enter private match code') || '').trim().toUpperCase();
  if (!code) {
    showMenuToast(t('statusNeedCode'), 1.5);
    return;
  }
  showMenuToast(t('statusConnecting'), 2);
  const joined = await apiJson('/api/sessions/join', 'POST', {
    joinCode: code,
    playerName: getPlayerNameForMatchmaking(),
  });
  multiplayerSession = {
    sessionId: joined.sessionId,
    playerId: joined.playerId,
    joinCode: joined.joinCode,
    privacy: joined.privacy,
    maxPlayers: joined.maxPlayers,
  };
  multiplayerAgreedHash = '';
  multiplayerStartAt = 0;
  connectMultiplayerSocket(joined.sessionId, joined.playerId, joined.wsUrl);
  showMenuToast(t('statusWaitingInLobby'), 1.8);
  setMenuPage('lobby');
}

function getMenuPageDefinition() {
  const settings = menuState.matchSettings;
  const privLabel = settings.privacy === 'public' ? t('publicLabel') : t('privateLabel');
  const diffLabel = settings.difficulty === 'hard'
    ? t('diffHard')
    : settings.difficulty === 'nightmare' ? t('diffNightmare') : t('diffNormal');
  const langOptions = Object.keys(MENU_LANGUAGES);
  const languageName = menuLanguage.toUpperCase();

  if (menuPage === 'online') {
    return {
      title: t('playOnline'),
      subtitle: t('subtitleMain'),
      items: [
        { label: t('joinPublic'), onSelect: async () => joinPublicMatch() },
        { label: t('joinPrivate'), onSelect: async () => joinPrivateMatch() },
        {
          label: t('hostPublic'),
          onSelect: () => {
            settings.privacy = 'public';
            setMenuPage('match_settings');
          },
        },
        {
          label: t('hostPrivate'),
          onSelect: () => {
            settings.privacy = 'private';
            setMenuPage('match_settings');
          },
        },
        { label: t('back'), onSelect: () => setMenuPage('main') },
      ],
    };
  }

  if (menuPage === 'options') {
    return {
      title: t('options'),
      subtitle: t('subtitleMain'),
      items: [
        {
          label: `${t('language')}: ${languageName}`,
          onSelect: () => {
            menuLanguage = cycleValue(langOptions, menuLanguage, 1);
          },
        },
        {
          label: `Server: ${multiplayerHttpBase.replace(/^https?:\/\//, '')}`,
          onSelect: () => {
            const next = (window.prompt('Multiplayer server URL', multiplayerHttpBase) || '').trim();
            if (!next) return;
            if (!/^https?:\/\//i.test(next)) {
              showMenuToast('Use http:// or https://', 1.5);
              return;
            }
            multiplayerHttpBase = next.replace(/\/+$/, '');
            try { window.localStorage?.setItem('multiplayerHttpBase', multiplayerHttpBase); } catch {}
          },
        },
        { label: t('back'), onSelect: () => setMenuPage('main') },
      ],
    };
  }

  if (menuPage === 'match_settings') {
    return {
      title: t('settingsTitle'),
      subtitle: t('playOnline'),
      items: [
        {
          label: `${t('privacy')}: ${privLabel}`,
          onSelect: () => {
            settings.privacy = settings.privacy === 'public' ? 'private' : 'public';
          },
        },
        {
          label: `${t('bunker')}: ${getBunkerLayoutName(settings.bunkerLayoutId)}`,
          onSelect: () => {
            const opts = getBunkerLayoutOptions().map((b) => b.id);
            settings.bunkerLayoutId = cycleValue(opts, settings.bunkerLayoutId, 1);
            setCurrentBunkerLayout(settings.bunkerLayoutId);
          },
        },
        {
          label: `${t('maxPlayers')}: ${settings.maxPlayers}`,
          onSelect: () => {
            settings.maxPlayers = cycleValue([4, 8, 12, 16, 24, 32, 48, 64], settings.maxPlayers, 1);
          },
        },
        {
          label: `${t('difficulty')}: ${diffLabel}`,
          onSelect: () => {
            settings.difficulty = cycleValue(['normal', 'hard', 'nightmare'], settings.difficulty, 1);
          },
        },
        { label: t('createMatch'), onSelect: async () => hostMatchFromSettings() },
        { label: t('back'), onSelect: () => setMenuPage('online') },
      ],
    };
  }

  if (menuPage === 'lobby') {
    return {
      title: t('lobbyTitle'),
      subtitle: t('lobbyWaiting'),
      items: [
        ...(isLobbyHost() ? [{ label: t('lobbyStart'), onSelect: () => startMatchFromLobby() }] : []),
        { label: t('lobbyLeave'), onSelect: () => leaveLobby() },
      ],
    };
  }

  return {
    title: t('titleMain'),
    subtitle: t('subtitleMain'),
    items: [
      {
        label: t('startLocal'),
        onSelect: () => {
          showMenuToast(t('statusStartingLocal'), 0.8);
          startLocalGame();
          canvas.requestPointerLock();
        },
      },
      { label: t('playOnline'), onSelect: () => setMenuPage('online') },
      { label: t('options'), onSelect: () => setMenuPage('options') },
    ],
  };
}

function selectMenuItem(index) {
  const toastFromMenuError = (err) => {
    const text = String(err?.message || '').trim();
    if (text && !/^HTTP\s+\d+/i.test(text)) {
      showMenuToast(text.slice(0, 120), 2.6);
      return;
    }
    showMenuToast(t('statusJoinFailed'), 2);
  };
  const def = getMenuPageDefinition();
  const item = def.items[index];
  if (!item || typeof item.onSelect !== 'function') return;
  try {
    const maybe = item.onSelect();
    if (maybe && typeof maybe.then === 'function') {
      maybe.catch((err) => {
        console.error(err);
        toastFromMenuError(err);
      });
    }
  } catch (err) {
    console.error(err);
    toastFromMenuError(err);
  }
}

function handleMenuKeydown(e) {
  const def = getMenuPageDefinition();
  const count = def.items.length;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') {
    e.preventDefault();
    menuSelectedIndex = (menuSelectedIndex - 1 + count) % count;
  } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
    e.preventDefault();
    menuSelectedIndex = (menuSelectedIndex + 1) % count;
  } else if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    selectMenuItem(menuSelectedIndex);
  } else if (e.code === 'Escape' || e.code === 'Backspace') {
    if (menuPage !== 'main') {
      e.preventDefault();
      if (menuPage === 'lobby') {
        leaveLobby();
        return;
      }
      if (menuPage === 'match_settings') setMenuPage('online');
      else setMenuPage('main');
    }
  }
}

function updateMenuHover(mx, my) {
  menuHoverIndex = -1;
  for (let i = 0; i < menuButtons.length; i++) {
    const b = menuButtons[i];
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
      menuHoverIndex = i;
      menuSelectedIndex = i;
      return;
    }
  }
}

function handleMenuClick(e) {
  const { x, y } = getCanvasPointerPos(e);
  updateMenuHover(x, y);
  if (menuHoverIndex >= 0) selectMenuItem(menuHoverIndex);
}

// ---- 3D projection ----

function getViewVectors() {
  const pitch = -cameraPitch;
  if (getViewVectors.cache && getViewVectors.cacheYaw === cameraYaw && getViewVectors.cachePitch === pitch) {
    return getViewVectors.cache;
  }
  // Use negated pitch so positive cameraPitch (mouse down) = look down in 3D view
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
  getViewVectors.cacheYaw = cameraYaw;
  getViewVectors.cachePitch = pitch;
  getViewVectors.cache = { forward, right, up };
  return getViewVectors.cache;
}

function getFOV() {
  return isIronSightsActive() ? IRON_SIGHTS_FOV : FOV;
}

function isIronSightsActive() {
  const isRunning = movementStartTime != null && (gameTime - movementStartTime) < BUNKER_MOVE_DURATION;
  return ironSightsHeld && rifleState !== 'reloading' && !isRunning;
}

function initWorldRendererIfAvailable() {
  if (worldRenderer && worldRenderer.isReady()) return;
  if (!worldRenderer?.isReady()) worldRenderer = null;
  if (!window.WorldRenderer3D || !worldCanvas) return;
  try {
    worldRenderer = new window.WorldRenderer3D(worldCanvas, W, H);
    if (!worldRenderer.isReady()) {
      worldRenderer = null;
      return;
    }
    worldStaticDirty = true;
  } catch (err) {
    console.error('WorldRenderer3D init failed:', err);
    worldRenderer = null;
  }
}

function getRemotePlayersForRenderer() {
  const items = [];
  if (!multiplayerPlayers.size) return items;
  const localId = multiplayerSession?.playerId || '__local__';
  const nowMs = Date.now();
  multiplayerPlayers.forEach((p) => {
    if (p.playerId === localId || p.isLocal) return;
    const pos = getMpPlayerWorldPos(p, nowMs);
    const slot = pos.slot || getSlotByIndex(p.slotIndex);
    const imgBack = assets.playerSpriteBack;
    const imgSide = assets.playerSpriteSide;
    let img = imgSide;
    if (slot) {
      const forward = { x: Math.sin(slot.baseYaw), z: -Math.cos(slot.baseYaw) };
      const toCamX = cameraX - pos.x;
      const toCamZ = cameraZ - pos.z;
      const mag = Math.hypot(toCamX, toCamZ) || 1;
      const dot = forward.x * (toCamX / mag) + forward.z * (toCamZ / mag);
      if (dot < -0.45) img = imgBack || imgSide;
    }
    items.push({
      playerId: p.playerId,
      x: pos.x,
      y: BUNKER_FLOOR_Y + (pos.y || 0),
      z: pos.z,
      img: img || imgSide || imgBack,
    });
  });
  return items;
}

function getBoardInstancesForRenderer() {
  const out = [];
  if (!bunker || !assets.board?.naturalWidth) return out;
  const img = assets.board;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const halfH = BOARD_SPRITE_WORLD_SIZE * 0.5;
  const halfW = BOARD_SPRITE_WORLD_SIZE * (iw / Math.max(1, ih)) * 0.5;
  const placingKey = boardPlaceState?.slotKey ?? null;

  for (const slot of bunkerSlots) {
    if (slot.type !== 'window') continue;
    const key = getSlotKey(slot);
    const onWindow = windowBoards[key] ?? 0;
    const onFloor = BOARDS_PER_WINDOW - onWindow;
    const floorPoses = getBoardFloorPositions(slot);
    const windowPoses = getBoardWindowPositions(slot);
    const isPlacingHere = placingKey === key;
    let floorCount = onFloor;
    if (isPlacingHere) floorCount = Math.max(0, onFloor - 1);
    const floorY = BUNKER_FLOOR_Y + halfH;
    const slotYaw = Math.atan2(slot.tangent?.z ?? 0, slot.tangent?.x ?? 1);
    const n = slot.normal ?? { x: 0, z: 1 };
    const sign = slot.segmentIndex % 2 === 0 ? 1 : -1;
    const rightX = sign * n.z;
    const rightZ = -sign * n.x;
    for (let i = 0; i < floorCount && i < floorPoses.length; i++) {
      const p = floorPoses[i];
      const stackX = p.x + rightX * BOARD_STACK_OFFSET_RIGHT;
      const stackZ = p.z + rightZ * BOARD_STACK_OFFSET_RIGHT;
      out.push({ type: 'floor', x: stackX, y: floorY, z: stackZ, w: halfW * 2, h: halfH * 2, rot: p.rot + BOARD_STACK_ROLL, slotYaw });
    }
    if (isPlacingHere && boardPlaceState && onFloor > 0 && onWindow < windowPoses.length) {
      const startTime = boardPlaceState.startTime;
      const endTime = boardPlaceState.endTime;
      const t = Math.min(1, Math.max(0, (gameTime - startTime) / (endTime - startTime)));
      const fromP = floorPoses[onFloor - 1];
      const toP = windowPoses[onWindow];
      const fromY = (fromP.y ?? 0) + halfH;
      const toY = BUNKER_WALL_HEIGHT * (1 - BOARD_WINDOW_FRACTIONS[onWindow]);
      const slotYaw = Math.atan2(slot.tangent?.z ?? 0, slot.tangent?.x ?? 1);
      out.push({
        type: 'placing',
        t,
        fromX: fromP.x + rightX * BOARD_STACK_OFFSET_RIGHT,
        fromY,
        fromZ: fromP.z + rightZ * BOARD_STACK_OFFSET_RIGHT,
        toX: toP.x, toY, toZ: toP.z,
        fromRot: fromP.rot + BOARD_STACK_ROLL,
        toRot: toP.rot,
        slotYaw,
        w: halfW * 2, h: halfH * 2,
      });
    }
    const segmentYaw = Math.atan2(slot.tangent?.z ?? 0, slot.tangent?.x ?? 1);
    for (let i = 0; i < onWindow && i < windowPoses.length; i++) {
      const p = windowPoses[i];
      const frac = BOARD_WINDOW_FRACTIONS[i];
      const y = BUNKER_WALL_HEIGHT * (1 - frac);
      const x = p.x;
      const z = p.z;
      out.push({ type: 'wall', x, y, z, w: halfW * 2, h: halfH * 2, segmentYaw, rot: p.rot });
    }
  }

  const floorY = BUNKER_FLOOR_Y + halfH;
  for (const fb of fallingBoards) {
    const t = Math.min(1, Math.max(0, (gameTime - fb.startTime) / (fb.endTime - fb.startTime)));
    const x = fb.fromPos.x + (fb.toPos.x - fb.fromPos.x) * t;
    const y = fb.fromPos.y + (floorY - fb.fromPos.y) * t;
    const z = fb.fromPos.z + (fb.toPos.z - fb.fromPos.z) * t;
    const rot = fb.fromPos.rot + (fb.toPos.rot - fb.fromPos.rot) * t;
    const slot = bunkerSlots.find((s) => getSlotKey(s) === fb.slotKey);
    const slotYaw = slot ? Math.atan2(slot.tangent?.z ?? 0, slot.tangent?.x ?? 1) : 0;
    out.push({ type: 'floor', x, y, z, w: halfW * 2, h: halfH * 2, rot: rot + BOARD_STACK_ROLL, slotYaw });
  }
  return out;
}

function getTracerInstancesForRenderer() {
  const out = [];
  for (const t of tracers) {
    const a = Math.max(0, Math.min(1, t.life / Math.max(1e-6, t.maxLife || TRACER_LIFE)));
    if (a <= 0.001) continue;
    out.push({
      fromX: t.fromX,
      fromY: t.fromY,
      fromZ: t.fromZ,
      toX: t.toX,
      toY: t.toY,
      toZ: t.toZ,
      alpha: a,
    });
  }
  return out;
}

function getWorldRendererState() {
  return {
    assets,
    bunker,
    bunkerSlots,
    bunkerWallSegments,
    bunkerTileWorldWidth,
    trees,
    zombies,
    cameraX,
    cameraZ,
    CAMERA_Y,
    BUNKER_FLOOR_Y,
    BUNKER_WALL_HEIGHT,
    NEAR,
    FAR,
    TREE_HEIGHT,
    TREE_SPRITE_SIZE,
    ZOMBIE_REF_HEIGHT,
    ZOMBIE_SPRITE_W,
    ZOMBIE_SPRITE_H,
    MP_SPRITE_HEIGHT,
    getFOV,
    getBunkerWallImageAndData,
    getCrateAABB,
    getTreeGridCell,
    getRemotePlayers: getRemotePlayersForRenderer,
    getBoardInstances: getBoardInstancesForRenderer,
    getTracerInstances: getTracerInstancesForRenderer,
    getViewForward: () => getViewVectors().forward,
    FOG_DENSITY,
    FOG_COLOR,
    SKY_COLOR,
    GROUND_COLOR,
    horizonForestTexture,
    isInsideBunker: (x, z) =>
      bunker?.corners?.length >= 3 &&
      isPointInsidePolygon(x, z, bunker.corners) &&
      !(bunker.holes || []).some((h) => isPointInsidePolygon(x, z, h)),
  };
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
  const fov = getFOV();
  if (project.cacheFov !== fov || project.cacheH !== H) {
    project.cacheFov = fov;
    project.cacheH = H;
    project.cacheProjFactor = (H / 2) / Math.tan(fov / 2);
  }
  const scale = project.cacheProjFactor / depth;
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

function getRifleFps() {
  return score >= UPGRADE_MAD_MINUTE_AT ? RIFLE_FPS * 2 : RIFLE_FPS;
}

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
  trees = [];
  nextTreeId = 1;
  if (gameParams?.trees?.length) {
    for (const t of gameParams.trees) {
      trees.push({ id: nextTreeId++, x: t.x, z: t.z, spriteIndex: t.spriteIndex, hp: TREE_HP });
    }
    return;
  }
  const rng = createSeededRng(GAME_PARAM_SEED);
  for (let i = 0; i < TREE_COUNT; i++) {
    const dist = TREE_MIN_DIST + rng() * (TREE_MAX_DIST - TREE_MIN_DIST);
    const angle = rng() * Math.PI * 2;
    const x = WORLD_CENTER_X + Math.cos(angle) * dist;
    const z = WORLD_CENTER_Z + Math.sin(angle) * dist;
    const spriteIndex = Math.floor(rng() * 14);
    trees.push({ id: nextTreeId++, x, z, spriteIndex, hp: TREE_HP });
  }
}

function generateBunkerLayout(layout = null) {
  const activeLayout = layout || getBunkerLayoutById(currentBunkerLayoutId);
  currentBunkerLayoutId = activeLayout?.id || DEFAULT_BUNKER_LAYOUT_ID;
  const wallAspect = assets.bunkerWall?.naturalWidth && assets.bunkerWall?.naturalHeight
    ? assets.bunkerWall.naturalWidth / assets.bunkerWall.naturalHeight
    : 1;
  bunkerTileWorldWidth = BUNKER_WALL_HEIGHT * wallAspect * BUNKER_WALL_TILE_SCALE;
  const unitCorners = Array.isArray(activeLayout?.unitCorners) && activeLayout.unitCorners.length >= 3
    ? activeLayout.unitCorners
    : [{ x: -3, z: -2 }, { x: 3, z: -2 }, { x: 3, z: 2 }, { x: -3, z: 2 }];
  const corners = unitCorners.map((p) => ({
    x: WORLD_CENTER_X + p.x * bunkerTileWorldWidth,
    z: WORLD_CENTER_Z + p.z * bunkerTileWorldWidth,
  }));
  const slots = [];
  bunkerWallTiles = { north: [], east: [], south: [], west: [] };
  bunkerWallSegments = [];

  function normalizeSpriteKey(key) {
    if (key === 'window' || key === 'door' || key === 'hole' || key === 'wall_ammo' || key === 'wall_ammo_mirrored' || key === 'wall_tally' || key === 'wall_tally_mirrored' || key === 'ammo') return key;
    return 'wall';
  }
  function yawFromDir(x, z) {
    return Math.atan2(x, -z);
  }

  let signedArea2 = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    signedArea2 += a.x * b.z - b.x * a.z;
  }
  const isCCW = signedArea2 > 0;
  const polygonCenter = corners.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  polygonCenter.x /= Math.max(1, corners.length);
  polygonCenter.z /= Math.max(1, corners.length);

  function appendSegment(a, b, tileKeys = [], createSlots = true, inwardOverride = null) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len <= 1e-6) return;
    const count = Math.max(1, Math.round(len / bunkerTileWorldWidth));
    const tx = dx / len;
    const tz = dz / len;
    const inward = inwardOverride || (isCCW ? { x: -tz, z: tx } : { x: tz, z: -tx });
    const segment = {
      index: bunkerWallSegments.length,
      a,
      b,
      tangent: { x: tx, z: tz },
      inward,
      length: len,
      tiles: [],
    };
    for (let j = 0; j < count; j++) {
      const t0 = j / count;
      const t1 = (j + 1) / count;
      const tc = (t0 + t1) / 2;
      const cx = a.x + dx * tc;
      const cz = a.z + dz * tc;
      const spriteKey = normalizeSpriteKey(tileKeys[j] ?? 'wall');
      const tile = {
        segmentIndex: segment.index,
        tileIndex: j,
        minT: t0,
        maxT: t1,
        centerX: cx,
        centerZ: cz,
        spriteKey,
      };
      segment.tiles.push(tile);

      if (createSlots && spriteKey === 'ammo') {
        slots.push({
          segmentIndex: segment.index,
          tileIndex: j,
          tileSpriteKey: 'wall',
          type: 'crate',
          x: cx + inward.x * BUNKER_WALL_INSET,
          z: cz + inward.z * BUNKER_WALL_INSET,
          wallX: cx,
          wallZ: cz,
          tangent: { ...segment.tangent },
          normal: { ...inward },
          tileWidth: bunkerTileWorldWidth,
          baseYaw: yawFromDir(-inward.x, -inward.z),
          label: 'Ammo Crate',
        });
      } else if (createSlots && spriteKey !== 'wall' && spriteKey !== 'wall_ammo') {
        slots.push({
          segmentIndex: segment.index,
          tileIndex: j,
          tileSpriteKey: spriteKey,
          type: 'window',
          x: cx + inward.x * BUNKER_WALL_INSET,
          z: cz + inward.z * BUNKER_WALL_INSET,
          wallX: cx,
          wallZ: cz,
          tangent: { ...segment.tangent },
          normal: { ...inward },
          tileWidth: bunkerTileWorldWidth,
          baseYaw: yawFromDir(-inward.x, -inward.z),
          label: `Window ${segment.index + 1}-${j + 1}`,
        });
      }
    }
    bunkerWallSegments.push(segment);
  }

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const tileKeys = Array.isArray(activeLayout?.segmentTiles?.[i]) ? activeLayout.segmentTiles[i] : [];
    appendSegment(a, b, tileKeys, true);
  }

  const interiorWalls = Array.isArray(activeLayout?.interiorWalls) ? activeLayout.interiorWalls : [];
  for (const wall of interiorWalls) {
    if (!wall?.from || !wall?.to) continue;
    const a = {
      x: WORLD_CENTER_X + wall.from.x * bunkerTileWorldWidth,
      z: WORLD_CENTER_Z + wall.from.z * bunkerTileWorldWidth,
    };
    const b = {
      x: WORLD_CENTER_X + wall.to.x * bunkerTileWorldWidth,
      z: WORLD_CENTER_Z + wall.to.z * bunkerTileWorldWidth,
    };
    const mx = (a.x + b.x) * 0.5;
    const mz = (a.z + b.z) * 0.5;
    const vx = polygonCenter.x - mx;
    const vz = polygonCenter.z - mz;
    const vLen = Math.hypot(vx, vz) || 1;
    const inward = { x: vx / vLen, z: vz / vLen };
    appendSegment(a, b, wall.tiles || [], false, inward);
  }

  const interiorWallLoops = Array.isArray(activeLayout?.interiorWallLoops) ? activeLayout.interiorWallLoops : [];
  for (const loop of interiorWallLoops) {
    const pts = Array.isArray(loop?.points) ? loop.points : [];
    if (pts.length < 3) continue;
    const segmentTiles = Array.isArray(loop.segmentTiles) ? loop.segmentTiles : [];
    for (let i = 0; i < pts.length; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % pts.length];
      const a = {
        x: WORLD_CENTER_X + p0.x * bunkerTileWorldWidth,
        z: WORLD_CENTER_Z + p0.z * bunkerTileWorldWidth,
      };
      const b = {
        x: WORLD_CENTER_X + p1.x * bunkerTileWorldWidth,
        z: WORLD_CENTER_Z + p1.z * bunkerTileWorldWidth,
      };
      const mx = (a.x + b.x) * 0.5;
      const mz = (a.z + b.z) * 0.5;
      const vx = polygonCenter.x - mx;
      const vz = polygonCenter.z - mz;
      const vLen = Math.hypot(vx, vz) || 1;
      const inward = { x: vx / vLen, z: vz / vLen };
      const tiles = segmentTiles[i] || segmentTiles[0] || ['wall', 'wall'];
      appendSegment(a, b, tiles, false, inward);
    }
  }

  // Pick a nearby blank wall tile for zombie tally (closest wall tile to ammo crate).
  tallyWallTileRef = null;
  const crateSlot = slots.find((s) => s.type === 'crate');
  if (crateSlot) {
    let best = null;
    for (const segment of bunkerWallSegments) {
      for (const tile of segment.tiles) {
        if (tile.spriteKey !== 'wall') continue;
        const d = Math.hypot(tile.centerX - crateSlot.wallX, tile.centerZ - crateSlot.wallZ);
        if (!best || d < best.dist) best = { segmentIndex: segment.index, tileIndex: tile.tileIndex, dist: d };
      }
    }
    if (best) {
      const segment = bunkerWallSegments[best.segmentIndex];
      const tile = segment?.tiles?.[best.tileIndex];
      if (tile) {
        tile.spriteKey = 'wall_tally';
        tallyWallTileRef = { segmentIndex: best.segmentIndex, tileIndex: best.tileIndex };
      }
    }
  }

  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const holes = ((activeLayout && activeLayout.interiorHoles) || []).map((hole) =>
    hole.map((p) => ({
      x: WORLD_CENTER_X + p.x * bunkerTileWorldWidth,
      z: WORLD_CENTER_Z + p.z * bunkerTileWorldWidth,
    }))
  );
  bunker = {
    halfW: (maxX - minX) / 2,
    halfD: (maxZ - minZ) / 2,
    minX,
    maxX,
    minZ,
    maxZ,
    corners,
    holes,
  };
  bunkerSlots = slots;
  activeSlotIndex = Math.max(0, bunkerSlots.findIndex((slot) => slot.type === 'window' || slot.type === 'crate'));
  setActiveBunkerSlot(activeSlotIndex, true);
  initWindowBoards();
  precomputeSlotVoiceVolumes();
  worldStaticDirty = true;
}

function getBoardFloorPositions(slot) {
  if (!slot || slot.type !== 'window' || !bunker) return [];
  const key = getSlotKey(slot);
  const seed = (key.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) >>> 0;
  const rng = seeded(seed);
  const tx = slot.tangent?.x ?? 1;
  const tz = slot.tangent?.z ?? 0;
  const n = slot.normal ?? { x: 0, z: 1 };
  const wallX = (slot.wallX ?? slot.x) + n.x * BOARD_WALL_INSET;
  const wallZ = (slot.wallZ ?? slot.z) + n.z * BOARD_WALL_INSET;
  const positions = [];
  for (let i = 0; i < BOARDS_PER_WINDOW; i++) {
    const jitter = (rng() - 0.5) * 0.08;
    const x = wallX + tx * jitter;
    const z = wallZ + tz * jitter;
    const rot = (rng() - 0.5) * 2 * BOARD_TILT_MAX;
    positions.push({ x, y: 0, z, rot, flip: rng() < 0.5 });
  }
  return positions;
}

function getBoardWindowPositions(slot) {
  if (!slot || slot.type !== 'window') return [];
  const key = getSlotKey(slot);
  const seed = (key.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) >>> 0;
  const rng = seeded(seed);
  const n = slot.normal ?? { x: 0, z: 1 };
  const wallX = (slot.wallX ?? slot.x) + n.x * BOARD_WALL_INSET;
  const wallZ = (slot.wallZ ?? slot.z) + n.z * BOARD_WALL_INSET;
  const positions = [
    { y: BOARD_WINDOW_Y_LOW },
    { y: BOARD_WINDOW_Y_MID },
    { y: BOARD_WINDOW_Y_HIGH },
  ];
  return positions.map((p) => {
    const rot = (rng() - 0.5) * 2 * BOARD_TILT_MAX;
    const flip = rng() < 0.5;
    return {
      x: wallX,
      y: p.y,
      z: wallZ,
      rot,
      flip,
    };
  });
}

function getCurrentBunkerSlot() {
  return bunkerSlots[activeSlotIndex] ?? null;
}

function getSideWallCoord(side) {
  if (!bunker) return 0;
  if (side === 'north') return bunker.minZ;
  if (side === 'south') return bunker.maxZ;
  if (side === 'east') return bunker.maxX;
  return bunker.minX;
}

function appendPathPoint(points, x, z) {
  const prev = points[points.length - 1];
  if (!prev || Math.hypot(prev.x - x, prev.z - z) > 1e-4) points.push({ x, z });
}

function isMovementPathBlocked(ax, az, bx, bz, y = CAMERA_Y) {
  if (!bunkerWallSegments?.length) return false;
  const EPS = 1e-5;
  const cross2 = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const rX = bx - ax;
  const rZ = bz - az;
  const len = Math.hypot(rX, rZ);
  if (len <= EPS) return false;
  for (const segment of bunkerWallSegments) {
    const sX = segment.b.x - segment.a.x;
    const sZ = segment.b.z - segment.a.z;
    const rxs = cross2(rX, rZ, sX, sZ);
    if (Math.abs(rxs) < EPS) continue;
    const qmpX = segment.a.x - ax;
    const qmpZ = segment.a.z - az;
    const t = cross2(qmpX, qmpZ, sX, sZ) / rxs;
    const u = cross2(qmpX, qmpZ, rX, rZ) / rxs;
    // Ignore touching near endpoints.
    if (t <= 0.01 || t >= 0.99 || u < -EPS || u > 1 + EPS) continue;
    if (y <= 0 || y >= BUNKER_WALL_HEIGHT) continue;
    const alpha = sampleBunkerWallAlpha(segment, Math.max(0, Math.min(1, u)), y);
    if (alpha > BUNKER_WALL_ALPHA_PASS_THRESHOLD) return true;
  }
  return false;
}

/** Precompute slot-to-slot voice volume (same = 1, adjacent/back-to-back = 0.5, distant or wall between = 0). Call once at game start after bunker and slots exist. */
function precomputeSlotVoiceVolumes() {
  if (!bunkerSlots?.length || !bunkerWallSegments?.length) {
    slotVoiceVolumeMatrix = null;
    return;
  }
  const n = bunkerSlots.length;
  const maxDist = bunkerTileWorldWidth * VOICE_PARTIAL_MAX_DISTANCE_MULTIPLIER;
  slotVoiceVolumeMatrix = Array(n)
    .fill(0)
    .map(() => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        slotVoiceVolumeMatrix[i][j] = 1;
        continue;
      }
      const a = bunkerSlots[i];
      const b = bunkerSlots[j];
      const ax = a.x;
      const az = a.z;
      const bx = b.x;
      const bz = b.z;
      const dist = Math.hypot(bx - ax, bz - az);
      const blocked = isMovementPathBlocked(ax, az, bx, bz, CAMERA_Y);
      if (blocked) slotVoiceVolumeMatrix[i][j] = 0;
      else if (dist <= maxDist) {
        const v = 0.5;
        slotVoiceVolumeMatrix[i][j] = v >= VOICE_MIN_VOLUME_THRESHOLD ? v : 0;
      } else slotVoiceVolumeMatrix[i][j] = 0;
    }
  }
}

/** Returns voice volume from slot index A to B: 1 (same), 0.5 (partial), or 0. */
function getSlotVoiceVolume(slotIndexA, slotIndexB) {
  if (!slotVoiceVolumeMatrix) return 0;
  const i = Math.max(0, Math.min(slotIndexA, slotVoiceVolumeMatrix.length - 1));
  const j = Math.max(0, Math.min(slotIndexB, slotVoiceVolumeMatrix[0]?.length - 1 ?? 0));
  const v = slotVoiceVolumeMatrix[i][j] ?? 0;
  return v >= VOICE_MIN_VOLUME_THRESHOLD ? v : 0;
}

function buildMovementPathForSlots(startSlot, endSlot, startIndex, endIndex, directionHint = 0) {
  const points = [];
  appendPathPoint(points, cameraX, cameraZ);
  if (!startSlot || !endSlot) {
    appendPathPoint(points, desiredCameraX, desiredCameraZ);
    return points;
  }
  if (!isMovementPathBlocked(cameraX, cameraZ, desiredCameraX, desiredCameraZ, CAMERA_Y)) {
    appendPathPoint(points, desiredCameraX, desiredCameraZ);
    return points;
  }
  const n = bunkerSlots.length;
  if (n <= 1 || startIndex === endIndex) {
    appendPathPoint(points, desiredCameraX, desiredCameraZ);
    return points;
  }
  const dir = directionHint === 0 ? 1 : (directionHint > 0 ? 1 : -1);
  const segCount = bunkerWallSegments.length;
  function addCornersBetweenSegments(fromSeg, toSeg) {
    if (fromSeg == null || toSeg == null || fromSeg === toSeg || segCount <= 0) return;
    let s = ((fromSeg % segCount) + segCount) % segCount;
    const target = ((toSeg % segCount) + segCount) % segCount;
    for (let safety = 0; safety < segCount + 2 && s !== target; safety++) {
      const nextSeg = (s + dir + segCount) % segCount;
      const cornerIndex = dir > 0 ? nextSeg : s;
      const corner = bunker.corners?.[cornerIndex];
      if (corner) {
        const n1 = bunkerWallSegments[s]?.inward ?? { x: 0, z: 0 };
        const n2 = bunkerWallSegments[nextSeg]?.inward ?? { x: 0, z: 0 };
        appendPathPoint(points, corner.x + n1.x * BUNKER_WALL_INSET, corner.z + n1.z * BUNKER_WALL_INSET);
        appendPathPoint(points, corner.x + n2.x * BUNKER_WALL_INSET, corner.z + n2.z * BUNKER_WALL_INSET);
      }
      s = nextSeg;
    }
  }

  let i = ((startIndex % n) + n) % n;
  const targetIndex = ((endIndex % n) + n) % n;
  for (let safety = 0; safety < n + 2 && i !== targetIndex; safety++) {
    const nextI = (i + dir + n) % n;
    const from = bunkerSlots[i];
    const to = bunkerSlots[nextI];
    const fromX = from?.x ?? cameraX;
    const fromZ = from?.z ?? cameraZ;
    const toX = to?.x ?? desiredCameraX;
    const toZ = to?.z ?? desiredCameraZ;
    if (isMovementPathBlocked(fromX, fromZ, toX, toZ, CAMERA_Y)) {
      addCornersBetweenSegments(from?.segmentIndex, to?.segmentIndex);
    }
    i = nextI;
  }
  appendPathPoint(points, desiredCameraX, desiredCameraZ);
  return points;
}

function smoothMovementPath(points) {
  if (!points || points.length < 3) return points ? points.slice() : [];
  const smoothed = [{ ...points[0] }];
  const EPS = 1e-5;
  const CURVE_RATIO = 0.35;
  const MAX_CURVE = bunkerTileWorldWidth * 0.45;
  const CURVE_SAMPLES = 8;

  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const inX = p1.x - p0.x;
    const inZ = p1.z - p0.z;
    const outX = p2.x - p1.x;
    const outZ = p2.z - p1.z;
    const lenIn = Math.hypot(inX, inZ);
    const lenOut = Math.hypot(outX, outZ);
    if (lenIn <= EPS || lenOut <= EPS) {
      appendPathPoint(smoothed, p1.x, p1.z);
      continue;
    }
    const inNx = inX / lenIn;
    const inNz = inZ / lenIn;
    const outNx = outX / lenOut;
    const outNz = outZ / lenOut;
    const dot = inNx * outNx + inNz * outNz;
    // Keep straight-ish joints as straight lines.
    if (dot > 0.985) {
      appendPathPoint(smoothed, p1.x, p1.z);
      continue;
    }

    const offset = Math.max(0.08, Math.min(MAX_CURVE, Math.min(lenIn, lenOut) * CURVE_RATIO));
    const a = { x: p1.x - inNx * offset, z: p1.z - inNz * offset };
    const b = { x: p1.x + outNx * offset, z: p1.z + outNz * offset };
    appendPathPoint(smoothed, a.x, a.z);
    for (let s = 1; s < CURVE_SAMPLES; s++) {
      const t = s / CURVE_SAMPLES;
      const omt = 1 - t;
      const qx = omt * omt * a.x + 2 * omt * t * p1.x + t * t * b.x;
      const qz = omt * omt * a.z + 2 * omt * t * p1.z + t * t * b.z;
      appendPathPoint(smoothed, qx, qz);
    }
    appendPathPoint(smoothed, b.x, b.z);
  }

  appendPathPoint(smoothed, points[points.length - 1].x, points[points.length - 1].z);

  // Safety: if smoothing accidentally intersects opaque wall pixels, fall back to original path.
  for (let i = 1; i < smoothed.length; i++) {
    if (isMovementPathBlocked(smoothed[i - 1].x, smoothed[i - 1].z, smoothed[i].x, smoothed[i].z, CAMERA_Y)) {
      return points.slice();
    }
  }
  return smoothed;
}

function buildMovementPathData(points) {
  const path = smoothMovementPath(points);
  const lengths = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    lengths.push(total);
  }
  return { points: path, lengths, total };
}

function sampleMovementPath(points, lengths, totalLength, dist) {
  if (!points.length) return { x: desiredCameraX, z: desiredCameraZ };
  if (points.length === 1 || totalLength <= 1e-6) return points[points.length - 1];
  const d = Math.max(0, Math.min(totalLength, dist));
  for (let i = 1; i < points.length; i++) {
    if (d <= lengths[i]) {
      const segLen = Math.max(1e-6, lengths[i] - lengths[i - 1]);
      const t = (d - lengths[i - 1]) / segLen;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        z: points[i - 1].z + (points[i].z - points[i - 1].z) * t,
      };
    }
  }
  return points[points.length - 1];
}

function setActiveBunkerSlot(index, snap = false, directionHint = 0) {
  if (bunkerSlots.length === 0) return;
  const prevIndex = activeSlotIndex;
  const prevSlot = bunkerSlots[prevIndex] ?? null;
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
    movementStartTime = null;
    movementPathPoints = [];
    movementPathLengths = [];
    movementPathTotalLength = 0;
    if (assets.runningSound) { assets.runningSound.pause(); assets.runningSound.currentTime = 0; }
  } else {
    if (activeSlotIndex !== prevIndex) {
      let dir = directionHint === 0 ? 1 : (directionHint > 0 ? 1 : -1);
      if (directionHint === 0) {
        const n = bunkerSlots.length;
        const fw = (activeSlotIndex - prevIndex + n) % n;
        const bw = (prevIndex - activeSlotIndex + n) % n;
        dir = fw <= bw ? 1 : -1;
      }
      movementStartTime = gameTime;
      movementStartX = cameraX;
      movementStartZ = cameraZ;
      movementEndX = desiredCameraX;
      movementEndZ = desiredCameraZ;
      const pathPoints = buildMovementPathForSlots(prevSlot, slot, prevIndex, activeSlotIndex, dir);
      const pathData = buildMovementPathData(pathPoints);
      movementPathPoints = pathData.points;
      movementPathLengths = pathData.lengths;
      movementPathTotalLength = pathData.total;
      ironSightsHeld = false;
      if (assets.runningSound) assets.runningSound.play().catch(() => {});
      sendMultiplayerPayload('player_move', {
        fromSlotIndex: prevIndex,
        toSlotIndex: activeSlotIndex,
        at: Date.now(),
      });
    }
  }
  const localId = multiplayerSession?.playerId || '__local__';
  const me = ensureMpPlayer(localId, 'You');
  me.isLocal = true;
  me.slotIndex = activeSlotIndex;
  me.moveFromIndex = activeSlotIndex;
  me.moveToIndex = activeSlotIndex;
  if (snap) me.moving = false;
}

function moveBunkerSlot(step) {
  if (bunkerSlots.length === 0) return;
  setActiveBunkerSlot(activeSlotIndex + step, false, step);
}

function getSlotWallCenter(slot) {
  if (!slot) return 0;
  return slot.wallX ?? slot.x;
}

function getPeekOffsetForSlot(slot) {
  if (!slot || slot.type !== 'window') return { x: 0, z: 0 };
  const rawYawFromSlot = normalizeAngle(cameraYaw - slot.baseYaw);
  const absRawYaw = Math.abs(rawYawFromSlot);
  if (absRawYaw >= BUNKER_PEEK_FADE_END_YAW) return { x: 0, z: 0 };
  let peekFade = 1;
  if (absRawYaw > BUNKER_PEEK_FADE_START_YAW) {
    const t = (absRawYaw - BUNKER_PEEK_FADE_START_YAW) / Math.max(1e-6, (BUNKER_PEEK_FADE_END_YAW - BUNKER_PEEK_FADE_START_YAW));
    const smooth = t * t * (3 - 2 * t);
    peekFade = 1 - smooth;
  }
  const yawFromSlot = Math.max(-BUNKER_PEEK_MAX_YAW, Math.min(BUNKER_PEEK_MAX_YAW, rawYawFromSlot));
  const tileWidth = slot.tileWidth ?? BUNKER_WINDOW_WIDTH;
  const halfOpen = Math.max(0.05, tileWidth / 2 - BUNKER_PEEK_WINDOW_MARGIN);
  // Solve lateral shift so center shot ray intersects near opening center:
  // lateral + inset * tan(yaw) ~= 0  => lateral = -inset * tan(yaw).
  let lateral = -BUNKER_WALL_INSET * Math.tan(yawFromSlot);
  lateral = Math.max(-halfOpen, Math.min(halfOpen, lateral));
  lateral *= peekFade;
  const lateralRatio = Math.abs(lateral) / Math.max(halfOpen, 1e-6);
  const forward = lateralRatio * lateralRatio * BUNKER_PEEK_FORWARD_PUSH_MAX * peekFade;
  const rightX = Math.cos(slot.baseYaw);
  const rightZ = Math.sin(slot.baseYaw);
  const forwardX = Math.sin(slot.baseYaw);
  const forwardZ = -Math.cos(slot.baseYaw);
  return {
    x: rightX * lateral + forwardX * forward,
    z: rightZ * lateral + forwardZ * forward,
  };
}

function getWindowOpeningsForSide(side) {
  const sideNormal = side === 'north' ? { x: 0, z: -1 }
    : side === 'south' ? { x: 0, z: 1 }
      : side === 'east' ? { x: 1, z: 0 }
        : { x: -1, z: 0 };
  return bunkerWallSegments
    .filter((seg) => seg.inward.x * sideNormal.x + seg.inward.z * sideNormal.z < -0.8)
    .flatMap((seg) => seg.tiles
      .filter((tile) => tile.spriteKey !== 'wall' && tile.spriteKey !== 'wall_ammo' && tile.spriteKey !== 'wall_ammo_mirrored' && tile.spriteKey !== 'wall_tally' && tile.spriteKey !== 'wall_tally_mirrored' && tile.spriteKey !== 'ammo')
      .map((tile) => ({
        min: tile.minT,
        max: tile.maxT,
        segmentIndex: seg.index,
      bottom: 0,
      top: BUNKER_WALL_HEIGHT,
      })))
    .sort((a, b) => a.segmentIndex - b.segmentIndex || a.min - b.min);
}

function getWindowSlots() {
  return bunkerSlots.filter((slot) => slot.type === 'window');
}

function getZombieWindowTarget(slot) {
  if (!slot) return { x: WORLD_CENTER_X, z: WORLD_CENTER_Z };
  return { x: slot.wallX ?? slot.x, z: slot.wallZ ?? slot.z };
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

function getSlotKey(slot) {
  if (!slot) return '';
  return `${slot.segmentIndex ?? 0}-${slot.tileIndex ?? 0}-${slot.type ?? 'slot'}`;
}

function isReticuleOnBoardStack(px, py) {
  const slot = getCurrentBunkerSlot();
  if (!slot || slot.type !== 'window') return false;
  const key = getSlotKey(slot);
  const onFloor = BOARDS_PER_WINDOW - (windowBoards[key] ?? 0);
  if (onFloor <= 0) return false;
  if (worldRenderer?.isReady()) {
    if (cameraPitch < 0.06) return false;
    const hit = worldRenderer.pickFirst(px, py, ['window']);
    return !!hit && Number(hit.userData?.slotIndex) === activeSlotIndex;
  }
  // Minimum look-down so boards at wall foot are visible; wood in frame
  if (cameraPitch < 0.06) return false;
  const floorPoses = getBoardFloorPositions(slot);
  if (floorPoses.length === 0) return false;
  const first = floorPoses[0];
  const proj = project(first.x, 0.02, first.z);
  if (!proj) return false;
  const dist = Math.sqrt((px - proj.sx) ** 2 + (py - proj.sy) ** 2);
  const radius = 95;
  if (dist > radius) return false;
  // Wood in frame: pile should be in lower part of view
  if (proj.sy < H / 2 - 60) return false;
  return true;
}

function seeded(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 0x100000000;
  };
}

function initWindowBoards() {
  windowBoards = {};
  for (const slot of bunkerSlots) {
    if (slot.type !== 'window') continue;
    windowBoards[getSlotKey(slot)] = 0;
  }
}

function createSeededRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function hashStringFNV1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function distancePointToSegment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  if (lenSq <= 1e-8) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / lenSq));
  const qx = ax + abx * t;
  const qz = az + abz * t;
  return Math.hypot(px - qx, pz - qz);
}

function isPointInsidePolygon(x, z, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].x;
    const zi = corners[i].z;
    const xj = corners[j].x;
    const zj = corners[j].z;
    const intersects = ((zi > z) !== (zj > z))
      && (x < ((xj - xi) * (z - zi)) / Math.max(1e-8, (zj - zi)) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPathSegmentBlocked(ax, az, bx, bz, y, treeList, allowTouchAtEnd = false, allowNonOpaqueCrossing = false) {
  if (isPointInsidePolygon(ax, az, bunker.corners) || isPointInsidePolygon(bx, bz, bunker.corners)) return true;
  const segLen = Math.hypot(bx - ax, bz - az);
  if (segLen <= 1e-6) return false;
  // block on trees
  for (const t of treeList) {
    if (distancePointToSegment(t.x, t.z, ax, az, bx, bz) < TREE_BLOCK_RADIUS) return true;
  }
  // block on bunker walls
  const EPS = 1e-5;
  const cross2 = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const rX = bx - ax;
  const rZ = bz - az;
  for (const segment of bunkerWallSegments) {
    const sX = segment.b.x - segment.a.x;
    const sZ = segment.b.z - segment.a.z;
    const rxs = cross2(rX, rZ, sX, sZ);
    if (Math.abs(rxs) < EPS) continue;
    const qmpX = segment.a.x - ax;
    const qmpZ = segment.a.z - az;
    const t = cross2(qmpX, qmpZ, sX, sZ) / rxs;
    const u = cross2(qmpX, qmpZ, rX, rZ) / rxs;
    const maxT = allowTouchAtEnd ? 1.0 - 0.001 : 0.999;
    if (t <= 0.001 || t >= maxT || u < -EPS || u > 1 + EPS) continue;
    if (y <= 0 || y >= BUNKER_WALL_HEIGHT) continue;
    const alpha = sampleBunkerWallAlpha(segment, Math.max(0, Math.min(1, u)), y);
    if (alpha > BUNKER_WALL_ALPHA_PASS_THRESHOLD) return true;
    // During route planning, prevent cutting through any wall opening except explicit final approach.
    if (!allowNonOpaqueCrossing) return true;
  }
  return false;
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return total;
}

function isZombiePathOutsideBunker(points) {
  if (!points || points.length < 2 || !bunker?.corners?.length) return false;
  const inside = (x, z) =>
    isPointInsidePolygon(x, z, bunker.corners) &&
    !(bunker.holes || []).some((h) => isPointInsidePolygon(x, z, h));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(2, Math.ceil(segLen / 0.2));
    for (let s = 0; s <= steps; s++) {
      // Ignore exact final endpoint (window center is on wall plane by design).
      if (i === points.length - 1 && s === steps) continue;
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (inside(x, z)) return false;
    }
  }
  return true;
}

function choosePathForZombie(start, target, rng, treeList) {
  const targetPt = { x: target.x, z: target.z };
  const direct = [start, targetPt];
  const choices = [];
  if (!isPathSegmentBlocked(start.x, start.z, targetPt.x, targetPt.z, CAMERA_Y, treeList, true, false)) {
    choices.push({ style: 'direct', points: direct });
  }

  // Around-bunker routes using inset corners
  const cornerPts = bunker.corners.map((c, i) => {
    const n1 = bunkerWallSegments[(i - 1 + bunkerWallSegments.length) % bunkerWallSegments.length]?.inward ?? { x: 0, z: 0 };
    const n2 = bunkerWallSegments[i]?.inward ?? { x: 0, z: 0 };
    return { x: c.x + (n1.x + n2.x) * BUNKER_WALL_INSET * 0.8, z: c.z + (n1.z + n2.z) * BUNKER_WALL_INSET * 0.8 };
  });
  function nearestCornerIndex(p) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < cornerPts.length; i++) {
      const d = Math.hypot(p.x - cornerPts[i].x, p.z - cornerPts[i].z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  const ciStart = nearestCornerIndex(start);
  const ciEnd = nearestCornerIndex(targetPt);
  for (const dir of [1, -1]) {
    const pts = [start];
    let i = ciStart;
    let safety = 0;
    while (i !== ciEnd && safety++ < cornerPts.length + 2) {
      i = (i + dir + cornerPts.length) % cornerPts.length;
      pts.push(cornerPts[i]);
    }
    pts.push(targetPt);
    let ok = true;
    for (let p = 1; p < pts.length; p++) {
      if (isPathSegmentBlocked(pts[p - 1].x, pts[p - 1].z, pts[p].x, pts[p].z, CAMERA_Y, treeList, p === pts.length - 1, false)) {
        ok = false;
        break;
      }
    }
    if (ok) choices.push({ style: dir > 0 ? 'around_cw' : 'around_ccw', points: pts });
  }

  // Zigzag: one random mid waypoint offset from direct line
  const dx = targetPt.x - start.x;
  const dz = targetPt.z - start.z;
  const d = Math.hypot(dx, dz);
  if (d > 1) {
    const ux = dx / d;
    const uz = dz / d;
    const px = -uz;
    const pz = ux;
    const midT = 0.35 + rng() * 0.3;
    const bend = (rng() < 0.5 ? -1 : 1) * (2.5 + rng() * 4.0);
    const mid = { x: start.x + dx * midT + px * bend, z: start.z + dz * midT + pz * bend };
    const zz = [start, mid, targetPt];
    let ok = !isPathSegmentBlocked(start.x, start.z, mid.x, mid.z, CAMERA_Y, treeList, false, false)
      && !isPathSegmentBlocked(mid.x, mid.z, targetPt.x, targetPt.z, CAMERA_Y, treeList, true, false);
    if (ok) choices.push({ style: 'zigzag', points: zz });
  }

  if (!choices.length) return { style: 'direct', points: direct };
  return choices[Math.floor(rng() * choices.length)];
}

function generateGameParameters(seed = GAME_PARAM_SEED, waveCount = GAME_PARAM_WAVE_COUNT, playerCount = 1) {
  const rng = createSeededRng(seed);
  const effectivePlayers = Math.max(1, Math.floor(Number(playerCount) || 1));
  const params = {
    version: 1,
    seed,
    waveCount,
    playerCount: effectivePlayers,
    bunker: {
      layoutId: currentBunkerLayoutId,
      corners: (bunker.corners ?? []).map((c) => ({ x: +c.x.toFixed(3), z: +c.z.toFixed(3) })),
      segments: bunkerWallSegments.map((s) => ({
        index: s.index,
        tiles: s.tiles.map((t) => t.spriteKey),
      })),
    },
    trees: [],
    zombies: [],
  };

  // trees from seed
  for (let i = 0; i < TREE_COUNT; i++) {
    let placed = false;
    for (let tries = 0; tries < 80 && !placed; tries++) {
      const dist = TREE_MIN_DIST + rng() * (TREE_MAX_DIST - TREE_MIN_DIST);
      const angle = rng() * Math.PI * 2;
      const x = WORLD_CENTER_X + Math.cos(angle) * dist;
      const z = WORLD_CENTER_Z + Math.sin(angle) * dist;
      if (isPointInsidePolygon(x, z, bunker.corners)) continue;
      if (params.trees.some((t) => Math.hypot(t.x - x, t.z - z) < TREE_BLOCK_RADIUS * 2.5)) continue;
      params.trees.push({ x: +x.toFixed(3), z: +z.toFixed(3), spriteIndex: Math.floor(rng() * 14), hp: TREE_HP });
      placed = true;
    }
  }

  let tSpawn = 0;
  let spawnIdx = 0;
  const windowSlots = getWindowSlots();
  const treeList = params.trees.map((t) => ({ x: t.x, z: t.z }));
  const triangular = (n) => (n * (n + 1)) / 2;
  for (let wave = 0; wave < waveCount; wave++) {
    const w1 = wave + 1;
    const baseWaveSize = WAVE_TRIANGLE_CONSTANT + triangular(w1 + WAVE_TRIANGLE_OFFSET);
    const waveSize = baseWaveSize * effectivePlayers * ZOMBIE_COUNT_MULTIPLIER;
    const hotWindowSlot = windowSlots.length ? windowSlots[Math.floor(rng() * windowSlots.length)] : null;
    const hotSegmentSlots = hotWindowSlot
      ? windowSlots.filter((s) => s.segmentIndex === hotWindowSlot.segmentIndex)
      : [];
    for (let n = 0; n < waveSize; n++) {
      let targetSlot = windowSlots.length ? windowSlots[(spawnIdx + n) % windowSlots.length] : null;
      if (windowSlots.length && hotWindowSlot) {
        const r = rng();
        if (r < WAVE_HOT_WINDOW_WEIGHT) {
          targetSlot = hotWindowSlot;
        } else if (r < WAVE_HOT_WINDOW_WEIGHT + WAVE_HOT_SEGMENT_WEIGHT && hotSegmentSlots.length) {
          targetSlot = hotSegmentSlots[Math.floor(rng() * hotSegmentSlots.length)];
        } else {
          const coolSlots = windowSlots.filter((s) => s !== hotWindowSlot);
          if (coolSlots.length) targetSlot = coolSlots[Math.floor(rng() * coolSlots.length)];
        }
      }
      if (!targetSlot) continue;
      const target = getZombieWindowTarget(targetSlot);
      const targetNormal = targetSlot.normal ?? { x: 0, z: 1 }; // inward
      const approach = { x: target.x - targetNormal.x * 3.8, z: target.z - targetNormal.z * 3.8 };
      let start = null;
      let planned = null;
      for (let tries = 0; tries < 160; tries++) {
        const angle = rng() * Math.PI * 2;
        const dist = SPAWN_MIN_DIST + rng() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
        const sx = WORLD_CENTER_X + Math.cos(angle) * dist;
        const sz = WORLD_CENTER_Z + Math.sin(angle) * dist;
        if (isPointInsidePolygon(sx, sz, bunker.corners)) continue;
        if (treeList.some((tt) => Math.hypot(tt.x - sx, tt.z - sz) < TREE_BLOCK_RADIUS * 1.2)) continue;
        const path = choosePathForZombie({ x: sx, z: sz }, approach, rng, treeList);
        const pathWithFinal = { style: path.style, points: [...path.points, target] };
        const last = pathWithFinal.points.length - 1;
        if (last < 1) continue;
        if (isPathSegmentBlocked(
          pathWithFinal.points[last - 1].x,
          pathWithFinal.points[last - 1].z,
          pathWithFinal.points[last].x,
          pathWithFinal.points[last].z,
          CAMERA_Y,
          treeList,
          true,
          true,
        )) continue;
        if (!isZombiePathOutsideBunker(pathWithFinal.points)) continue;
        const plen = pathLength(pathWithFinal.points);
        if (plen < ZOMBIE_MIN_PATH_LENGTH) continue;
        start = { x: sx, z: sz };
        planned = pathWithFinal;
        break;
      }
      if (!start || !planned) {
        const sx = target.x - targetNormal.x * (SPAWN_MAX_DIST + 8);
        const sz = target.z - targetNormal.z * (SPAWN_MAX_DIST + 8);
        const fallback = [{ x: sx, z: sz }, approach, target];
        let ok = true;
        for (let pIdx = 1; pIdx < fallback.length; pIdx++) {
          if (isPathSegmentBlocked(
            fallback[pIdx - 1].x, fallback[pIdx - 1].z,
            fallback[pIdx].x, fallback[pIdx].z,
            CAMERA_Y, treeList, pIdx === fallback.length - 1, pIdx === fallback.length - 1,
          )) {
            ok = false;
            break;
          }
        }
        if (ok && isZombiePathOutsideBunker(fallback) && pathLength(fallback) >= ZOMBIE_MIN_PATH_LENGTH) {
          start = { x: sx, z: sz };
          planned = { style: 'fallback', points: fallback };
        }
      }
      if (!start || !planned) continue;
      const speedMult = 0.72 + rng() * 0.58;
      const walkPhase = rng() * Math.PI * 2;
      const spriteIndex = Math.floor(rng() * Math.max(1, assets.zombieSprites.length));
      params.zombies.push({
        id: spawnIdx,
        wave,
        spawnTime: +tSpawn.toFixed(3),
        speedMult: +speedMult.toFixed(4),
        walkPhase: +walkPhase.toFixed(4),
        spriteIndex,
        targetSlotKey: getSlotKey(targetSlot),
        targetWindowX: +target.x.toFixed(3),
        targetWindowZ: +target.z.toFixed(3),
        pathStyle: planned.style,
        path: planned.points.map((p) => ({ x: +p.x.toFixed(3), z: +p.z.toFixed(3) })),
      });
      tSpawn += WAVE_SPAWN_INTERVAL;
      spawnIdx++;
    }
    tSpawn += WAVE_GAP_BASE_SECONDS + wave * WAVE_GAP_WAVE_STEP_SECONDS;
  }

  params.zombieCount = params.zombies.length;
  const hashInput = stableStringify(params);
  return { params, hash: hashStringFNV1a(hashInput) };
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

function pushPolygon(polys, points, fill, stroke = null, texture = null) {
  const viewPoints = clipPolygonToNear(points.map((p) => worldToView(p.x, p.y, p.z)));
  if (viewPoints.length < 3) return;
  const projected = viewPoints.map(projectViewPoint);
  const avgDepth = viewPoints.reduce((sum, p) => sum + p.depth, 0) / viewPoints.length;
  polys.push({ projected, avgDepth, fill, stroke, texture });
}

function drawTexturedTriangle(img, s0, s1, s2, d0, d1, d2) {
  const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(det) < 1e-6) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / det;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / det;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / det;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / det;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / det;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / det;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawTexturedQuad(img, projected, texRect = null) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih || projected.length !== 4) return false;
  const tex = texRect || { sx: 0, sy: 0, sw: iw, sh: ih };
  const left = tex.sx;
  const right = tex.sx + tex.sw;
  const top = tex.sy;
  const bottom = tex.sy + tex.sh;
  const s0 = { x: left, y: bottom };
  const s1 = { x: right, y: bottom };
  const s2 = { x: right, y: top };
  const s3 = { x: left, y: top };
  const d0 = { x: projected[0].sx, y: projected[0].sy };
  const d1 = { x: projected[1].sx, y: projected[1].sy };
  const d2 = { x: projected[2].sx, y: projected[2].sy };
  const d3 = { x: projected[3].sx, y: projected[3].sy };
  drawTexturedTriangle(img, s0, s1, s2, d0, d1, d2);
  drawTexturedTriangle(img, s0, s2, s3, d0, d2, d3);
  return true;
}

function drawProjectedPolygon(poly) {
  const { projected, fill, stroke, texture } = poly;
  ctx.beginPath();
  ctx.moveTo(projected[0].sx, projected[0].sy);
  for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i].sx, projected[i].sy);
  ctx.closePath();
  const texRect = (texture && texture.sx !== undefined)
    ? { sx: texture.sx, sy: texture.sy, sw: texture.sw, sh: texture.sh }
    : null;
  const drewTexture = texture?.img ? drawTexturedQuad(texture.img, projected, texRect) : false;
  if (!drewTexture) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
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

/** Draw "AMMO" + down arrow onto a wall texture; mirrored variant is used on reversed UV segments. */
function createWallTextureWithAmmoLabel(wallImg, mirrored = false) {
  if (!wallImg?.width && !wallImg?.naturalWidth) return wallImg;
  const w = wallImg.naturalWidth || wallImg.width;
  const h = wallImg.naturalHeight || wallImg.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(wallImg, 0, 0);
  const cx = w / 2;
  const labelY = h * 0.26;
  const fontSize = Math.max(24, Math.floor(h * 0.15));
  ctx.font = `${fontSize}px Gogozombie`;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(mirrored ? 'OMMA' : 'AMMO', cx, labelY);
  const arrowTop = labelY + 4;
  const arrowTip = labelY + 4 + Math.floor(fontSize * 0.6);
  ctx.beginPath();
  ctx.moveTo(cx, arrowTip);
  ctx.lineTo(cx - fontSize * 0.35, arrowTop);
  ctx.lineTo(cx + fontSize * 0.35, arrowTop);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  return canvas;
}

function makeTallyMarks(n) {
  // Tally Mark font mapping from assets/font/Readme.txt:
  // a=1, b=2, c=3, d=4, e=5
  const ONE = 'a';
  const TWO = 'b';
  const THREE = 'c';
  const FOUR = 'd';
  const FIVE = 'e';
  const count = Math.max(0, Math.floor(n));
  const groups = Math.floor(count / 5);
  const rem = count % 5;
  const remSymbol = rem === 1 ? ONE : rem === 2 ? TWO : rem === 3 ? THREE : rem === 4 ? FOUR : '';
  const body = `${FIVE.repeat(groups)}${remSymbol}`;
  return body || '-';
}

function wrapTallyText(text, maxCharsPerLine = 10) {
  const chars = Array.from(text || '');
  if (chars.length <= maxCharsPerLine) return [text];
  const lines = [];
  for (let i = 0; i < chars.length; i += maxCharsPerLine) {
    lines.push(chars.slice(i, i + maxCharsPerLine).join(''));
  }
  return lines;
}

function splitTallyByPixelWidth(ctx, text, maxWidth) {
  const chars = Array.from(text || '');
  if (!chars.length) return ['-'];
  const lines = [];
  let line = '';
  for (const ch of chars) {
    const next = line + ch;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['-'];
}

function updateTallyWallTextures() {
  if (!assets.bunkerWall) return;
  const total = gameParams?.zombieCount ?? zombieSpawnPlan.length ?? 0;
  const killed = Math.max(0, score);
  const remaining = Math.max(0, total - killed);
  if (killed === tallyWallLastKilled && remaining === tallyWallLastRemaining && assets.bunkerWallWithTally && assets.bunkerWallWithTallyMirrored) return;
  tallyWallLastKilled = killed;
  tallyWallLastRemaining = remaining;

  const wallImg = assets.bunkerWall;
  const w = wallImg.naturalWidth || wallImg.width;
  const h = wallImg.naturalHeight || wallImg.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const cx = canvas.getContext('2d');
  cx.drawImage(wallImg, 0, 0);
  cx.fillStyle = '#fff';
  const labelKilled = 'Zombies killed:';
  const labelRemaining = 'Zombies remaining:';
  const killedText = makeTallyMarks(killed);
  const remainingText = makeTallyMarks(remaining);
  const left = Math.floor(w * 0.08);
  const top = Math.floor(h * 0.08);
  const maxW = Math.floor(w * 0.84);
  const maxH = Math.floor(h * 0.84);
  const sectionGap = Math.floor(h * 0.045);
  const minTally = 10;
  let tallySize = Math.max(16, Math.floor(h * 0.19));
  let titleSize = Math.max(10, Math.floor(tallySize * 0.62));
  let chosen = null;

  for (; tallySize >= minTally; tallySize--) {
    titleSize = Math.max(10, Math.floor(tallySize * 0.62));
    const lineH = Math.max(8, Math.floor(tallySize * 0.78)); // tight spacing

    cx.font = `${titleSize}px Gogozombie`;
    const labelKilledW = cx.measureText(`${labelKilled} `).width;
    const labelRemainingW = cx.measureText(`${labelRemaining} `).width;

    cx.font = `${tallySize}px "Tally Mark", Gogozombie, sans-serif`;
    const killedFirstWidth = Math.max(12, maxW - labelKilledW);
    const remainingFirstWidth = Math.max(12, maxW - labelRemainingW);
    const killedLines = splitTallyByPixelWidth(cx, killedText, killedFirstWidth);
    const remainingLines = splitTallyByPixelWidth(cx, remainingText, remainingFirstWidth);
    if (killedLines.length > 1) {
      const rest = splitTallyByPixelWidth(cx, killedLines.slice(1).join(''), maxW);
      killedLines.splice(1, killedLines.length - 1, ...rest);
    }
    if (remainingLines.length > 1) {
      const rest = splitTallyByPixelWidth(cx, remainingLines.slice(1).join(''), maxW);
      remainingLines.splice(1, remainingLines.length - 1, ...rest);
    }

    const sec1H = Math.max(titleSize, lineH * killedLines.length);
    const sec2H = Math.max(titleSize, lineH * remainingLines.length);
    const totalH = sec1H + sectionGap + sec2H;
    if (totalH <= maxH) {
      chosen = { titleSize, tallySize, lineH, labelKilledW, labelRemainingW, killedLines, remainingLines, sec1H };
      break;
    }
  }

  if (!chosen) {
    // Fallback: tiny but guaranteed to fit.
    chosen = {
      titleSize: 10,
      tallySize: 10,
      lineH: 8,
      labelKilledW: 70,
      labelRemainingW: 95,
      killedLines: splitTallyByPixelWidth(cx, killedText, maxW),
      remainingLines: splitTallyByPixelWidth(cx, remainingText, maxW),
      sec1H: 24,
    };
  }

  cx.textAlign = 'left';
  cx.textBaseline = 'top';
  cx.font = `${chosen.titleSize}px Gogozombie`;
  cx.fillText(labelKilled, left, top);
  cx.fillText(labelRemaining, left, top + chosen.sec1H + sectionGap);

  cx.font = `${chosen.tallySize}px "Tally Mark", Gogozombie, sans-serif`;
  for (let i = 0; i < chosen.killedLines.length; i++) {
    const x = i === 0 ? left + Math.floor(chosen.labelKilledW) : left;
    const y = top + i * chosen.lineH;
    cx.fillText(chosen.killedLines[i], x, y);
  }
  for (let i = 0; i < chosen.remainingLines.length; i++) {
    const x = i === 0 ? left + Math.floor(chosen.labelRemainingW) : left;
    const y = top + chosen.sec1H + sectionGap + i * chosen.lineH;
    cx.fillText(chosen.remainingLines[i], x, y);
  }
  assets.bunkerWallWithTally = canvas;

  const flipped = document.createElement('canvas');
  flipped.width = w;
  flipped.height = h;
  const fx = flipped.getContext('2d');
  fx.translate(w, 0);
  fx.scale(-1, 1);
  fx.drawImage(canvas, 0, 0);
  assets.bunkerWallWithTallyMirrored = flipped;
  worldStaticDirty = true;
}

function getBunkerWallImageAndData(spriteKey) {
  if (spriteKey === 'window') return { img: assets.bunkerWallWindow, data: assets.bunkerWallWindowData };
  if (spriteKey === 'hole') return { img: assets.bunkerWallHole, data: assets.bunkerWallHoleData };
  if (spriteKey === 'door') return { img: assets.bunkerWallDoor, data: assets.bunkerWallDoorData };
  if (spriteKey === 'wall_ammo') return { img: assets.bunkerWallWithAmmo, data: assets.bunkerWallWithAmmoData };
  if (spriteKey === 'wall_ammo_mirrored') return { img: assets.bunkerWallWithAmmoMirrored, data: assets.bunkerWallWithAmmoMirroredData };
  if (spriteKey === 'wall_tally') return { img: assets.bunkerWallWithTally || assets.bunkerWall, data: assets.bunkerWallData };
  if (spriteKey === 'wall_tally_mirrored') return { img: assets.bunkerWallWithTallyMirrored || assets.bunkerWall, data: assets.bunkerWallData };
  return { img: assets.bunkerWall, data: assets.bunkerWallData };
}

function sampleBunkerWallAlpha(segment, u, y) {
  if (!segment?.tiles?.length) return 255;
  const clampedU = Math.max(0, Math.min(0.999999, u));
  const tileIdx = Math.min(segment.tiles.length - 1, Math.floor(clampedU * segment.tiles.length));
  const tile = segment.tiles[tileIdx];
  if (!tile) return 255;
  const { data } = getBunkerWallImageAndData(tile.spriteKey);
  if (!data?.width || !data?.height) {
    return (tile.spriteKey === 'wall' || tile.spriteKey === 'wall_ammo' || tile.spriteKey === 'wall_ammo_mirrored' || tile.spriteKey === 'wall_tally' || tile.spriteKey === 'wall_tally_mirrored') ? 255 : 0;
  }
  const tileU = Math.max(0, Math.min(0.999999, (clampedU - tile.minT) / Math.max(tile.maxT - tile.minT, 1e-6)));
  const v = Math.max(0, Math.min(0.999999, 1 - y / BUNKER_WALL_HEIGHT));
  const tx = Math.floor(tileU * data.width);
  const ty = Math.floor(v * data.height);
  return data.data[(ty * data.width + tx) * 4 + 3];
}

function shotLeavesThroughWindow(px, py) {
  const current = getCurrentBunkerSlot();
  if (current?.type === 'window') {
    const b = getSlotScreenBounds(current);
    if (b) {
      const pad = 4;
      return px >= (b.minSx - pad) && px <= (b.maxSx + pad) && py >= (b.syTop - pad) && py <= (b.syBottom + pad);
    }
  }
  if (!bunker) return true;
  const dir = getShotDirection(px, py);
  const origin = { x: cameraX, y: CAMERA_Y, z: cameraZ };
  const EPS = 1e-5;
  const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;
  let first = null;
  for (const segment of bunkerWallSegments) {
    const rX = dir.x;
    const rZ = dir.z;
    const sX = segment.b.x - segment.a.x;
    const sZ = segment.b.z - segment.a.z;
    const rxs = cross2(rX, rZ, sX, sZ);
    if (Math.abs(rxs) < EPS) continue;
    const qmpX = segment.a.x - origin.x;
    const qmpZ = segment.a.z - origin.z;
    const t = cross2(qmpX, qmpZ, sX, sZ) / rxs;
    const u = cross2(qmpX, qmpZ, rX, rZ) / rxs;
    if (t <= EPS || u < -EPS || u > 1 + EPS) continue;
    const hit = {
      t,
      u: Math.max(0, Math.min(1, u)),
      y: origin.y + dir.y * t,
      segment,
    };
    if (!first || hit.t < first.t) first = hit;
  }

  if (!first) return true;
  if (first.y <= 0) return false;
  if (first.y >= BUNKER_WALL_HEIGHT) return true;
  const alpha = sampleBunkerWallAlpha(first.segment, first.u, first.y);
  return alpha <= BUNKER_WALL_ALPHA_PASS_THRESHOLD;
}

/** True when line of sight from camera to world point is not blocked by an opaque wall pixel. */
function isWorldPointVisibleFromCamera(wx, wy, wz, nearTargetCutoff = 0.995) {
  if (!bunker || !bunkerWallSegments?.length) return true;
  const origin = { x: cameraX, y: CAMERA_Y, z: cameraZ };
  const dir = { x: wx - origin.x, y: wy - origin.y, z: wz - origin.z };
  const EPS = 1e-5;
  const cross2 = (ax, az, bx, bz) => ax * bz - az * bx;
  for (const segment of bunkerWallSegments) {
    const rX = dir.x;
    const rZ = dir.z;
    const sX = segment.b.x - segment.a.x;
    const sZ = segment.b.z - segment.a.z;
    const rxs = cross2(rX, rZ, sX, sZ);
    if (Math.abs(rxs) < EPS) continue;
    const qmpX = segment.a.x - origin.x;
    const qmpZ = segment.a.z - origin.z;
    const t = cross2(qmpX, qmpZ, sX, sZ) / rxs;
    const u = cross2(qmpX, qmpZ, rX, rZ) / rxs;
    // Treat hits before the target point only; ignore near-target wall contact.
    if (t <= EPS || t >= nearTargetCutoff || u < -EPS || u > 1 + EPS) continue;
    const y = origin.y + dir.y * t;
    if (y <= 0 || y >= BUNKER_WALL_HEIGHT) continue;
    const alpha = sampleBunkerWallAlpha(segment, Math.max(0, Math.min(1, u)), y);
    if (alpha > BUNKER_WALL_ALPHA_PASS_THRESHOLD) return false;
  }
  return true;
}

/** Visibility test for an upright actor body: sample multiple heights and require majority visible. */
function isWorldActorVisibleFromCamera(wx, floorY, actorHeight, wz) {
  const h = Math.max(0.2, actorHeight || 1);
  const base = floorY + 0.04;
  const ys = [
    base,
    floorY + h * 0.32,
    floorY + h * 0.62,
    floorY + h * 0.9,
  ];
  let visible = 0;
  for (const y of ys) {
    // Slightly stricter near-target cutoff reduces corner "peek-through" artifacts.
    if (isWorldPointVisibleFromCamera(wx, y, wz, 0.985)) visible++;
  }
  return visible >= 2;
}

function getCrateAABB() {
  if (!bunker) return null;
  const crateSlot = bunkerSlots.find((slot) => slot.type === 'crate');
  if (!crateSlot) return null;
  const n = crateSlot.normal ?? { x: 0, z: 1 };
  const t = crateSlot.tangent ?? { x: 1, z: 0 };
  const wallX = crateSlot.wallX ?? crateSlot.x;
  const wallZ = crateSlot.wallZ ?? crateSlot.z;
  const centerX = wallX + n.x * (0.08 + BUNKER_CRATE_DEPTH / 2);
  const centerZ = wallZ + n.z * (0.08 + BUNKER_CRATE_DEPTH / 2);
  const halfX = Math.abs(t.x) * (BUNKER_CRATE_WIDTH / 2) + Math.abs(n.x) * (BUNKER_CRATE_DEPTH / 2);
  const halfZ = Math.abs(t.z) * (BUNKER_CRATE_WIDTH / 2) + Math.abs(n.z) * (BUNKER_CRATE_DEPTH / 2);
  return {
    minX: centerX - halfX, maxX: centerX + halfX,
    minY: BUNKER_FLOOR_Y, maxY: BUNKER_FLOOR_Y + BUNKER_CRATE_HEIGHT,
    minZ: centerZ - halfZ, maxZ: centerZ + halfZ,
  };
}

function isReticuleOnCrate(px, py) {
  if (worldRenderer?.isReady()) return !!worldRenderer.pickFirst(px, py, ['crate']);
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
  assets.menuBackground = await loadImage(`${base}/backgrounds/spooky_forest.png`);
  assets.playerSpriteSide = await loadImage(`${base}/soldier_side.png`);
  assets.playerSpriteBack = await loadImage(`${base}/soldier_back.png`);
  assets.rifleFire = await loadImage(`${base}/lee_enfield-Sheet.png`);
  assets.rifleReload = await loadImage(`${base}/lee_enfield_reload-Sheet.png`);
  assets.zombie = await loadImage(`${base}/german_zombie.png`);
  assets.zombieFront = await loadImage(`${base}/front_facing_zombie.png`);
  assets.zombiePickelhaube = await loadImage(`${base}/pickelhaube_zombie.png`);
  assets.zombieFemaleGhoul = await loadImage(`${base}/female_ghoul_in_nightgown.png`);
  assets.zombieGasMask = await loadImage(`${base}/gas_mask_zombie.png`);
  assets.zombieSprites = [assets.zombie, assets.zombieFront, assets.zombiePickelhaube, assets.zombieFemaleGhoul, assets.zombieGasMask].filter(Boolean);
  assets.zombieHeadshotMask = await loadImage(`${base}/german_zombie_headshot_area.png`);
  assets.zombieFrontHeadshotMask = await loadImage(`${base}/front_facing_zombie_headshot_area.png`);
  assets.zombiePickelhaubeHeadshotMask = await loadImage(`${base}/pickelhaube_zombie_headshot_area.png`);
  assets.zombieFemaleGhoulHeadshotMask = await loadImage(`${base}/female_ghoul_in_nightgown_headshot_area.png`);
  assets.zombieGasMaskHeadshotMask = await loadImage(`${base}/gas_mask_zombie_headshot_area.png`);
  assets.zombieHeadshotData = imageDataFromImage(assets.zombieHeadshotMask);
  assets.zombieFrontHeadshotData = imageDataFromImage(assets.zombieFrontHeadshotMask);
  assets.zombiePickelhaubeHeadshotData = imageDataFromImage(assets.zombiePickelhaubeHeadshotMask);
  assets.zombieFemaleGhoulHeadshotData = imageDataFromImage(assets.zombieFemaleGhoulHeadshotMask);
  assets.zombieGasMaskHeadshotData = imageDataFromImage(assets.zombieGasMaskHeadshotMask);
  assets.retrotree = await loadImage(`${base}/RetroTree.png`);
  assets.bunkerWall = await loadImage(`${base}/bunker/wall.png`);
  assets.bunkerWallWindow = await loadImage(`${base}/bunker/wall_with_window.png`);
  assets.bunkerWallHole = await loadImage(`${base}/bunker/wall_with_hole.png`);
  assets.bunkerWallDoor = await loadImage(`${base}/bunker/wall_with_door.png`);
  if (document.fonts?.load) await document.fonts.load('1em Gogozombie');
  assets.bunkerWallWithAmmo = createWallTextureWithAmmoLabel(assets.bunkerWall, false) || assets.bunkerWall;
  assets.bunkerWallWithAmmoMirrored = createWallTextureWithAmmoLabel(assets.bunkerWall, true) || assets.bunkerWall;
  assets.bunkerWallData = imageDataFromImage(assets.bunkerWall);
  assets.bunkerWallWindowData = imageDataFromImage(assets.bunkerWallWindow);
  assets.bunkerWallHoleData = imageDataFromImage(assets.bunkerWallHole);
  assets.bunkerWallDoorData = imageDataFromImage(assets.bunkerWallDoor);
  assets.bunkerWallWithAmmoData = imageDataFromImage(assets.bunkerWallWithAmmo);
  assets.bunkerWallWithAmmoMirroredData = imageDataFromImage(assets.bunkerWallWithAmmoMirrored);
  assets.board = await loadImage(`${base}/bunker/board.png`);
  assets.floorboardsTiled = await loadImage(`${base}/bunker/floorboards_tiled.png`);
  assets.crateSpriteSheet = await loadImage(`${base}/bunker/crate_sprite_sheet.png`);
  assets.ammo = await loadImage(`${base}/ammo.png`);
  assets.hammerSound = new Audio('assets/sfx/clean/hammer_nails.ogg');
  assets.hammerSound.preload = 'auto';
  assets.boardBreakSound = new Audio('assets/sfx/clean/board_breaking.ogg');
  assets.boardBreakSound.preload = 'auto';
  assets.runningSound = new Audio('assets/sfx/clean/boots_running.ogg');
  assets.runningSound.preload = 'auto';
  assets.runningSound.loop = true;
  setCurrentBunkerLayout(menuState.matchSettings.bunkerLayoutId);
  const horizonPath = `${base}/${HORIZON_BACKGROUND_PATH}`;
  assets.horizonBackground = await loadImage(horizonPath);
  if (assets.horizonBackground) {
    applyHorizonBackgroundColors(assets.horizonBackground);
    buildHorizonForestTexture();
  }
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
  assets.zombieSounds = assets.zombieSoundPaths.map((path) => {
    const a = new Audio(path);
    a.preload = 'auto';
    return a;
  });
  assets.zombieFemaleSounds = assets.zombieFemaleSoundPaths.map((path) => {
    const a = new Audio(path);
    a.preload = 'auto';
    return a;
  });
  generateFogWisps();
  const planned = generateGameParameters(GAME_PARAM_SEED, GAME_PARAM_WAVE_COUNT, 1);
  gameParams = planned.params;
  gameParamsHash = planned.hash;
  zombieSpawnPlan = gameParams.zombies ?? [];
  nextZombiePlanIndex = 0;
  spawnCounter = 0;
  generateTrees();
  window.__gameParameters = gameParams;
  window.__gameParametersHash = gameParamsHash;
  console.log(`Game params hash: ${gameParamsHash}`);
  if (document.fonts?.load) await document.fonts.load('1em "Tally Mark"');
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
function getPositionalGainPan(worldX, worldZ, refDist = POSITIONAL_REF_DIST) {
  const dx = worldX - cameraX;
  const dz = worldZ - cameraZ;
  const distanceSq = dx * dx + dz * dz;
  const safeRef = Math.max(0.5, Number(refDist) || POSITIONAL_REF_DIST);
  const refSq = safeRef * safeRef;
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
  let source = null;
  let gainNode = null;
  let panner = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { audio.pause(); } catch {}
    try { source?.disconnect(); } catch {}
    try { gainNode?.disconnect(); } catch {}
    try { panner?.disconnect(); } catch {}
    try { audio.removeAttribute('src'); } catch {}
    try { audio.load(); } catch {}
  };
  try {
    source = ctx.createMediaElementSource(audio);
    gainNode = ctx.createGain();
    panner = ctx.createStereoPanner();
    gainNode.gain.value = gain;
    panner.pan.value = pan;
    source.connect(gainNode);
    gainNode.connect(panner);
    panner.connect(ctx.destination);
  } catch {
    audio.volume = Math.min(1, gain);
  }
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  setTimeout(cleanup, 3000);
  audio.play().catch(cleanup);
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
  if (nextZombiePlanIndex >= zombieSpawnPlan.length) return;
  const p = zombieSpawnPlan[nextZombiePlanIndex];
  if (!p || gameTime < (p.spawnTime ?? 0)) return;
  nextZombiePlanIndex++;

  const pathPoints = (p.path ?? []).map((q) => ({ x: q.x, z: q.z }));
  if (pathPoints.length < 2) return;
  const pathLengths = [0];
  let pathTotal = 0;
  for (let i = 1; i < pathPoints.length; i++) {
    pathTotal += Math.hypot(pathPoints[i].x - pathPoints[i - 1].x, pathPoints[i].z - pathPoints[i - 1].z);
    pathLengths.push(pathTotal);
  }
  const x = pathPoints[0].x;
  const z = pathPoints[0].z;
  const targetSlot = bunkerSlots.find((s) => getSlotKey(s) === p.targetSlotKey) || chooseZombieTargetSlot(x, z);
  const target = { x: p.targetWindowX, z: p.targetWindowZ };
  const sprite = assets.zombieSprites.length > 0
    ? assets.zombieSprites[(p.spriteIndex ?? 0) % assets.zombieSprites.length]
    : assets.zombie;
  const spawnIndex = spawnCounter++;
  const spawnTime = gameTime;
  const useFemaleSounds = sprite === assets.zombieFemaleGhoul;
  const soundPool = useFemaleSounds ? assets.zombieFemaleSounds : assets.zombieSounds;
  const numSounds = soundPool?.length ?? 0;
  zombies.push({
    x, y: 0, z, hp: ZOMBIE_HP_MAX,
    walkPhase: p.walkPhase ?? 0,
    targetSlot,
    targetSide: targetSlot?.side ?? null,
    targetWindowX: target.x,
    targetWindowZ: target.z,
    speedMult: p.speedMult ?? 1,
    sprite,
    spriteW: sprite?.naturalWidth ?? ZOMBIE_SPRITE_W,
    spriteH: sprite?.naturalHeight ?? ZOMBIE_SPRITE_H,
    spawnIndex,
    spawnTime,
    lastSoundN: 0,
    useFemaleSounds,
    pathPoints,
    pathLengths,
    pathTotal,
    pathDist: 0,
    pathSegIndex: 1,
  });
  if (numSounds > 0) {
    const which = spawnIndex % numSounds;
    playPositionalClip(soundPool[which], x, z, 0.9, 2600, POSITIONAL_REF_DIST * 1.2);
  }
}

function updateZombies(dt) {
  if (gameOver) return;
  for (const z of zombies) {
    const soundPool = z.useFemaleSounds ? assets.zombieFemaleSounds : assets.zombieSounds;
    const numSounds = soundPool?.length ?? 0;
    z.walkPhase = (z.walkPhase ?? 0) + dt * ZOMBIE_BOB_SPEED;
    z.bob = Math.sin(z.walkPhase) * ZOMBIE_BOB_AMPLITUDE;
    if (numSounds > 0) {
      const n = Math.floor((gameTime - z.spawnTime) / ZOMBIE_SOUND_INTERVAL);
      if (n > (z.lastSoundN ?? 0)) {
        z.lastSoundN = n;
        const which = (z.spawnIndex + n) % numSounds;
        playPositionalClip(soundPool[which], z.x, z.z, 0.9, 2600, POSITIONAL_REF_DIST * 1.2);
      }
    }
    const targetX = z.targetWindowX ?? WORLD_CENTER_X;
    const targetZ = z.targetWindowZ ?? WORLD_CENTER_Z;
    const dx = targetX - z.x;
    const dz = targetZ - z.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
    const slotKey = z.targetSlot ? getSlotKey(z.targetSlot) : '';
    const boardsAtWindow = slotKey ? (windowBoards[slotKey] ?? 0) : 0;

    if (d < BOARD_AT_WINDOW_DIST) {
      if (boardsAtWindow > 0) {
        z.breachStartTime = null;
        if (z.attackBoardEndTime == null) {
          z.attackBoardEndTime = gameTime + BOARD_ATTACK_DURATION;
        } else if (gameTime >= z.attackBoardEndTime) {
          const newCount = Math.max(0, boardsAtWindow - 1);
          windowBoards[slotKey] = newCount;
          markBoardBreakAlert(slotKey);
          playBoardBreakSound();
          z.attackBoardEndTime = null;
          const slot = z.targetSlot;
          if (slot) {
            const windowPoses = getBoardWindowPositions(slot);
            const floorPoses = getBoardFloorPositions(slot);
            const fromPos = windowPoses[boardsAtWindow - 1];
            const toIdx = 3 - boardsAtWindow;
            if (fromPos && floorPoses[toIdx]) {
              const bounds = getWindowScreenBounds(slot);
              const boardIdx = boardsAtWindow - 1;
              const frac = BOARD_WINDOW_FRACTIONS[boardIdx];
              const fromSx = bounds ? bounds.sx : null;
              const fromSy = bounds ? bounds.syTop + (bounds.syBottom - bounds.syTop) * frac : null;
              const fromDepth = bounds ? bounds.depth : null;
              fallingBoards.push({
                slotKey,
                startTime: gameTime,
                endTime: gameTime + BOARD_FALL_DURATION,
                fromPos: { x: fromPos.x, y: fromPos.y, z: fromPos.z, rot: fromPos.rot, flip: fromPos.flip },
                toPos: { x: floorPoses[toIdx].x, y: floorPoses[toIdx].y, z: floorPoses[toIdx].z, rot: floorPoses[toIdx].rot, flip: floorPoses[toIdx].flip },
                rot: fromPos.rot,
                flip: fromPos.flip,
                fromSx, fromSy, fromDepth,
              });
            }
          }
        }
      } else {
        if (z.breachStartTime == null) z.breachStartTime = gameTime;
        if (gameTime - z.breachStartTime >= BOARD_BREACH_DELAY) {
          if (multiplayerSession && multiplayerConnected) {
            proposeGameOver(z);
          } else {
            gameOverZombie = z;
            gameOver = true;
            gameOverFlashStart = performance.now() / 1000;
            const soundPool = z.useFemaleSounds ? assets.zombieFemaleSounds : assets.zombieSounds;
            const numSounds = soundPool?.length ?? 0;
            if (numSounds > 0) {
              playPositionalClip(soundPool[z.spawnIndex % numSounds], z.x, z.z, 1.0, 2800, POSITIONAL_REF_DIST * 1.3);
            }
          }
          return;
        }
      }
      continue;
    }

    const speed = ZOMBIE_SPEED * (z.speedMult ?? 1);
    if (z.pathPoints?.length >= 2 && z.pathTotal > 1e-6) {
      z.pathDist = Math.min(z.pathTotal, (z.pathDist ?? 0) + speed * dt);
      const distAlong = z.pathDist;
      const maxSegIndex = z.pathLengths.length - 1;
      let segIndex = Math.max(1, Math.min(maxSegIndex, z.pathSegIndex || 1));
      while (segIndex < maxSegIndex && distAlong > z.pathLengths[segIndex]) segIndex++;
      while (segIndex > 1 && distAlong <= z.pathLengths[segIndex - 1]) segIndex--;
      z.pathSegIndex = segIndex;
      const prevLen = z.pathLengths[segIndex - 1];
      const segLen = Math.max(1e-6, z.pathLengths[segIndex] - prevLen);
      const t = (distAlong - prevLen) / segLen;
      const a = z.pathPoints[segIndex - 1];
      const b = z.pathPoints[segIndex];
      z.x = a.x + (b.x - a.x) * t;
      z.z = a.z + (b.z - a.z) * t;
    } else {
      const ux = dx / d;
      const uz = dz / d;
      z.x += ux * speed * dt;
      z.z += uz * speed * dt;
    }

    // Safety clamp: zombies should never end up inside the bunker interior.
    if (bunker?.corners?.length >= 3 && isPointInsidePolygon(z.x, z.z, bunker.corners)) {
      let best = null;
      for (const seg of bunkerWallSegments) {
        const ax = seg.a.x;
        const az = seg.a.z;
        const bx = seg.b.x;
        const bz = seg.b.z;
        const abx = bx - ax;
        const abz = bz - az;
        const lenSq = abx * abx + abz * abz;
        let tSeg = 0;
        if (lenSq > 1e-8) tSeg = Math.max(0, Math.min(1, ((z.x - ax) * abx + (z.z - az) * abz) / lenSq));
        const qx = ax + abx * tSeg;
        const qz = az + abz * tSeg;
        const dSeg = Math.hypot(z.x - qx, z.z - qz);
        if (!best || dSeg < best.d) best = { d: dSeg, qx, qz, inward: seg.inward };
      }
      if (best) {
        const push = 0.08;
        z.x = best.qx - (best.inward?.x ?? 0) * push;
        z.z = best.qz - (best.inward?.z ?? 0) * push;
      }
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
const PARTICLE_BLAST_SPEED_MULT = 2.0;
const PARTICLE_BLAST_UPWARD_BONUS = 2.1;

let particles = [];
let tracers = []; // short-lived bullet streaks
let zombieSampleCanvas, zombieSampleCtx;
let holeCanvas, holeCtx;  // offscreen buffer for zombie-with-holes (true transparency)
let treeHoleCanvas, treeHoleCtx;  // 256x256 buffer for tree-with-holes
const TRACER_LIFE = 0.065; // seconds (~1-2 frames)
const TRACER_LENGTH = 90; // world units
const TRACER_WIDTH = 1.4; // screen px
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
      const speed = (2.5 + Math.random() * 2.5) * PARTICLE_BLAST_SPEED_MULT;
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        wx: z.x + (Math.random() - 0.5) * 0.1,
        wy: worldY + (Math.random() - 0.5) * 0.05,
        wz: z.z + (Math.random() - 0.5) * 0.1,
        vwx: Math.cos(angle) * speed,
        vwy: Math.abs(Math.sin(angle) * speed * 0.55) + PARTICLE_BLAST_UPWARD_BONUS,
        vwz: Math.sin(angle) * speed,
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
        vwx: (Math.random() - 0.5) * 2.4 * PARTICLE_BLAST_SPEED_MULT,
        vwy: Math.random() * 1.4 + PARTICLE_BLAST_UPWARD_BONUS * 0.5,
        vwz: (Math.random() - 0.5) * 2.4 * PARTICLE_BLAST_SPEED_MULT,
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

function addTracer(from, dir, color = 'rgba(255,244,200,0.95)') {
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const uz = dir.z / len;
  tracers.push({
    fromX: from.x,
    fromY: from.y,
    fromZ: from.z,
    toX: from.x + ux * TRACER_LENGTH,
    toY: from.y + uy * TRACER_LENGTH,
    toZ: from.z + uz * TRACER_LENGTH,
    life: TRACER_LIFE,
    maxLife: TRACER_LIFE,
    color,
  });
}

function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) tracers.splice(i, 1);
  }
}

function drawTracers() {
  if (!tracers.length) return;
  // In WebGL mode tracers are rendered in the world pass with depth testing.
  if (worldRenderer?.isReady()) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = TRACER_WIDTH;
  for (const t of tracers) {
    const a = project(t.fromX, t.fromY, t.fromZ);
    const b = project(t.toX, t.toY, t.toZ);
    if (!a || !b || a.depth <= NEAR || b.depth <= NEAR) continue;
    const alpha = Math.max(0, t.life / t.maxLife);
    if (!isWorldPointVisibleFromCamera(t.toX, t.toY, t.toZ, 0.999)) continue;
    ctx.strokeStyle = `rgba(255,244,200,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles() {
  for (const p of particles) {
    const proj = project(p.wx, p.wy, p.wz);
    if (!proj || proj.depth <= NEAR) continue;
    if (!isWorldPointVisibleFromCamera(p.wx, p.wy, p.wz, 0.998)) continue;
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
        : z.sprite === assets.zombieGasMask ? assets.zombieGasMaskHeadshotData
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
  if (!info) return null;
  const spriteW = info.spriteW ?? ZOMBIE_SPRITE_W;
  const spriteH = info.spriteH ?? ZOMBIE_SPRITE_H;
  const hitTx = info.flip
    ? (info.sx + info.sw - hitPx) / info.sw * spriteW
    : (hitPx - info.sx) / info.sw * spriteW;
  const hitTy = ((hitPy - info.sy) / info.sh) * spriteH;
  const headShot = isHeadShotFromMask(z, info, hitTx, hitTy);
  const damage = headShot ? ZOMBIE_DAMAGE_HEAD : ZOMBIE_DAMAGE_BODY;
  const zombieId = z.spawnIndex;
  z.hp -= damage;
  hitFeedbackTime = HIT_FEEDBACK_DURATION;  // white reticule only when we actually damage an enemy
  const baseRadii = makeJaggedRadii();
  const jaggedRadii = baseRadii.map((r) => r * (spriteW / ZOMBIE_SPRITE_W));
  if (z.hp <= 0) {
    spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii);
    spawnDeathParticles(z, info);
    zombies.splice(idx, 1);
    score += 1;
    updateTallyWallTextures();
    if (score === UPGRADE_SPITZER_AT && !upgradeSpitzerShown) {
      upgradeSpitzerShown = true;
      upgradeMessageTime = UPGRADE_MESSAGE_DURATION;
      upgradeMessageLines = ['100 zombies destroyed', 'Upgrade unlocked: .303 Mk VII Spitzer Bullet', 'Bullets pass through enemies on kill'];
    }
    if (score === UPGRADE_MAD_MINUTE_AT && !upgradeMadMinuteShown) {
      upgradeMadMinuteShown = true;
      upgradeMessageTime = UPGRADE_MESSAGE_DURATION;
      upgradeMessageLines = ['200 zombies destroyed', 'Upgrade unlocked: Mad Minute', 'Shooting and reloading speed doubled'];
    }
    return { type: 'zombie', zombieId, headshot: headShot, killed: true };
  } else {
    if (!z.holes) z.holes = [];
    z.holes.push({ tx: hitTx, ty: hitTy, jaggedRadii });
    z.holeVersion = (z.holeVersion || 0) + 1;
    spawnHoleParticles(z, info, hitPx, hitPy, jaggedRadii);
    return { type: 'zombie', zombieId, headshot: headShot, killed: false };
  }
}

function applyOneRemoteZombieHit(payload, remotePlayer, hit) {
  if (!hit || hit.type !== 'zombie' || zombies.length === 0) return;
  let zombieIdx = zombies.findIndex((z) => z.spawnIndex === Number(hit.zombieId));
  if (zombieIdx < 0) zombieIdx = zombies.findIndex((z) => z.spawnIndex === (Number(hit.zombieId) - 1));
  if (zombieIdx < 0 && Number.isFinite(payload?.targetSlotIndex)) {
    const targetIdx = Number(payload.targetSlotIndex);
    zombieIdx = zombies.findIndex((z) => z.targetSlot && bunkerSlots.indexOf(z.targetSlot) === targetIdx);
  }
  if (zombieIdx < 0) {
    const shooterPos = getMpPlayerWorldPos(remotePlayer, Date.now());
    let bestDist2 = Infinity;
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      const dx = z.x - shooterPos.x;
      const dz = z.z - shooterPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        zombieIdx = i;
      }
    }
  }
  if (zombieIdx < 0) return;
  const z = zombies[zombieIdx];
  const damage = hit.killed ? Math.max(1, z.hp) : (hit.headshot ? ZOMBIE_DAMAGE_HEAD : ZOMBIE_DAMAGE_BODY);
  z.hp -= damage;
  if (z.hp > 0) return;
  const info = getZombieDrawInfo(z);
  if (info) spawnDeathParticles(z, info);
  zombies.splice(zombieIdx, 1);
  score += 1;
  updateTallyWallTextures();
  if (score === UPGRADE_SPITZER_AT && !upgradeSpitzerShown) {
    upgradeSpitzerShown = true;
    upgradeMessageTime = UPGRADE_MESSAGE_DURATION;
    upgradeMessageLines = ['100 zombies destroyed', 'Upgrade unlocked: .303 Mk VII Spitzer Bullet', 'Bullets pass through enemies on kill'];
  }
  if (score === UPGRADE_MAD_MINUTE_AT && !upgradeMadMinuteShown) {
    upgradeMadMinuteShown = true;
    upgradeMessageTime = UPGRADE_MESSAGE_DURATION;
    upgradeMessageLines = ['200 zombies destroyed', 'Upgrade unlocked: Mad Minute', 'Shooting and reloading speed doubled'];
  }
}

function applyRemoteZombieHit(payload, remotePlayer) {
  const hits = payload?.hits;
  if (Array.isArray(hits) && hits.length > 0) {
    for (const hit of hits) {
      applyOneRemoteZombieHit(payload, remotePlayer, hit);
    }
    return;
  }
  const hit = payload?.hit;
  if (!hit || hit.type !== 'zombie' || zombies.length === 0) return;
  applyOneRemoteZombieHit(payload, remotePlayer, hit);
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
const TREE_PIXEL_HIT_ALPHA_THRESHOLD = 128; // only block on clearly opaque pixels; let shot through transparent/anti-aliased edges

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
      zombieSampleCtx.clearRect(0, 0, zombieSampleCanvas.width, zombieSampleCanvas.height);
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
  treeHoleCtx.clearRect(0, 0, TREE_SPRITE_SIZE, TREE_SPRITE_SIZE);
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
  return alpha >= TREE_PIXEL_HIT_ALPHA_THRESHOLD;
}

/** Returns all zombies the ray passes through, front to back, for Spitzer pass-through. Each entry has { index, spawnIndex, t, hitPx, hitPy }. */
function getZombieHitsAlongRay(shotDir) {
  const ox = cameraX;
  const oy = CAMERA_Y;
  const oz = cameraZ;
  const hits = [];
  const halfH = ZOMBIE_REF_HEIGHT * 0.5;
  for (let i = 0; i < zombies.length; i++) {
    const z = zombies[i];
    const cx = z.x;
    const cy = (z.y ?? 0) + halfH;
    const cz = z.z;
    const dx = cx - ox;
    const dy = cy - oy;
    const dz = cz - oz;
    const t = dx * shotDir.x + dy * shotDir.y + dz * shotDir.z;
    if (t <= 0) continue;
    const px = ox + t * shotDir.x;
    const py = oy + t * shotDir.y;
    const pz = oz + t * shotDir.z;
    const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2 + (pz - cz) ** 2);
    if (dist > ZOMBIE_RAY_RADIUS) continue;
    const info = getZombieDrawInfo(z);
    const hitPx = info ? info.sx + info.sw / 2 : W / 2;
    const hitPy = info ? info.sy + info.sh / 2 : H / 2;
    hits.push({ index: i, spawnIndex: z.spawnIndex, t, hitPx, hitPy });
  }
  hits.sort((a, b) => a.t - b.t);
  return hits;
}

/** Returns { type: 'zombie'|'tree', index } for the closest hit, or null. Always uses 2D screen-space hit test so hits match what the player sees (sprites on screen). */
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
      const speed = (2.5 + Math.random() * 2.5) * PARTICLE_BLAST_SPEED_MULT;
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        wx: t.x + (Math.random() - 0.5) * 0.1,
        wy: worldY + (Math.random() - 0.5) * 0.05,
        wz: t.z + (Math.random() - 0.5) * 0.1,
        vwx: Math.cos(angle) * speed,
        vwy: Math.abs(Math.sin(angle) * speed * 0.55) + PARTICLE_BLAST_UPWARD_BONUS,
        vwz: Math.sin(angle) * speed,
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
  const jaggedRadii = baseRadii.map((r) => r * (TREE_SPRITE_SIZE / ZOMBIE_SPRITE_W) * TREE_HOLE_RADIUS_SCALE);
  if (t.hp <= 0) {
    spawnTreeHoleParticles(t, info, hitPx, hitPy, jaggedRadii);
    trees.splice(idx, 1);
  } else {
    if (!t.holes) t.holes = [];
    t.holes.push({ tx: hitTx, ty: hitTy, jaggedRadii });
    t.holeVersion = (t.holeVersion || 0) + 1;
    spawnTreeHoleParticles(t, info, hitPx, hitPy, jaggedRadii);
  }
}

// ---- Drawing ----

function getFogFactor(depth) {
  const d = Math.max(0, depth - FOG_START);
  return 1 - Math.exp(-d * FOG_DENSITY);
}

// Horizon forest: preprocessed texture = forest + top row extended up with increasing gaussian blur into sky
let horizonForestTexture = null;
const HORIZON_FOREST_BLUR_ROWS = 80;
const HORIZON_FOREST_BLUR_SIGMA_MIN = 1;
const HORIZON_FOREST_BLUR_SIGMA_MAX = 40;

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/** Return the modal (most common) color in a row of pixel data as hex. Quantizes to 32 levels per channel for stability. */
function modalColorFromRow(imageData) {
  const data = imageData.data;
  const count = new Map();
  const shift = 3;
  const mask = 31;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] >> shift) << (2 * (8 - shift)) | (data[i + 1] >> shift) << (8 - shift) | (data[i + 2] >> shift);
    count.set(key, (count.get(key) || 0) + 1);
  }
  let bestKey = 0;
  let bestCount = 0;
  for (const [key, n] of count) {
    if (n > bestCount) {
      bestCount = n;
      bestKey = key;
    }
  }
  const r = ((bestKey >> (2 * (8 - shift))) & mask) << shift;
  const g = ((bestKey >> (8 - shift)) & mask) << shift;
  const b = (bestKey & mask) << shift;
  return rgbToHex(r, g, b);
}

/** Set SKY_COLOR from modal of top row and GROUND_COLOR from modal of bottom row of the horizon background image. */
function applyHorizonBackgroundColors(img) {
  if (!img?.naturalWidth) return;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const topRow = cx.getImageData(0, 0, c.width, 1);
  const bottomRow = cx.getImageData(0, c.height - 1, c.width, 1);
  SKY_COLOR = modalColorFromRow(topRow);
  GROUND_COLOR = modalColorFromRow(bottomRow);
}

function buildHorizonForestTexture() {
  const img = assets.horizonBackground;
  if (!img?.naturalWidth) return;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const totalH = ih + HORIZON_FOREST_BLUR_ROWS;
  const c = document.createElement('canvas');
  c.width = iw;
  c.height = totalH;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0, iw, ih, 0, HORIZON_FOREST_BLUR_ROWS, iw, ih);
  const topRow = cx.getImageData(0, HORIZON_FOREST_BLUR_ROWS, iw, 1);
  const sky = hexToRgb(SKY_COLOR);
  const kernelRadius = (sigma) => Math.min(iw, Math.ceil(sigma * 3));
  const gauss = (x, sigma) => Math.exp(-(x * x) / (2 * sigma * sigma));
  for (let r = 0; r < HORIZON_FOREST_BLUR_ROWS; r++) {
    const t = r / HORIZON_FOREST_BLUR_ROWS;
    const sigma = HORIZON_FOREST_BLUR_SIGMA_MIN + t * (HORIZON_FOREST_BLUR_SIGMA_MAX - HORIZON_FOREST_BLUR_SIGMA_MIN);
    const rad = kernelRadius(sigma);
    const rowData = cx.createImageData(iw, 1);
    for (let x = 0; x < iw; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0, wsum = 0;
      for (let dx = -rad; dx <= rad; dx++) {
        const sx = (x + dx + iw) % iw;
        const w = gauss(dx / sigma, 1);
        const i = sx * 4;
        ar += topRow.data[i] * w;
        ag += topRow.data[i + 1] * w;
        ab += topRow.data[i + 2] * w;
        aa += topRow.data[i + 3] * w;
        wsum += w;
      }
      if (wsum > 0) {
        ar /= wsum;
        ag /= wsum;
        ab /= wsum;
        aa /= wsum;
      }
      const blend = t;
      rowData.data[x * 4] = ar * (1 - blend) + sky.r * blend;
      rowData.data[x * 4 + 1] = ag * (1 - blend) + sky.g * blend;
      rowData.data[x * 4 + 2] = ab * (1 - blend) + sky.b * blend;
      rowData.data[x * 4 + 3] = 255;
    }
    cx.putImageData(rowData, 0, HORIZON_FOREST_BLUR_ROWS - 1 - r);
  }
  horizonForestTexture = c;
}

function screenXToHorizonAngle(screenX, horizonY) {
  const dir = getShotDirection(screenX, horizonY);
  if (Math.abs(dir.y) < 1e-6) return 0;
  const t = -CAMERA_Y / dir.y;
  const wx = cameraX + t * dir.x;
  const wz = cameraZ + t * dir.z;
  return Math.atan2(wz - cameraZ, wx - cameraX);
}

const HORIZON_FOREST_STRIP_RATIO = 0.5;
const HORIZON_FOREST_REPEAT_COUNT = 26;
const HORIZON_FOREST_HORIZON_ROW = 275;
const HORIZON_FOREST_GROUND_FADE_RATIO = 0.4;
const HORIZON_FOREST_GROUND_ALPHA = 0.65;

function getHorizonForestDrawState() {
  if (!horizonForestTexture) return null;
  const { forward } = getViewVectors();
  const lenXZ = Math.sqrt(forward.x * forward.x + forward.z * forward.z);
  if (lenXZ < 1e-6) return null;
  const far = 10000;
  const hx = cameraX + (forward.x / lenXZ) * far;
  const hz = cameraZ + (forward.z / lenXZ) * far;
  const horizonProj = project(hx, 0, hz);
  const horizonY = horizonProj ? horizonProj.sy : H / 2;
  const fovZoom = FOV / getFOV();
  const stripHeight = H * HORIZON_FOREST_STRIP_RATIO * fovZoom;
  const centerAngle = Math.atan2(forward.z, forward.x);
  const angle0Ray = screenXToHorizonAngle(0, horizonY);
  const angle1Ray = screenXToHorizonAngle(W, horizonY);
  let angleSpan = angle1Ray - angle0Ray;
  while (angleSpan <= 0) angleSpan += Math.PI * 2;
  while (angleSpan > Math.PI * 2) angleSpan -= Math.PI * 2;
  if (angleSpan < 0.01) angleSpan = Math.PI * 2;
  const angle0 = ((centerAngle - angleSpan / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const tw = horizonForestTexture.width;
  const th = horizonForestTexture.height;
  const patternWidth = tw * HORIZON_FOREST_REPEAT_COUNT;
  const visibleTextureWidth = (angleSpan / (2 * Math.PI)) * patternWidth;
  if (visibleTextureWidth < 1e-6) return null;
  const scaleX = W / visibleTextureWidth;
  const scaleY = stripHeight / th;
  const offsetX = -scaleX * (angle0 / (2 * Math.PI)) * patternWidth;
  const textureHorizonRow = HORIZON_FOREST_BLUR_ROWS + HORIZON_FOREST_HORIZON_ROW;
  const stripTop = horizonY - textureHorizonRow * scaleY;
  return {
    horizonY,
    stripHeight,
    stripTop,
    scaleX,
    scaleY,
    offsetX,
  };
}

function drawHorizonForest() {
  const state = getHorizonForestDrawState();
  if (!state) return;
  const pattern = ctx.createPattern(horizonForestTexture, 'repeat-x');
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix([state.scaleX, 0, 0, state.scaleY, state.offsetX, 0]));
  ctx.save();
  ctx.translate(0, state.stripTop);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, state.stripHeight);
  ctx.restore();
}

function drawSky() {
  ctx.fillStyle = SKY_COLOR;
  ctx.fillRect(0, 0, W, H);
}

function drawGround() {
  const state = getHorizonForestDrawState();
  const floorHorizon = Math.floor(state ? state.horizonY : H / 2);
  const groundH = Math.max(0, H - floorHorizon);
    ctx.fillStyle = GROUND_COLOR;
  ctx.fillRect(0, floorHorizon, W, groundH);
  if (!state || groundH <= 0) return;
  const pattern = ctx.createPattern(horizonForestTexture, 'repeat-x');
  if (!pattern) return;
  pattern.setTransform(new DOMMatrix([state.scaleX, 0, 0, state.scaleY, state.offsetX, 0]));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, floorHorizon, W, groundH);
  ctx.clip();
  ctx.globalAlpha = HORIZON_FOREST_GROUND_ALPHA;
  ctx.translate(0, state.stripTop);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H - state.stripTop);
  ctx.restore();
  const fadeEnd = Math.min(H, floorHorizon + groundH * HORIZON_FOREST_GROUND_FADE_RATIO);
  if (fadeEnd > floorHorizon) {
    const fade = ctx.createLinearGradient(0, floorHorizon, 0, fadeEnd);
    fade.addColorStop(0, GROUND_COLOR + '00');
    fade.addColorStop(1, GROUND_COLOR);
    ctx.fillStyle = fade;
    ctx.fillRect(0, floorHorizon, W, fadeEnd - floorHorizon);
  }
  if (fadeEnd < H) {
  ctx.fillStyle = GROUND_COLOR;
    ctx.fillRect(0, fadeEnd, W, H - fadeEnd);
  }
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

function getVisibleTrees() {
  if (!assets.retrotree) return [];
  return trees
    .map((t) => {
      const base = project(t.x, 0, t.z);
      const center = project(t.x, TREE_HEIGHT * 0.5, t.z);
      if (!base || !center || center.depth <= NEAR) return null;
      const pixelsPerUnit = (H / 2) / (Math.tan(getFOV() / 2) * center.depth);
      const screenH = TREE_HEIGHT * pixelsPerUnit;
      if (screenH <= 0) return null;
      const screenW = screenH;
      const baseScreenY = base.sy + screenH * TREE_BASE_SINK_RATIO;
      return {
        ...t,
        sx: center.sx - screenW / 2,
        sy: baseScreenY - screenH,
        sw: screenW,
        sh: screenH,
        depth: center.depth,
      };
    })
    .filter(Boolean);
}

function drawTreeInfo(t) {
  const HOLE_EDGE_ALPHA_THRESHOLD_TREE = 10;
  const { col, row } = getTreeGridCell(t.spriteIndex);
  ctx.save();
  ctx.globalAlpha = 1;
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

function drawTrees() {
  const visible = getVisibleTrees();
  visible.sort((a, b) => b.depth - a.depth);
  for (const t of visible) drawTreeInfo(t);
}

function drawZombieInfo(z, info) {
  ctx.save();
  ctx.globalAlpha = 1;
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

function drawZombies() {
  if (!assets.zombieSprites?.length) return;
  const withInfo = zombies.map((z) => ({ z, info: getZombieDrawInfo(z) })).filter((o) => o.info);
  withInfo.sort((a, b) => b.info.depth - a.info.depth);
  for (const { z, info } of withInfo) drawZombieInfo(z, info);
}

function getMultiplayerDrawInfo(p, queueIndex, nowMs = Date.now()) {
  const toSlot = getSlotByIndex(p.moveToIndex ?? p.slotIndex);
  const fromSlot = getSlotByIndex(p.moveFromIndex ?? p.slotIndex) || toSlot;
  if (!toSlot || !fromSlot) return null;
  let t = 1;
  if (p.moving) {
    t = Math.max(0, Math.min(1, (nowMs - p.moveStartAt) / (MP_MOVE_DURATION * 1000)));
    if (t >= 1) p.moving = false;
  }
  const s = t * t * (3 - 2 * t);
  const toInwardRawX = (toSlot.x ?? 0) - (toSlot.wallX ?? toSlot.x ?? 0);
  const toInwardRawZ = (toSlot.z ?? 0) - (toSlot.wallZ ?? toSlot.z ?? 0);
  const toInwardMag = Math.hypot(toInwardRawX, toInwardRawZ) || 1;
  const toInward = { x: toInwardRawX / toInwardMag, z: toInwardRawZ / toInwardMag };
  const fromInwardRawX = (fromSlot.x ?? 0) - (fromSlot.wallX ?? fromSlot.x ?? 0);
  const fromInwardRawZ = (fromSlot.z ?? 0) - (fromSlot.wallZ ?? fromSlot.z ?? 0);
  const fromInwardMag = Math.hypot(fromInwardRawX, fromInwardRawZ) || 1;
  const fromInward = { x: fromInwardRawX / fromInwardMag, z: fromInwardRawZ / fromInwardMag };
  const normal = toSlot.normal || toInward || { x: 0, z: 1 };
  const tx = toSlot.tangent?.x ?? 1;
  const tz = toSlot.tangent?.z ?? 0;
  const q = Math.max(0, queueIndex);
  const queueBack = q * MP_QUEUE_SPACING;
  const queueInward = queueBack;
  const lane = Math.ceil(q / 2);
  const lateral = q === 0 ? 0 : (q % 2 === 1 ? -1 : 1) * lane * 0.08;
  const fromX = fromSlot.x + fromInward.x * queueInward;
  const fromZ = fromSlot.z + fromInward.z * queueInward;
  const toX = toSlot.x + toInward.x * queueInward;
  const toZ = toSlot.z + toInward.z * queueInward;
  let wx = fromX + (toX - fromX) * s + tx * lateral;
  let wz = fromZ + (toZ - fromZ) * s + tz * lateral;
  if (bunker?.corners?.length >= 3 && !isPointInsidePolygon(wx, wz, bunker.corners)) {
    const centerX = (bunker.minX + bunker.maxX) * 0.5;
    const centerZ = (bunker.minZ + bunker.maxZ) * 0.5;
    for (let i = 0; i < 6 && !isPointInsidePolygon(wx, wz, bunker.corners); i++) {
      wx += (centerX - wx) * 0.35;
      wz += (centerZ - wz) * 0.35;
    }
  }
  const bob = p.moving ? Math.sin((nowMs / 1000) * MP_BOB_SPEED + p.bobPhase) * 0.03 : 0;
  const feetY = BUNKER_FLOOR_Y + bob;
  const headY = feetY + MP_SPRITE_HEIGHT;
  if (!isWorldActorVisibleFromCamera(wx, feetY, MP_SPRITE_HEIGHT, wz)) return null;
  const headProj = project(wx, headY, wz);
  const feetProj = project(wx, feetY, wz);
  if (!headProj || !feetProj || headProj.depth <= NEAR) return null;
  const imgBack = assets.playerSpriteBack;
  const imgSide = assets.playerSpriteSide;
  const useBack = (() => {
    const forward = {
      x: Math.sin(toSlot.baseYaw),
      z: -Math.cos(toSlot.baseYaw),
    };
    const toCamX = cameraX - wx;
    const toCamZ = cameraZ - wz;
    const mag = Math.hypot(toCamX, toCamZ) || 1;
    const dot = (forward.x * (toCamX / mag) + forward.z * (toCamZ / mag));
    return dot < -0.45;
  })();
  const img = useBack ? imgBack : imgSide;
  if (!img) return null;
  const rawScreenH = feetProj.sy - headProj.sy;
  if (rawScreenH <= 2) return null;
  const screenH = Math.min(rawScreenH, H * 0.95);
  const spriteW = img.naturalWidth || img.width || 64;
  const spriteH = img.naturalHeight || img.height || 64;
  const screenW = Math.max(8, screenH * (spriteW / spriteH));
  return {
    p,
    depth: headProj.depth,
    img,
    sx: headProj.sx - screenW / 2,
    sy: headProj.sy,
    sw: screenW,
    sh: screenH,
    wx,
    wz,
  };
}

function drawMultiplayerPlayer(info) {
  if (!info?.img) return;
  const fogF = getFogFactor(info.depth);
  ctx.save();
  ctx.globalAlpha = Math.max(0.35, 1 - fogF * 0.55);
  ctx.drawImage(info.img, 0, 0, info.img.naturalWidth || info.img.width, info.img.naturalHeight || info.img.height, info.sx, info.sy, info.sw, info.sh);
  ctx.restore();
}

function drawCharactersDepthSorted(outItems = null) {
  const drawItems = [];
  for (const t of getVisibleTrees()) drawItems.push({ type: 'tree', depth: t.depth, t });
  for (const z of zombies) {
    const info = getZombieDrawInfo(z);
    if (!info) continue;
    drawItems.push({ type: 'zombie', depth: info.depth, z, info });
  }
  if (outItems) {
    for (const item of drawItems) outItems.push(item);
    return;
  }
  drawItems.sort((a, b) => b.depth - a.depth);
  for (const item of drawItems) {
    if (item.type === 'tree') drawTreeInfo(item.t);
    else drawZombieInfo(item.z, item.info);
  }
}

function drawMultiplayerPlayersDepthSorted(outItems = null) {
  if (!multiplayerPlayers.size) return;
  const drawItems = [];
  const queueMap = getSlotQueueMap();
  multiplayerPlayers.forEach((p) => {
    if (p.isLocal) return;
    const queue = queueMap.get(p.slotIndex) || [p];
    const queueIdx = Math.max(0, queue.findIndex((q) => q.playerId === p.playerId));
    const mp = getMultiplayerDrawInfo(p, queueIdx);
    if (mp) drawItems.push(mp);
  });
  if (outItems) {
    for (const mp of drawItems) outItems.push({ type: 'mp', depth: mp.depth, mp });
    return;
  }
  drawItems.sort((a, b) => b.depth - a.depth);
  for (const mp of drawItems) drawMultiplayerPlayer(mp);
}

const BOARD_SPRITE_WORLD_SIZE = 0.95;
const BOARD_WALL_INSET = 0.035; // slight inward offset so boarded windows sit in front of wall
const BOARD_STACK_OFFSET_RIGHT = 1.0; // world units; leaned stack is well to the right of the window so hammer doesn't trigger when aiming out
const BOARD_STACK_ROLL = -Math.PI / 2; // fixed in-plane roll so stacked boards are upright on every wall orientation
const BOARD_WINDOW_FRACTIONS = [0.2, 0.35, 0.58];  // from top: top board, middle above rifle, bottom inside window

function getWindowScreenBounds(slot) {
  if (!slot || slot.type !== 'window' || !bunker) return null;
  const wx = slot.wallX ?? slot.x;
  const wz = slot.wallZ ?? slot.z;
  const top = project(wx, BUNKER_WALL_HEIGHT, wz);
  const bottom = project(wx, 0, wz);
  const mid = project(wx, BOARD_WINDOW_Y_MID, wz);
  if (!top || !bottom || !mid || mid.depth <= NEAR) return null;
  return {
    sx: mid.sx,
    syTop: top.sy,
    syBottom: bottom.sy,
    depth: mid.depth,
  };
}

const RUN_TARGET_HITBOX_PADDING = 32;  // screen pixels to expand hitbox for easier targeting

/** Screen-space bounds for a slot (window or crate) for run-to-target hitbox. */
function getSlotScreenBounds(slot) {
  if (!slot || !bunker) return null;
  const half = (slot.tileWidth ?? BUNKER_WINDOW_WIDTH) / 2;
  const tx = slot.tangent?.x ?? 1;
  const tz = slot.tangent?.z ?? 0;
  const wx = slot.wallX ?? slot.x;
  const wz = slot.wallZ ?? slot.z;
  const leftX = wx - tx * half;
  const leftZ = wz - tz * half;
  const rightX = wx + tx * half;
  const rightZ = wz + tz * half;
  const corners = [
    project(leftX, BUNKER_WALL_HEIGHT, leftZ),
    project(leftX, 0, leftZ),
    project(rightX, BUNKER_WALL_HEIGHT, rightZ),
    project(rightX, 0, rightZ),
  ];
  if (corners.some((c) => !c || c.depth <= NEAR)) return null;
  const minSx = Math.min(...corners.map((c) => c.sx));
  const maxSx = Math.max(...corners.map((c) => c.sx));
  const syTop = Math.min(...corners.map((c) => c.sy));
  const syBottom = Math.max(...corners.map((c) => c.sy));
  const depth = corners.reduce((s, c) => s + c.depth, 0) / 4;
  return { minSx, maxSx, syTop, syBottom, depth, centerSx: (minSx + maxSx) / 2, centerSy: (syTop + syBottom) / 2 };
}

/** If the reticule is over a runnable slot and the line from player to it is inside the bunker, return that slot (closest by depth). */
function getRunTargetAt(px, py) {
  if (worldRenderer?.isReady()) {
    const hit = worldRenderer.pickFirst(px, py, ['window', 'crate']);
    const idx = Number(hit?.userData?.slotIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= bunkerSlots.length) return null;
    const slot = bunkerSlots[idx];
    const current = getCurrentBunkerSlot();
    if (!slot || slot === current) return null;
    if (isMovementPathBlocked(cameraX, cameraZ, slot.x, slot.z, CAMERA_Y)) return null;
    const bounds = getSlotScreenBounds(slot);
    return { slot, index: idx, depth: bounds?.depth ?? 0, bounds: bounds ?? { centerSx: W / 2, syTop: H / 2 } };
  }
  if (!bunkerSlots.length || movementStartTime != null) return null;
  const current = getCurrentBunkerSlot();
  const candidates = [];
  for (let i = 0; i < bunkerSlots.length; i++) {
    const slot = bunkerSlots[i];
    if (slot === current) continue;
    const bounds = getSlotScreenBounds(slot);
    if (!bounds) continue;
    const p = RUN_TARGET_HITBOX_PADDING;
    if (px < bounds.minSx - p || px > bounds.maxSx + p || py < bounds.syTop - p || py > bounds.syBottom + p) continue;
    if (isMovementPathBlocked(cameraX, cameraZ, slot.x, slot.z, CAMERA_Y)) continue;
    candidates.push({ slot, index: i, depth: bounds.depth, bounds });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.depth - b.depth);
  return candidates[0];
}

function drawBoardAt(img, iw, ih, worldX, worldY, worldZ, rot, flip) {
  const proj = project(worldX, worldY, worldZ);
  if (!proj || proj.depth <= NEAR) return null;
  const scale = (BOARD_SPRITE_WORLD_SIZE * H) / (Math.tan(getFOV() / 2) * proj.depth * 2);
  const w = scale * (iw / Math.max(ih, 1));
  const h = scale;
  return { depth: proj.depth, sx: proj.sx, sy: proj.sy, w, h, rot, flip };
}

function getWallRightUp(slot) {
  const right = { x: slot?.tangent?.x ?? 1, y: 0, z: slot?.tangent?.z ?? 0 };
  const up = { x: 0, y: 1, z: 0 };
  return { right, up };
}

function getBoardQuadOnWall(slot, boardIndex, windowPoses, iw, ih) {
  if (!slot || !bunker || boardIndex >= (windowPoses?.length ?? 0)) return null;
  const frac = BOARD_WINDOW_FRACTIONS[boardIndex];
  const boardY = BUNKER_WALL_HEIGHT * (1 - frac);
  const n = slot.normal ?? { x: 0, z: 1 };
  const cx = (slot.wallX ?? slot.x) + n.x * BOARD_WALL_INSET;
  const cz = (slot.wallZ ?? slot.z) + n.z * BOARD_WALL_INSET;
  const { right, up } = getWallRightUp(slot);
  const halfH = BOARD_SPRITE_WORLD_SIZE / 2;
  const halfW = (BOARD_SPRITE_WORLD_SIZE * (iw / Math.max(ih, 1))) / 2;
  const p = windowPoses[boardIndex];
  const rot = p.rot;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const uvs = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
  const corners = [];
  let depthSum = 0;
  for (const [u, v] of uvs) {
    const u2 = u * cr - v * sr;
    const v2 = u * sr + v * cr;
    const wx = cx + right.x * u2 + up.x * v2;
    const wy = boardY + right.y * u2 + up.y * v2;
    const wz = cz + right.z * u2 + up.z * v2;
    const proj = project(wx, wy, wz);
    if (!proj || proj.depth <= NEAR) return null;
    corners.push({ sx: proj.sx, sy: proj.sy, depth: proj.depth });
    depthSum += proj.depth;
  }
  return { corners, depth: depthSum / 4, flip: p.flip };
}

function drawBoardAtScreen(img, iw, ih, sx, sy, depth, rot, flip) {
  if (depth <= NEAR) return null;
  const scale = (BOARD_SPRITE_WORLD_SIZE * H) / (Math.tan(getFOV() / 2) * depth * 2);
  const w = scale * (iw / Math.max(ih, 1));
  const h = scale;
  return { depth, sx, sy, w, h, rot, flip };
}

function setUvTriangleTransform(uv0, uv1, uv2, p0, p1, p2) {
  const du1 = uv1.u - uv0.u;
  const dv1 = uv1.v - uv0.v;
  const du2 = uv2.u - uv0.u;
  const dv2 = uv2.v - uv0.v;
  const det = du1 * dv2 - dv1 * du2;
  if (Math.abs(det) < 1e-8) return false;
  const inv = 1 / det;
  const m00 = dv2 * inv;
  const m01 = -du2 * inv;
  const m10 = -dv1 * inv;
  const m11 = du1 * inv;
  const dx1 = p1.sx - p0.sx;
  const dy1 = p1.sy - p0.sy;
  const dx2 = p2.sx - p0.sx;
  const dy2 = p2.sy - p0.sy;
  const a = dx1 * m00 + dx2 * m10;
  const c = dx1 * m01 + dx2 * m11;
  const b = dy1 * m00 + dy2 * m10;
  const d = dy1 * m01 + dy2 * m11;
  const e = p0.sx - a * uv0.u - c * uv0.v;
  const f = p0.sy - b * uv0.u - d * uv0.v;
  ctx.setTransform(a, b, c, d, e, f);
  return true;
}

function drawBoardQuadPerspective(img, iw, ih, corners, flip) {
  // corners: [bottom-left, bottom-right, top-right, top-left]
  const bl = corners[0], br = corners[1], tr = corners[2], tl = corners[3];
  const u0 = flip ? iw : 0;
  const u1 = flip ? 0 : iw;

  // Triangle 1: BL-BR-TR
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bl.sx, bl.sy);
  ctx.lineTo(br.sx, br.sy);
  ctx.lineTo(tr.sx, tr.sy);
  ctx.closePath();
  ctx.clip();
  if (setUvTriangleTransform(
    { u: u0, v: ih }, { u: u1, v: ih }, { u: u1, v: 0 },
    bl, br, tr,
  )) {
    ctx.drawImage(img, 0, 0, iw, ih, 0, 0, iw, ih);
  }
  ctx.restore();

  // Triangle 2: BL-TR-TL
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bl.sx, bl.sy);
  ctx.lineTo(tr.sx, tr.sy);
  ctx.lineTo(tl.sx, tl.sy);
  ctx.closePath();
  ctx.clip();
  if (setUvTriangleTransform(
    { u: u0, v: ih }, { u: u1, v: 0 }, { u: u0, v: 0 },
    bl, tr, tl,
  )) {
    ctx.drawImage(img, 0, 0, iw, ih, 0, 0, iw, ih);
  }
  ctx.restore();
}

function drawBoards(outItems = null) {
  if (!bunker || !assets.board?.naturalWidth) return;
  const img = assets.board;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const items = [];
  const placingKey = boardPlaceState?.slotKey ?? null;

  for (const slot of bunkerSlots) {
    if (slot.type !== 'window') continue;
    const key = getSlotKey(slot);
    const onWindow = windowBoards[key] ?? 0;
    const onFloor = BOARDS_PER_WINDOW - onWindow;
    const floorPoses = getBoardFloorPositions(slot);
    const windowPoses = getBoardWindowPositions(slot);
    const isPlacingHere = placingKey === key;

    let floorCount = onFloor;
    if (isPlacingHere) floorCount = Math.max(0, onFloor - 1);
    for (let i = 0; i < floorCount && i < floorPoses.length; i++) {
      const p = floorPoses[i];
      if (!isWorldPointVisibleFromCamera(p.x, p.y + 0.04, p.z)) continue;
      const it = drawBoardAt(img, iw, ih, p.x, p.y + 0.04, p.z, p.rot, p.flip);
      if (it) items.push(it);
    }

    const bounds = getWindowScreenBounds(slot);

    if (isPlacingHere && boardPlaceState && onFloor > 0 && onWindow < windowPoses.length && bounds) {
      const startTime = boardPlaceState.startTime;
      const endTime = boardPlaceState.endTime;
      const t = Math.min(1, Math.max(0, (gameTime - startTime) / (endTime - startTime)));
      const from = floorPoses[onFloor - 1];
      const fromProj = project(from.x, from.y + 0.04, from.z);
      const frac = BOARD_WINDOW_FRACTIONS[onWindow];
      const toSy = bounds.syTop + (bounds.syBottom - bounds.syTop) * frac;
      const toSx = bounds.sx;
      const toDepth = bounds.depth;
      const sx = fromProj ? fromProj.sx + (toSx - fromProj.sx) * t : toSx;
      const sy = fromProj ? fromProj.sy + (toSy - fromProj.sy) * t : toSy;
      const depth = fromProj ? fromProj.depth + (toDepth - fromProj.depth) * t : toDepth;
      const rot = from.rot + (windowPoses[onWindow].rot - from.rot) * t;
      const it = drawBoardAtScreen(img, iw, ih, sx, sy, depth, rot, windowPoses[onWindow].flip);
      if (it) items.push(it);
    }

    if (bounds) {
      for (let i = 0; i < onWindow && i < windowPoses.length; i++) {
        const quad = getBoardQuadOnWall(slot, i, windowPoses, iw, ih);
        if (quad) {
          items.push({ type: 'quad', depth: quad.depth, corners: quad.corners, flip: quad.flip });
        } else {
          const frac = BOARD_WINDOW_FRACTIONS[i];
          const sy = bounds.syTop + (bounds.syBottom - bounds.syTop) * frac;
          const p = windowPoses[i];
          const it = drawBoardAtScreen(img, iw, ih, bounds.sx, sy, bounds.depth, p.rot, p.flip);
          if (it) items.push(it);
        }
      }
    } else {
      for (let i = 0; i < onWindow && i < windowPoses.length; i++) {
        const p = windowPoses[i];
        if (!isWorldPointVisibleFromCamera(p.x, p.y, p.z)) continue;
        const it = drawBoardAt(img, iw, ih, p.x, p.y, p.z, p.rot, p.flip);
        if (it) items.push(it);
      }
    }
  }

  for (const fb of fallingBoards) {
    const t = Math.min(1, Math.max(0, (gameTime - fb.startTime) / (fb.endTime - fb.startTime)));
    const toProj = project(fb.toPos.x, fb.toPos.y + 0.04, fb.toPos.z);
    const rot = fb.fromPos.rot + (fb.toPos.rot - fb.fromPos.rot) * t;
    let it;
    if (fb.fromSx != null && fb.fromSy != null && fb.fromDepth != null && toProj) {
      const sx = fb.fromSx + (toProj.sx - fb.fromSx) * t;
      const sy = fb.fromSy + (toProj.sy - fb.fromSy) * t;
      const depth = fb.fromDepth + (toProj.depth - fb.fromDepth) * t;
      it = drawBoardAtScreen(img, iw, ih, sx, sy, depth, rot, fb.flip);
    } else if (toProj) {
      const x = fb.fromPos.x + (fb.toPos.x - fb.fromPos.x) * t;
      const y = fb.fromPos.y + (fb.toPos.y - fb.fromPos.y) * t;
      const z = fb.fromPos.z + (fb.toPos.z - fb.fromPos.z) * t;
      if (!isWorldPointVisibleFromCamera(x, y + 0.04, z)) continue;
      it = drawBoardAt(img, iw, ih, x, y, z, rot, fb.flip);
    }
    if (it) items.push(it);
  }

  if (outItems) {
    for (const it of items) outItems.push({ type: 'board', depth: it.depth, board: it, img, iw, ih });
    return;
  }
  items.sort((a, b) => b.depth - a.depth);
  for (const it of items) {
    if (it.type === 'quad') {
      drawBoardQuadPerspective(img, iw, ih, it.corners, it.flip);
    } else {
      ctx.save();
      ctx.translate(it.sx, it.sy);
      ctx.rotate(it.rot);
      if (it.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0, iw, ih, -it.w / 2, -it.h / 2, it.w, it.h);
      ctx.restore();
    }
  }
}

function drawBunkerInterior(outItems = null) {
  if (!bunker) return;
  updateTallyWallTextures();

  const polys = [];
  const backgroundPolys = [];
  const wallColor = '#1e1712';
  const trimColor = '#564536';
  const floorColor = '#1a1511';
  const ceilingColor = '#100c09';
  const crateFront = '#765235';
  const crateSide = '#5b3f29';
  const crateTop = '#8e6944';

  // Draw floor/ceiling from actual bunker polygon (not AABB), so concave layouts keep open courtyards.
  const floorPoly = (bunker.corners ?? []).map((p) => ({ x: p.x, y: BUNKER_FLOOR_Y, z: p.z }));
  const ceilingPoly = (bunker.corners ?? []).slice().reverse().map((p) => ({ x: p.x, y: BUNKER_WALL_HEIGHT, z: p.z }));
  if (floorPoly.length >= 3) pushPolygon(backgroundPolys, floorPoly, floorColor);
  if (ceilingPoly.length >= 3) pushPolygon(backgroundPolys, ceilingPoly, ceilingColor);

  function pushWallTile(segment, tile) {
    const { img } = getBunkerWallImageAndData(tile.spriteKey);
    const fill = wallColor;
    const stroke = img ? null : trimColor;
    const slices = img ? BUNKER_WALL_TEXTURE_SLICES : 1;
    const iw = img?.naturalWidth || img?.width || 1;
    const ih = img?.naturalHeight || img?.height || 1;
    const sx = segment.b.x - segment.a.x;
    const sz = segment.b.z - segment.a.z;
    for (let i = 0; i < slices; i++) {
      const u0 = i / slices;
      const u1 = (i + 1) / slices;
      const ta = tile.minT + (tile.maxT - tile.minT) * u0;
      const tb = tile.minT + (tile.maxT - tile.minT) * u1;
      const a = { x: segment.a.x + sx * ta, z: segment.a.z + sz * ta };
      const b = { x: segment.a.x + sx * tb, z: segment.a.z + sz * tb };
      const tex = img ? { img, sx: u0 * iw, sy: 0, sw: (u1 - u0) * iw, sh: ih } : null;
      pushPolygon(polys, [
        { x: a.x, y: 0, z: a.z },
        { x: b.x, y: 0, z: b.z },
        { x: b.x, y: BUNKER_WALL_HEIGHT, z: b.z },
        { x: a.x, y: BUNKER_WALL_HEIGHT, z: a.z },
      ], fill, stroke, tex);
    }
  }

  function addWallSegments() {
    for (const segment of bunkerWallSegments) {
      for (const tile of segment.tiles) {
        let spriteKey = tile.spriteKey;
        if (tile.spriteKey === 'ammo' || tile.spriteKey === 'wall_tally') {
          // Pick AMMO orientation from interior-facing "right" direction vs segment tangent.
          const interiorRight = { x: segment.inward.z, z: -segment.inward.x };
          const mirrored = (segment.tangent.x * interiorRight.x + segment.tangent.z * interiorRight.z) < 0;
          if (tile.spriteKey === 'ammo') spriteKey = mirrored ? 'wall_ammo_mirrored' : 'wall_ammo';
          else spriteKey = mirrored ? 'wall_tally_mirrored' : 'wall_tally';
        }
        pushWallTile(segment, { ...tile, spriteKey });
      }
    }
  }
  addWallSegments();

  const crateSlot = bunkerSlots.find((slot) => slot.type === 'crate');
  if (crateSlot) {
    const crateBox = getCrateAABB();
    if (!crateBox) return;
    const crateMinX = crateBox.minX;
    const crateMaxX = crateBox.maxX;
    const crateMinZ = crateBox.minZ;
    const crateMaxZ = crateBox.maxZ;
    const crateY0 = BUNKER_FLOOR_Y;
    const crateY1 = BUNKER_FLOOR_Y + BUNKER_CRATE_HEIGHT;
    const crateSheet = assets.crateSpriteSheet;
    // Crate sprite sheet: 4 columns x 5 rows. Row 0=front, 1=left, 2=right, 3=back, 4=top.
    let crateTexFront, crateTexLeft, crateTexRight, crateTexBack, crateTexTop;
    if (crateSheet) {
      const w = crateSheet.naturalWidth || crateSheet.width;
      const h = crateSheet.naturalHeight || crateSheet.height;
      const fw = Math.floor(w / 4);
      const fh = Math.floor(h / 5);
      const tex = (col, row) => ({ img: crateSheet, sx: col * fw, sy: row * fh, sw: fw, sh: fh });
      crateTexFront = tex(0, 0);
      crateTexLeft = tex(0, 1);
      crateTexRight = tex(0, 2);
      crateTexBack = tex(0, 3);
      crateTexTop = tex(0, 4);
    }
    const crateCenterX = (crateMinX + crateMaxX) * 0.5;
    const crateCenterZ = (crateMinZ + crateMaxZ) * 0.5;
    const cameraOnEast = cameraX >= crateCenterX;
    const cameraOnSouth = cameraZ >= crateCenterZ;
    // For this axis-aligned box, draw only camera-facing vertical faces (+ top) to prevent far-face popping.
    const visibleFaces = [];
    visibleFaces.push(cameraOnSouth
      ? {
          points: [
            { x: crateMinX, y: crateY0, z: crateMaxZ },
            { x: crateMaxX, y: crateY0, z: crateMaxZ },
            { x: crateMaxX, y: crateY1, z: crateMaxZ },
            { x: crateMinX, y: crateY1, z: crateMaxZ },
          ],
          tex: crateTexFront,
          fill: crateFront,
        }
      : {
          points: [
            { x: crateMinX, y: crateY0, z: crateMinZ },
            { x: crateMaxX, y: crateY0, z: crateMinZ },
            { x: crateMaxX, y: crateY1, z: crateMinZ },
            { x: crateMinX, y: crateY1, z: crateMinZ },
          ],
          tex: crateTexBack,
          fill: crateSide,
        });
    visibleFaces.push(cameraOnEast
      ? {
          points: [
            { x: crateMaxX, y: crateY0, z: crateMinZ },
            { x: crateMaxX, y: crateY0, z: crateMaxZ },
            { x: crateMaxX, y: crateY1, z: crateMaxZ },
            { x: crateMaxX, y: crateY1, z: crateMinZ },
          ],
          tex: crateTexRight,
          fill: crateSide,
        }
      : {
          points: [
            { x: crateMinX, y: crateY0, z: crateMaxZ },
            { x: crateMinX, y: crateY0, z: crateMinZ },
            { x: crateMinX, y: crateY1, z: crateMinZ },
            { x: crateMinX, y: crateY1, z: crateMaxZ },
          ],
          tex: crateTexLeft,
          fill: crateSide,
        });
    // Draw top after the farthest visible vertical face, before nearest one.
    const crateTopPoly = {
      points: [
        { x: crateMinX, y: crateY1, z: crateMinZ },
        { x: crateMaxX, y: crateY1, z: crateMinZ },
        { x: crateMaxX, y: crateY1, z: crateMaxZ },
        { x: crateMinX, y: crateY1, z: crateMaxZ },
      ],
      tex: crateTexTop,
      fill: crateTop,
    };
    const crateFacePolys = [];
    pushPolygon(crateFacePolys, visibleFaces[0].points, visibleFaces[0].fill, '#3f2b1b', visibleFaces[0].tex);
    pushPolygon(crateFacePolys, visibleFaces[1].points, visibleFaces[1].fill, '#3f2b1b', visibleFaces[1].tex);
    crateFacePolys.sort((a, b) => b.avgDepth - a.avgDepth);
    if (crateFacePolys[0]) polys.push(crateFacePolys[0]);
    pushPolygon(polys, crateTopPoly.points, crateTopPoly.fill, '#3f2b1b', crateTopPoly.tex);
    if (crateFacePolys[1]) polys.push(crateFacePolys[1]);
  }

  if (outItems) {
    for (const poly of backgroundPolys) outItems.push({ type: 'poly', depth: poly.avgDepth, poly });
    for (const poly of polys) outItems.push({ type: 'poly', depth: poly.avgDepth, poly });
    return;
  }
  backgroundPolys.sort((a, b) => b.avgDepth - a.avgDepth);
  for (const poly of backgroundPolys) drawProjectedPolygon(poly);
  polys.sort((a, b) => b.avgDepth - a.avgDepth);
  for (const poly of polys) drawProjectedPolygon(poly);
}

function drawInterleavedWorld() {
  const drawItems = [];
  drawCharactersDepthSorted(drawItems);
  drawMultiplayerPlayersDepthSorted(drawItems);
  drawBoards(drawItems);
  drawBunkerInterior(drawItems);
  drawItems.sort((a, b) => b.depth - a.depth);
  for (const item of drawItems) {
    if (item.type === 'poly') {
      drawProjectedPolygon(item.poly);
    } else if (item.type === 'tree') {
      drawTreeInfo(item.t);
    } else if (item.type === 'zombie') {
      drawZombieInfo(item.z, item.info);
    } else if (item.type === 'mp') {
      drawMultiplayerPlayer(item.mp);
    } else if (item.type === 'board') {
      const it = item.board;
      if (it.type === 'quad') {
        drawBoardQuadPerspective(item.img, item.iw, item.ih, it.corners, it.flip);
      } else {
        ctx.save();
        ctx.translate(it.sx, it.sy);
        ctx.rotate(it.rot);
        if (it.flip) ctx.scale(-1, 1);
        ctx.drawImage(item.img, 0, 0, item.iw, item.ih, -it.w / 2, -it.h / 2, it.w, it.h);
        ctx.restore();
      }
    }
  }
}

function drawRifle(dt) {
  const fireSheet = assets.rifleFire;
  const reloadSheet = assets.rifleReload;
  if (!fireSheet || !reloadSheet) return;

  rifleFrameTime += dt;
  const frameDuration = 1 / getRifleFps();

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
  const isRunning = movementStartTime != null && (gameTime - movementStartTime) < BUNKER_MOVE_DURATION;
  if (isRunning) {
    const runPhase = ((gameTime - movementStartTime) * RUN_BOB_STEPS_PER_SEC) % 1;
    const angle = Math.PI * (runPhase < 0.5 ? 2 * runPhase : 2 * (1 - runPhase));
    rifleShiftX -= RUN_BOB_LEFT + RUN_BOB_SWAY * Math.cos(angle);
    rifleShiftY += RUN_BOB_DOWN + RUN_BOB_BOUNCE * Math.sin(angle);
  }
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
    let rigidX = ro.x * IRON_SIGHTS_RIGID_RESPONSE;
    let rigidY = ro.y * IRON_SIGHTS_RIGID_RESPONSE;
    const aimLen = Math.hypot(rigidX, rigidY);
    if (aimLen > IRON_SIGHTS_MAX_OFFSET) {
      const s = IRON_SIGHTS_MAX_OFFSET / aimLen;
      rigidX *= s;
      rigidY *= s;
    }
    rigidY -= ironSightsRecoilKick;
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
  ctx.fillText(outOfAmmoMessageText, W / 2, H - 32);
  ctx.textAlign = 'left';
}

function drawUpgradeMessage() {
  if (upgradeMessageTime <= 0 || !upgradeMessageLines.length) return;
  const alpha = Math.min(1, upgradeMessageTime * 1.5);
  ctx.fillStyle = `rgba(255, 220, 120, ${alpha})`;
  ctx.font = `${FONT_SIZE + 2}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  const lineHeight = FONT_SIZE + 10;
  const startY = H / 2 - (upgradeMessageLines.length * lineHeight) / 2;
  for (let i = 0; i < upgradeMessageLines.length; i++) {
    ctx.fillText(upgradeMessageLines[i], W / 2, startY + (i + 0.5) * lineHeight);
  }
  ctx.textAlign = 'left';
}

function drawPositionLabel() {
  const slot = getCurrentBunkerSlot();
  if (!slot) return;
  ctx.fillStyle = '#aaa';
  ctx.font = `${Math.floor(FONT_SIZE * 0.7)}px ${FONT_FAMILY}`;
  const label = slot.type === 'crate' ? 'Ammo Crate' : (slot.label || `Window ${slot.segmentIndex ?? '?'}-${(slot.tileIndex ?? 0) + 1}`);
  ctx.fillText(label, 12, FONT_SIZE * 2 + 22);
}

function drawReticule() {
  if (!pointerLocked) return;
  const ro = getReticuleOffset();
  const cx = Math.round(W / 2 + ro.x);
  const cy = Math.round(H / 2 + ro.y);
  const slot = getCurrentBunkerSlot();
  const pointingAtCrate = slot?.type === 'crate' && isReticuleOnCrate(cx, cy);
  const pointingAtBoardStack = !boardPlaceState && slot?.type === 'window' && isReticuleOnBoardStack(cx, cy);

  if (pointingAtCrate) {
    const img = assets.ammo;
    if (img?.naturalWidth) {
      const size = 32;
      ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = `28px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('\u2340', cx, cy);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    return;
  }
  if (pointingAtBoardStack) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = `32px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\uD83D\uDD28', cx, cy);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return;
  }
}

function drawRunTargetArrow() {
  if (!pointerLocked || gameOver || boardPlaceState) return;
  const ro = getReticuleOffset();
  const px = W / 2 + ro.x;
  const py = H / 2 + ro.y;
  const runTarget = getRunTargetAt(px, py);
  if (!runTarget) return;
  const { bounds } = runTarget;
  const arrowY = bounds.syTop - 22;
  const cx = Math.round(bounds.centerSx);
  const size = 10;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, arrowY + size);
  ctx.lineTo(cx - size * 0.8, arrowY - size * 0.4);
  ctx.lineTo(cx, arrowY - size * 0.2);
  ctx.lineTo(cx + size * 0.8, arrowY - size * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function markBoardBreakAlert(slotKey) {
  if (!slotKey) return;
  const expiresAt = gameTime + BOARD_BREAK_ALERT_DURATION;
  const existing = boardBreakAlerts.find((a) => a.slotKey === slotKey);
  if (existing) existing.expiresAt = expiresAt;
  else boardBreakAlerts.push({ slotKey, expiresAt });
}

function drawBrokenBoardAlerts() {
  if (!boardBreakAlerts.length) return;
  for (const alert of boardBreakAlerts) {
    const slot = bunkerSlots.find((s) => getSlotKey(s) === alert.slotKey);
    if (!slot) continue;
    const b = getSlotScreenBounds(slot);
    if (!b) continue;
    const life = Math.max(0, alert.expiresAt - gameTime);
    if (life <= 0) continue;
    const alpha = 0.3 + 0.7 * Math.min(1, life / BOARD_BREAK_ALERT_DURATION);
    const cx = Math.round(b.centerSx);
    const arrowY = b.syTop - 26;
    const size = 12;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 70, 70, ${alpha})`;
    ctx.fillStyle = `rgba(255, 70, 70, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, arrowY + size);
    ctx.lineTo(cx - size * 0.85, arrowY - size * 0.4);
    ctx.lineTo(cx - size * 0.25, arrowY - size * 0.4);
    ctx.lineTo(cx - size * 0.25, arrowY - size);
    ctx.lineTo(cx + size * 0.25, arrowY - size);
    ctx.lineTo(cx + size * 0.25, arrowY - size * 0.4);
    ctx.lineTo(cx + size * 0.85, arrowY - size * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawEndgameLeaderboard() {
  const ranked = getSortedMatchStats();
  if (!ranked.length) return;
  const accOf = (r) => (r.shotsFired > 0 ? (r.shotsHit / r.shotsFired) : 0);
  const topKills = ranked.reduce((m, r) => Math.max(m, r.kills || 0), 0);
  const topBoards = ranked.reduce((m, r) => Math.max(m, r.boards || 0), 0);
  const topHeadshots = ranked.reduce((m, r) => Math.max(m, r.headshots || 0), 0);
  const topAcc = ranked.reduce((m, r) => Math.max(m, accOf(r)), 0);
  const HI = '#ffd36b';
  const panelW = Math.min(560, Math.floor(W * 0.74));
  const panelH = Math.min(246, Math.floor(H * 0.64));
  const x = W - panelW - 10;
  const y = 18;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.floor(FONT_SIZE * 0.62)}px ${FONT_FAMILY}`;
  ctx.textAlign = 'left';
  ctx.fillText('Match results', x + 10, y + 18);
  ctx.font = `${Math.floor(FONT_SIZE * 0.44)}px ${FONT_FAMILY}`;
  const headerY = y + 34;
  const rankX = x + 10;
  const playerX = x + 34;
  const killsX = x + panelW - 190;
  const boardsX = x + panelW - 146;
  const headshotsX = x + panelW - 98;
  const accX = x + panelW - 46;
  ctx.fillText('#', rankX, headerY);
  ctx.fillText('Player', playerX, headerY);
  ctx.fillText('Kills', killsX, headerY);
  ctx.fillText('Boards', boardsX, headerY);
  ctx.fillText('Headshots', headshotsX, headerY);
  ctx.fillText('Accuracy', accX, headerY);

  const rowH = 14;
  const bodyTop = headerY + 8;
  const bodyH = panelH - (bodyTop - y) - 8;
  const visibleRows = Math.max(1, Math.floor(bodyH / rowH));
  clampLeaderboardScroll(ranked.length, visibleRows);
  const start = leaderboardScrollRow;
  const end = Math.min(ranked.length, start + visibleRows);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 6, bodyTop, panelW - 12, bodyH);
  ctx.clip();
  for (let i = start; i < end; i++) {
    const row = ranked[i];
    const yy = bodyTop + (i - start + 1) * rowH;
    const name = String(row.name || `Player-${row.playerId.slice(-4)}`).slice(0, 24);
    const accRaw = accOf(row);
    const acc = accRaw * 100;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i + 1), rankX, yy);
    ctx.fillText(name, playerX, yy);
    ctx.fillStyle = row.kills === topKills ? HI : '#fff';
    ctx.fillText(String(row.kills), killsX, yy);
    ctx.fillStyle = row.boards === topBoards ? HI : '#fff';
    ctx.fillText(String(row.boards), boardsX, yy);
    ctx.fillStyle = row.headshots === topHeadshots ? HI : '#fff';
    ctx.fillText(String(row.headshots), headshotsX, yy);
    ctx.fillStyle = Math.abs(accRaw - topAcc) < 1e-9 ? HI : '#fff';
    ctx.fillText(`${acc.toFixed(0)}%`, accX, yy);
  }
  ctx.restore();

  if (ranked.length > visibleRows) {
    const trackX = x + panelW - 6;
    const trackY = bodyTop;
    const trackH = bodyH;
    const thumbH = Math.max(16, Math.floor((visibleRows / ranked.length) * trackH));
    const maxStart = Math.max(1, ranked.length - visibleRows);
    const thumbY = trackY + Math.floor((leaderboardScrollRow / maxStart) * (trackH - thumbH));
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(trackX, trackY, 2, trackH);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.fillRect(trackX - 1, thumbY, 4, thumbH);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `${Math.floor(FONT_SIZE * 0.33)}px ${FONT_FAMILY}`;
    ctx.fillText('Scroll wheel', x + panelW - 86, y + panelH - 3);
  }
  ctx.restore();
}

function drawEndgameReturnButton() {
  const w = 220;
  const h = 28;
  const x = Math.floor((W - w) / 2);
  const y = H - h - 14;
  endgameReturnButton = { x, y, w, h };
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(FONT_SIZE * 0.58)}px ${FONT_FAMILY}`;
  ctx.fillText('Return to Main Menu', x + w / 2, y + 18);
  ctx.textAlign = 'left';
  ctx.restore();
}

function handleEndgameReturnClick(e) {
  if (appMode !== 'game') return false;
  if (!gameOver && !gameWon) return false;
  if (!endgameReturnButton) return false;
  const p = getCanvasPointerPos(e);
  const b = endgameReturnButton;
  if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
    returnToMainMenu();
    return true;
  }
  return false;
}

function canShowEndgameResults() {
  if (appMode !== 'game') return false;
  if (gameOver) return (performance.now() / 1000 - gameOverFlashStart) >= ENDGAME_RESULTS_DELAY;
  if (gameWon) return (performance.now() / 1000 - gameWonAt) >= ENDGAME_RESULTS_DELAY;
  return false;
}

function drawMenuBackground() {
  const img = assets.menuBackground || assets.horizonBackground;
  if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    ctx.save();
    // Menu-only smoothing so sub-pixel pan looks fluid.
    ctx.imageSmoothingEnabled = true;
    const scale = H / img.naturalHeight;
    const tileW = Math.max(1, img.naturalWidth * scale);
    const offset = ((menuPanX % tileW) + tileW) % tileW;
    let x = -offset - tileW; // draw one extra tile to hide edge seams
    while (x < W) {
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, x, 0, tileW, H);
      x += tileW;
    }
    ctx.restore();
  } else {
    ctx.fillStyle = '#1a1f23';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
  ctx.fillRect(0, 0, W, H);
}

function drawMenu() {
  drawMenuBackground();
  const def = getMenuPageDefinition();
  const items = def.items || [];

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  const titleFont = menuPage === 'main' ? 'Gogozombie' : FONT_FAMILY;
  ctx.font = `${Math.floor(FONT_SIZE * 1.2)}px ${titleFont}`;
  ctx.fillText(def.title, W / 2, 36);
  ctx.font = `${Math.floor(FONT_SIZE * 0.55)}px ${FONT_FAMILY}`;
  ctx.fillStyle = 'rgba(255,255,255,0.86)';
  ctx.fillText(def.subtitle || '', W / 2, 52);

  const panelH = items.length * MENU_BUTTON_H + Math.max(0, items.length - 1) * MENU_BUTTON_GAP + 16;
  const lobbyExtraH = menuPage === 'lobby' ? 90 : 0;
  const panelX = Math.floor((W - (MENU_BUTTON_W + 20)) / 2);
  const panelY = Math.floor((H - (panelH + lobbyExtraH)) / 2 + 16);
  const panelW = MENU_BUTTON_W + 20;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX + 0.5, panelY + 0.5, panelW - 1, panelH - 1);

  menuButtons = [];
  const startY = panelY + 8;
  for (let i = 0; i < items.length; i++) {
    const y = startY + i * (MENU_BUTTON_H + MENU_BUTTON_GAP);
    const x = Math.floor((W - MENU_BUTTON_W) / 2);
    const selected = i === menuSelectedIndex;
    const hovered = i === menuHoverIndex;
    const lit = selected || hovered;
    ctx.fillStyle = lit ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, y, MENU_BUTTON_W, MENU_BUTTON_H);
    ctx.strokeStyle = lit ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
    ctx.strokeRect(x + 0.5, y + 0.5, MENU_BUTTON_W - 1, MENU_BUTTON_H - 1);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(FONT_SIZE * 0.6)}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(items[i].label, x + MENU_BUTTON_W / 2, y + MENU_BUTTON_H / 2 + 1);
    menuButtons.push({ x, y, w: MENU_BUTTON_W, h: MENU_BUTTON_H });
  }

  if (menuPage === 'lobby') {
    const players = multiplayerLobbyPlayers.slice(0, 8);
    const startY = panelY + panelH + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(panelX, startY, panelW, lobbyExtraH);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.strokeRect(panelX + 0.5, startY + 0.5, panelW - 1, lobbyExtraH - 1);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = `${Math.floor(FONT_SIZE * 0.48)}px ${FONT_FAMILY}`;
    const code = multiplayerSession?.joinCode || '----';
    ctx.fillText(`${t('lobbyJoinCode')}: ${code}`, panelX + 8, startY + 14);
    ctx.fillText(`${t('lobbyPlayers')}: ${players.length}`, panelX + 8, startY + 28);
    ctx.font = `${Math.floor(FONT_SIZE * 0.42)}px ${FONT_FAMILY}`;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const tag = p.isHost ? ' (H)' : '';
      ctx.fillText(`${i + 1}. ${p.name}${tag}`, panelX + 8, startY + 42 + i * 10);
    }
    ctx.textAlign = 'center';
    if (!isLobbyHost()) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(t('lobbyHostOnly'), W / 2, startY + lobbyExtraH - 6);
    }
  }
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  if (menuToast && performance.now() / 1000 < menuToastUntil) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(24, H - 30, W - 48, 18);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(FONT_SIZE * 0.5)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText(menuToast, W / 2, H - 17);
    ctx.textAlign = 'left';
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
  ctx.font = `${Math.floor(FONT_SIZE * 0.65)}px ${FONT_FAMILY}`;
  ctx.fillText('Look at a window/crate and click or press W/Up to run there', W / 2, H / 2 + 48);
  ctx.textAlign = 'left';
}

function drawGameOver() {
  endgameReturnButton = null;
  try {
    const elapsed = performance.now() / 1000 - gameOverFlashStart;
    const redAlpha = 0.5 + 0.35 * Math.max(0, 1 - elapsed / GAME_OVER_FLASH_DURATION);
    ctx.fillStyle = `rgba(140, 0, 0, ${redAlpha})`;
    ctx.fillRect(0, 0, W, H);

    const showZombieFace = elapsed < GAME_OVER_FACE_DURATION && gameOverZombie?.sprite;
    const img = showZombieFace ? gameOverZombie.sprite : null;
    const imgReady = img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;

    if (showZombieFace && imgReady) {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const baseSize = Math.min(W, H) * 0.85;
      const scale = (3 * baseSize) / Math.max(iw, ih, 1);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const x = (W - drawW) / 2;
      const y = 0;
      ctx.drawImage(img, 0, 0, iw, ih, x, y, drawW, drawH);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `${FONT_SIZE * 2}px ${FONT_FAMILY}`;
      ctx.textAlign = 'center';
      ctx.fillText('BUNKER OVERRUN', W / 2, H / 2 - 6);
      ctx.font = `${Math.floor(FONT_SIZE * 0.65)}px ${FONT_FAMILY}`;
      ctx.fillText('A zombie got through a window', W / 2, H / 2 + 18);
      ctx.textAlign = 'left';
    }
  } catch (e) {
    ctx.fillStyle = '#fff';
    ctx.font = `${FONT_SIZE * 2}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('BUNKER OVERRUN', W / 2, H / 2);
    ctx.textAlign = 'left';
  }
  const elapsed = Math.max(0, performance.now() / 1000 - gameOverFlashStart);
  if (elapsed >= ENDGAME_RESULTS_DELAY) {
    drawEndgameLeaderboard();
    drawEndgameReturnButton();
  }
}

function returnToMainMenu() {
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  closeMultiplayerSocket();
  multiplayerSession = null;
  multiplayerAgreedHash = '';
  multiplayerGameSeed = GAME_PARAM_SEED;
  multiplayerWaveCount = GAME_PARAM_WAVE_COUNT;
  multiplayerBunkerLayoutId = menuState.matchSettings.bunkerLayoutId || DEFAULT_BUNKER_LAYOUT_ID;
  setCurrentBunkerLayout(multiplayerBunkerLayoutId);
  multiplayerStartAt = 0;
  pendingLossProposalId = '';
  gameOver = false;
  gameWon = false;
  gameOverZombie = null;
  gameOverFlashStart = 0;
  appMode = 'menu';
  confirmMainMenuOpen = false;
  setMenuPage('main');
}

function openMainMenuConfirm() {
  confirmMainMenuOpen = true;
}

function closeMainMenuConfirm() {
  confirmMainMenuOpen = false;
}

function drawMainMenuConfirmDialog() {
  confirmMainMenuButtons.length = 0;
  const panelW = 330;
  const panelH = 92;
  const x = Math.floor((W - panelW) / 2);
  const y = Math.floor((H - panelH) / 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(x, y, panelW, panelH);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, panelW - 1, panelH - 1);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(FONT_SIZE * 0.6)}px ${FONT_FAMILY}`;
  ctx.fillText('Return to main menu?', x + panelW / 2, y + 27);
  ctx.font = `${Math.floor(FONT_SIZE * 0.45)}px ${FONT_FAMILY}`;
  ctx.fillText('This ends your current run.', x + panelW / 2, y + 43);

  const btnW = 118;
  const btnH = 22;
  const gap = 18;
  const yesX = Math.floor(x + panelW / 2 - gap / 2 - btnW);
  const noX = Math.floor(x + panelW / 2 + gap / 2);
  const btnY = y + 58;
  const drawBtn = (bx, label) => {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx, btnY, btnW, btnH);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.strokeRect(bx + 0.5, btnY + 0.5, btnW - 1, btnH - 1);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(FONT_SIZE * 0.55)}px ${FONT_FAMILY}`;
    ctx.fillText(label, bx + btnW / 2, btnY + 15);
  };
  drawBtn(yesX, 'Yes');
  drawBtn(noX, 'No');
  confirmMainMenuButtons.push({ x: yesX, y: btnY, w: btnW, h: btnH, action: 'yes' });
  confirmMainMenuButtons.push({ x: noX, y: btnY, w: btnW, h: btnH, action: 'no' });
  ctx.textAlign = 'left';
}

function handleMainMenuConfirmKeydown(e) {
  if (!confirmMainMenuOpen) return false;
  if (e.code === 'KeyY' || e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    returnToMainMenu();
    return true;
  }
  if (e.code === 'KeyN' || e.code === 'Escape' || e.code === 'Backspace') {
    e.preventDefault();
    closeMainMenuConfirm();
    return true;
  }
  return true;
}

function handleMainMenuConfirmClick(e) {
  if (!confirmMainMenuOpen) return false;
  const p = getCanvasPointerPos(e);
  for (const b of confirmMainMenuButtons) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
      if (b.action === 'yes') returnToMainMenu();
      else closeMainMenuConfirm();
      return true;
    }
  }
  return true;
}

function drawVictory() {
  endgameReturnButton = null;
  const elapsed = Math.max(0, performance.now() / 1000 - gameWonAt);
  const pulse = 0.25 + 0.2 * Math.sin(elapsed * 2.8);
  ctx.fillStyle = `rgba(20, 70, 35, ${0.62 + pulse * 0.4})`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d9ffd9';
  ctx.font = `${Math.floor(FONT_SIZE * 1.8)}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('VICTORY', W / 2, H / 2 - 10);
  ctx.font = `${Math.floor(FONT_SIZE * 0.7)}px ${FONT_FAMILY}`;
  ctx.fillText('All zombies defeated', W / 2, H / 2 + 18);
  ctx.textAlign = 'left';
  if (elapsed >= ENDGAME_RESULTS_DELAY) {
    drawEndgameLeaderboard();
    drawEndgameReturnButton();
  }
}

function draw() {
  if (appMode === 'menu') {
    if (worldCanvas) worldCanvas.style.display = 'none';
    ctx.clearRect(0, 0, W, H);
    drawMenu();
    return;
  }
  // Ensure endgame UI is clickable with a normal cursor.
  if ((gameOver || gameWon) && pointerLocked && document.pointerLockElement === canvas) {
    document.exitPointerLock();
  }
  if (worldCanvas) worldCanvas.style.display = 'block';
  ctx.clearRect(0, 0, W, H);
  initWorldRendererIfAvailable();
  if (worldRenderer?.isReady()) {
    worldRenderer.setAssets(assets);
    worldRenderer.setState(getWorldRendererState());
    if (worldStaticDirty) {
      worldRenderer.rebuildStaticWorld();
      worldStaticDirty = false;
    }
    drawSky();
    drawHorizonForest();
    drawGround();
    worldRenderer.render();
    ctx.drawImage(worldCanvas, 0, 0);
  } else {
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.floor(FONT_SIZE * 0.65)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.fillText('WebGL renderer unavailable', W / 2, H / 2);
    ctx.textAlign = 'left';
  }
  drawParticles();
  drawTracers();
  if (!gameOver && !boardPlaceState) drawRifle(1 / 60);
  drawReticule();
  drawRunTargetArrow();
  drawBrokenBoardAlerts();
  drawScore();
  drawPositionLabel();
  drawOutOfAmmoMessage();
  drawUpgradeMessage();
  if (gameOver) drawGameOver();
  else if (gameWon) drawVictory();
  else if (!pointerLocked) drawHint();
  if (confirmMainMenuOpen) drawMainMenuConfirmDialog();
}

function tick(dt) {
  if (appMode === 'menu') {
    menuPanX += MENU_PAN_SPEED * dt;
    if (performance.now() / 1000 >= menuToastUntil) menuToast = '';
    draw();
    return;
  }
  gameTime += dt;
  hitFeedbackTime = Math.max(0, hitFeedbackTime - dt);
  outOfAmmoMessageTime = Math.max(0, outOfAmmoMessageTime - dt);
  upgradeMessageTime = Math.max(0, upgradeMessageTime - dt);
  ironSightsRecoilKick *= IRON_SIGHTS_RECOIL_DECAY;
  if (boardPlaceState && gameTime >= boardPlaceState.endTime) {
    const key = boardPlaceState.slotKey;
    windowBoards[key] = Math.min(BOARDS_PER_WINDOW, (windowBoards[key] ?? 0) + 1);
    console.log('[Board nailed up] slotKey=', key, 'slotIndex=', activeSlotIndex, 'boardsOnWindow=', windowBoards[key]);
    recordBoardCompleteStat(multiplayerSession?.playerId || '__local__');
    sendMultiplayerPayload('player_board_complete', {
      slotIndex: activeSlotIndex,
      slotKey: key,
      boardsNow: windowBoards[key] ?? 0,
      at: Date.now(),
    });
    boardPlaceState = null;
  }
  fallingBoards = fallingBoards.filter((fb) => gameTime < fb.endTime);
  boardBreakAlerts = boardBreakAlerts.filter((a) => a.expiresAt > gameTime);
  updateParticles(dt);
  updateTracers(dt);
  if (!gameOver && !gameWon) {
    while (nextZombiePlanIndex < zombieSpawnPlan.length) {
      const nextPlan = zombieSpawnPlan[nextZombiePlanIndex];
      if (!nextPlan || gameTime < (nextPlan.spawnTime ?? 0)) break;
      spawnZombie();
    }
    updateZombies(dt);
    const hasPlannedZombies = zombieSpawnPlan.length > 0;
    if (hasPlannedZombies && nextZombiePlanIndex >= zombieSpawnPlan.length && zombies.length === 0) {
      gameWon = true;
      gameWonAt = performance.now() / 1000;
      if (assets.runningSound) { assets.runningSound.pause(); assets.runningSound.currentTime = 0; }
      movementStartTime = null;
      movementPathPoints = [];
      movementPathLengths = [];
      movementPathTotalLength = 0;
      desiredPitch = 0;
      cameraPitch = 0;
      ironSightsHeld = false;
    }
  }
  const activeSlot = getCurrentBunkerSlot();
  const peek = getPeekOffsetForSlot(activeSlot);
  if (movementStartTime != null && gameTime - movementStartTime < BUNKER_MOVE_DURATION) {
    const t = Math.min(1, (gameTime - movementStartTime) / BUNKER_MOVE_DURATION);
    const s = t * t * (3 - 2 * t);
    const pos = sampleMovementPath(movementPathPoints, movementPathLengths, movementPathTotalLength, movementPathTotalLength * s);
    cameraX = pos.x;
    cameraZ = pos.z;
    if (t >= 1) {
      movementStartTime = null;
      cameraX = movementEndX;
      cameraZ = movementEndZ;
      movementPathPoints = [];
      movementPathLengths = [];
      movementPathTotalLength = 0;
      if (assets.runningSound) { assets.runningSound.pause(); assets.runningSound.currentTime = 0; }
    }
  } else {
    if (movementStartTime != null) {
      movementStartTime = null;
      cameraX = movementEndX;
      cameraZ = movementEndZ;
      movementPathPoints = [];
      movementPathLengths = [];
      movementPathTotalLength = 0;
      if (assets.runningSound) { assets.runningSound.pause(); assets.runningSound.currentTime = 0; }
    }
    const targetCameraX = desiredCameraX + peek.x;
    const targetCameraZ = desiredCameraZ + peek.z;
    const moveT = 1 - Math.exp(-BUNKER_MOVE_LERP * dt);
    cameraX += (targetCameraX - cameraX) * moveT;
    cameraZ += (targetCameraZ - cameraZ) * moveT;
  }
  const chaseT = 1 - Math.exp(-CHASE_LERP * dt);
  cameraYaw += normalizeAngle(desiredYaw - cameraYaw) * chaseT;
  cameraPitch += (desiredPitch - cameraPitch) * chaseT;
  cameraPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, cameraPitch));
  draw();
}

// ---- Input ----

const PITCH_LIMIT = Math.PI / 2 - 0.1;

function playHammerSound() {
  if (assets.hammerSound) {
    assets.hammerSound.currentTime = 0;
    assets.hammerSound.volume = 0.8;
    assets.hammerSound.play().catch(() => {});
  }
}

function playBoardBreakSound() {
  if (assets.boardBreakSound) {
    assets.boardBreakSound.currentTime = 0;
    assets.boardBreakSound.volume = 1;
    assets.boardBreakSound.play().catch(() => {});
  }
}

canvas.addEventListener('click', (e) => {
  if (handleEndgameReturnClick(e)) return;
  if (handleMainMenuConfirmClick(e)) return;
  if (appMode === 'menu') {
    handleMenuClick(e);
    return;
  }
  if (gameOver || gameWon) return;
  if (boardPlaceState) return;
  if (!pointerLocked) {
    canvas.requestPointerLock();
    return;
  }
  const ro = getReticuleOffset();
  const px = W / 2 + ro.x;
  const py = H / 2 + ro.y;
  const slot = getCurrentBunkerSlot();
  const pointingAtCrate = slot?.type === 'crate' && isReticuleOnCrate(px, py);
  const pointingAtBoardStack = slot?.type === 'window' && isReticuleOnBoardStack(px, py);

  if (pointingAtBoardStack) {
    const key = getSlotKey(slot);
    const onFloor = BOARDS_PER_WINDOW - (windowBoards[key] ?? 0);
    if (onFloor > 0) {
      boardPlaceState = { slotKey: key, startTime: gameTime, endTime: gameTime + BOARD_PLACE_DURATION };
      playHammerSound();
      sendMultiplayerPayload('player_board_start', {
        slotIndex: activeSlotIndex,
        slotKey: key,
        boardsOnFloor: onFloor,
        at: Date.now(),
      });
    }
    return;
  }

  if (pointingAtCrate) {
    outOfAmmoShownCrateHint = false;
    playPickUpSound();
    clipsCarried = MAX_CLIPS;
    sendMultiplayerPayload('player_ammo_pickup', {
      slotIndex: activeSlotIndex,
      slotKey: slot ? getSlotKey(slot) : '',
      clipsCarried,
      at: Date.now(),
    });
    return;
  }

  const runTarget = getRunTargetAt(px, py);
  if (runTarget) {
    setActiveBunkerSlot(runTarget.index);
    return;
  }

  if (rifleState !== 'idle') {
    playDryFireSound();
    return;
  }

  if (shotsInClip === 0 && clipsCarried === 0) {
    if (!outOfAmmoShownCrateHint) {
      outOfAmmoMessageText = 'Out of ammo';
      outOfAmmoShownCrateHint = true;
    } else {
      outOfAmmoMessageText = 'Get more ammo from the ammo crate';
    }
    outOfAmmoMessageTime = OUT_OF_AMMO_MESSAGE_DURATION;
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    sendMultiplayerPayload('player_reload_start', { slotIndex: activeSlotIndex, at: Date.now() });
    return;
  }

  if (shotsInClip === 0 && clipsCarried > 0) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    sendMultiplayerPayload('player_reload_start', { slotIndex: activeSlotIndex, at: Date.now() });
    return;
  }

  const canSeeOutside = shotLeavesThroughWindow(px, py);
  const shotDir = getShotDirection(px, py);
  addTracer({ x: cameraX, y: CAMERA_Y - 0.05, z: cameraZ }, shotDir);
  const spitzerUnlocked = score >= UPGRADE_SPITZER_AT;
  const makeShotEvent = (hitOrHits) => {
    const hits = Array.isArray(hitOrHits) ? hitOrHits : (hitOrHits && hitOrHits.type === 'zombie' ? [hitOrHits] : []);
    const first = hits[0] || (hitOrHits && !Array.isArray(hitOrHits) ? hitOrHits : null);
    const hit = first && first.type === 'zombie' ? { type: 'zombie', zombieId: first.zombieId, headshot: first.headshot, killed: first.killed } : (first || null);
    const hitsPayload = hits.map((h) => ({ type: 'zombie', zombieId: h.zombieId, headshot: h.headshot, killed: h.killed }));
    return {
      at: Date.now(),
      px: Math.round(px),
      py: Math.round(py),
      dir: { x: Number(shotDir.x.toFixed(5)), y: Number(shotDir.y.toFixed(5)), z: Number(shotDir.z.toFixed(5)) },
      canSeeOutside: !!canSeeOutside,
      hit,
      hits: hitsPayload,
      shotsInClip,
    };
  };

  const resolveHitsAndSend = (isLastShot) => {
    const firstHit = canSeeOutside ? getHitTarget(px, py) : null;
    let hitPayloads = [];
    if (firstHit?.type === 'tree') {
      damageTree(firstHit.index, px, py);
      sendMultiplayerPayload('player_shot', makeShotEvent(firstHit));
      recordShotStat(multiplayerSession?.playerId || '__local__', firstHit);
      return;
    }
    if (firstHit?.type === 'zombie' && spitzerUnlocked) {
      const rayHits = getZombieHitsAlongRay(shotDir);
      for (const entry of rayHits) {
        const idx = zombies.findIndex((z) => z.spawnIndex === entry.spawnIndex);
        if (idx < 0) continue;
        const payload = damageZombie(idx, entry.hitPx, entry.hitPy);
        if (payload) hitPayloads.push(payload);
      }
      recordShotStat(multiplayerSession?.playerId || '__local__', hitPayloads[0] || null);
      sendMultiplayerPayload('player_shot', makeShotEvent(hitPayloads));
      return;
    }
    if (firstHit?.type === 'zombie') {
      const payload = damageZombie(firstHit.index, px, py);
      hitPayloads = payload ? [payload] : [];
    }
    recordShotStat(multiplayerSession?.playerId || '__local__', hitPayloads[0] || firstHit || null);
    sendMultiplayerPayload('player_shot', makeShotEvent(hitPayloads.length ? hitPayloads : firstHit));
  };

  if (shotsInClip > 1) {
    rifleState = 'firing';
    rifleFrame = 0;
    rifleFrameTime = 0;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    if (ironSightsHeld) ironSightsRecoilKick = IRON_SIGHTS_RECOIL_KICK;
    playShotSound();
    playEjectCasingSound();
    resolveHitsAndSend(false);
  } else if (shotsInClip === 1) {
    rifleState = 'reloading';
    rifleFrame = 0;
    rifleFrameTime = 0;
    reloadSoundPlayed = false;
    boltOpenSoundPlayed = false;
    boltCloseSoundPlayed = false;
    sendMultiplayerPayload('player_reload_start', { slotIndex: activeSlotIndex, at: Date.now() });
    if (ironSightsHeld) ironSightsRecoilKick = IRON_SIGHTS_RECOIL_KICK;
    playShotSound();
    playEjectCasingSound();
    resolveHitsAndSend(true);
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (appMode !== 'game') return;
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
  if (appMode === 'menu') {
    const p = getCanvasPointerPos(e);
    updateMenuHover(p.x, p.y);
    return;
  }
  if (!pointerLocked) return;
  const sens = isIronSightsActive() ? IRON_SIGHTS_SENS : 1;
  desiredYaw += e.movementX * MOUSE_SENS * sens;
  desiredPitch += e.movementY * PITCH_SENS * sens;   // mouse down -> look down (positive pitch), reticule leads then camera follows
  desiredPitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, desiredPitch));
});

canvas.addEventListener('wheel', (e) => {
  if (appMode !== 'game') return;
  if (!canShowEndgameResults()) return;
  const totalRows = playerMatchStats.size;
  if (totalRows <= 0) return;
  e.preventDefault();
  leaderboardScrollRow += e.deltaY > 0 ? 1 : -1;
  clampLeaderboardScroll(totalRows, 1);
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (handleMainMenuConfirmKeydown(e)) return;
  if (appMode === 'menu') {
    handleMenuKeydown(e);
    return;
  }
  if (e.code === 'Escape' && !pointerLocked) {
    openMainMenuConfirm();
    return;
  }
  if (gameOver || gameWon) {
    if (!canShowEndgameResults()) return;
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      returnToMainMenu();
      return;
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      e.preventDefault();
      leaderboardScrollRow += 1;
      clampLeaderboardScroll(playerMatchStats.size, 1);
    } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      e.preventDefault();
      leaderboardScrollRow -= 1;
      clampLeaderboardScroll(playerMatchStats.size, 1);
    }
    return;
  }
  if (boardPlaceState) return;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    ironSightsHeld = true;
  } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
    const ro = getReticuleOffset();
    const px = W / 2 + ro.x;
    const py = H / 2 + ro.y;
    const runTarget = getRunTargetAt(px, py);
    if (runTarget) {
      e.preventDefault();
      setActiveBunkerSlot(runTarget.index);
    }
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
  initWorldRendererIfAvailable();
  generateBunkerLayout();
  requestAnimationFrame(loop);
  loadAssets()
    .then(() => {
      if (worldRenderer?.isReady()) {
        worldRenderer.setAssets(assets);
        worldStaticDirty = true;
      }
    })
    .catch((err) => console.error('Asset load failed:', err));
})();

