/**
 * Matchmaking + roomed WebSocket game server for Please Shoot the Zombies.
 * Run on EC2: npm install && node index.js
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_HTTP_URL = process.env.PUBLIC_HTTP_URL || ''; // optional override
const PUBLIC_WS_URL = process.env.PUBLIC_WS_URL || ''; // optional override
const MAX_ACTIVE_GAMES = Math.max(1, Number(process.env.MAX_ACTIVE_GAMES || 24));
const MAX_CONNECTED_PLAYERS = Math.max(1, Number(process.env.MAX_CONNECTED_PLAYERS || 120));
const SESSION_IDLE_TIMEOUT_MS = Math.max(30_000, Number(process.env.SESSION_IDLE_TIMEOUT_MS || 10 * 60 * 1000));
const SESSION_ENDED_GRACE_MS = Math.max(2_000, Number(process.env.SESSION_ENDED_GRACE_MS || 15_000));

const sessions = new Map(); // sessionId -> session
const wsBySession = new Map(); // sessionId -> Set<ws>
const BOT_NAMES = [
  'Ash', 'Mara', 'Kade', 'Vera', 'Iris', 'Niko', 'Juno', 'Soren',
  'Piper', 'Rowan', 'Quinn', 'Ilya', 'Noor', 'Silas', 'Anya', 'Milo',
  'Tessa', 'Ember', 'Finn', 'Lena', 'Aria', 'Cole', 'Mae', 'Rory',
];
const BOT_ADD_MIN_MS = 4500;
const BOT_ADD_MAX_MS = 11000;
const BOT_THINK_INTERVAL_MS = 220;
const BOT_ACTION_DELAY_MIN_MS = 320;
const BOT_ACTION_DELAY_MAX_MS = 1200;
const BOT_POST_MOVE_HOLD_MS = 4200; // linger longer at each location
const BOT_MOVE_COOLDOWN_MIN_MS = 2400;
const BOT_MOVE_COOLDOWN_MAX_MS = 3600;
const BOT_RELOAD_MS = 2100;
const BOT_BOARD_MS = 2400;
const BOT_EJECT_MS = 320;
const BOT_AIM_NEW_TARGET_MIN_MS = 1700;
const BOT_AIM_NEW_TARGET_MAX_MS = 2600;
const BOT_AIM_SAME_TARGET_MIN_MS = 450;
const BOT_AIM_SAME_TARGET_MAX_MS = 900;
const BOT_MAX_CLIPS = 10;
const BOT_CLIP_SIZE = 5;
const BOT_SLOT_COUNT = 13; // 12 windows + 1 crate slot
const BOT_CRATE_SLOT = 12;
const BOT_WINDOW_SLOTS = Array.from({ length: 12 }, (_, i) => i);
const SERVER_ZOMBIE_COUNT_MULTIPLIER = 10;
const BOT_VIEW_CONE_SLOT_RADIUS = 2;
const BOT_BROKEN_BOARD_PRIORITY_MS = 7000;

function overloadError() {
  return 'Server is overloaded right now. Please wait a minute and try again.';
}

function randomId(prefix = '') {
  return `${prefix}${crypto.randomBytes(6).toString('hex')}`;
}

function randomJoinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function publicHttpBase(req) {
  if (PUBLIC_HTTP_URL) return PUBLIC_HTTP_URL.replace(/\/+$/, '');
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}`;
}

function publicWsBase(req) {
  if (PUBLIC_WS_URL) return PUBLIC_WS_URL.replace(/\/+$/, '');
  const host = req.headers.host || `localhost:${PORT}`;
  return `ws://${host}`;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, payload) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeName(name) {
  const s = String(name || '').trim().slice(0, 24);
  return s || `Player-${crypto.randomBytes(2).toString('hex')}`;
}

function countBots(session) {
  let n = 0;
  session.players.forEach((p) => { if (p?.isBot) n++; });
  return n;
}

function countHumans(session) {
  let n = 0;
  session.players.forEach((p) => { if (!p?.isBot) n++; });
  return n;
}

function pickBotName(session) {
  const used = new Set(Array.from(session.players.values()).map((p) => p.name));
  for (let i = 0; i < BOT_NAMES.length; i++) {
    const candidate = BOT_NAMES[(i + Math.floor(Math.random() * BOT_NAMES.length)) % BOT_NAMES.length];
    if (!used.has(candidate)) return candidate;
  }
  return `Survivor-${Math.floor(1000 + Math.random() * 9000)}`;
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

function seeded(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function chooseWeighted(weights, rng) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function makeBotRuntimePlayer(slotIndex = 0) {
  return {
    slotIndex,
    shotsInClip: BOT_CLIP_SIZE,
    clipsCarried: BOT_MAX_CLIPS,
    reloadUntil: 0,
    actionUntil: 0,
    boardUntil: 0,
    boardTargetSlot: -1,
    ejectUntil: 0,
    moveCooldownUntil: 0,
    holdSlotUntil: 0,
    recentSlots: [slotIndex],
    aimTargetZombieId: -1,
    aimReadyAt: 0,
    lastShotZombieId: -1,
    // Per-bot pregame profile so accuracy naturally varies.
    baseAccuracy: 0.75,
    baseHeadshotChance: 0.22,
    baseAimSpread: 0.08,
  };
}

function hashToUnit(str) {
  const s = String(str || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function slotOccupancyCounts(session) {
  const rt = ensureRuntime(session);
  const counts = new Map();
  for (const p of session.players.values()) {
    const st = ensurePlayerRuntimeState(session, p);
    const idx = Number.isFinite(st.slotIndex) ? st.slotIndex : 0;
    counts.set(idx, (counts.get(idx) || 0) + 1);
  }
  return counts;
}

function chooseUnoccupiedBiasedSlot(candidates, occupancy, recentSlots = [], rng = Math.random) {
  if (!candidates || candidates.length === 0) return BOT_WINDOW_SLOTS[0] || 0;
  const rec = Array.isArray(recentSlots) ? recentSlots : [];
  const weights = candidates.map((slot) => {
    const occ = occupancy.get(slot) || 0;
    // Slight but meaningful bias away from crowded windows.
    let w = 1 / (1 + occ * 0.9);
    const idx = rec.lastIndexOf(slot);
    if (idx >= 0) {
      const age = rec.length - 1 - idx; // older visit -> less penalty
      const freshnessPenalty = Math.max(0.15, 0.45 + age * 0.12);
      w *= freshnessPenalty;
    }
    return w;
  });
  const idx = chooseWeighted(weights, rng);
  return candidates[Math.max(0, Math.min(candidates.length - 1, idx))];
}

function sessionSnapshot(session, req) {
  const rt = ensureRuntime(session);
  const connectedCount = connectedPlayersForSession(session.sessionId).length;
  return {
    sessionId: session.sessionId,
    joinCode: session.joinCode,
    privacy: session.privacy,
    maxPlayers: session.maxPlayers,
    botsFill: session.botsFill,
    difficulty: session.difficulty,
    status: session.status,
    createdAt: session.createdAt,
    players: Array.from(session.players.values()).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      isHost: !!p.isHost,
      slotIndex: rt.playerState.get(p.playerId)?.slotIndex ?? 0,
    })),
    playerCount: connectedCount,
    wsUrl: `${publicWsBase(req)}/ws`,
    gameSeed: session.game.seed,
    waveCount: session.game.waveCount,
    bunkerLayoutId: typeof session.game.bunkerLayoutId === 'number' ? session.game.bunkerLayoutId : 0,
    agreedHash: session.game.agreedHash || '',
    startedAt: session.game.startedAt || 0,
  };
}

function broadcastToSession(sessionId, payload, exceptWs = null) {
  const room = wsBySession.get(sessionId);
  if (!room || room.size === 0) return;
  const session = sessions.get(sessionId);
  if (session) session.lastActivityAt = Date.now();
  const raw = JSON.stringify(payload);
  room.forEach((ws) => {
    if (ws === exceptWs) return;
    if (ws.readyState === ws.OPEN) ws.send(raw);
  });
}

function ensureSessionRoom(sessionId) {
  if (!wsBySession.has(sessionId)) wsBySession.set(sessionId, new Set());
  return wsBySession.get(sessionId);
}

function getSessionByJoinCode(joinCode) {
  const code = String(joinCode || '').trim().toUpperCase();
  for (const s of sessions.values()) {
    if (s.joinCode === code) return s;
  }
  return null;
}

function ensureRuntime(session) {
  if (session.runtime) return session.runtime;
  const rng = seeded((session.game.seed ^ 0x9e3779b9) >>> 0);
  const zombies = [];
  const waveCount = Math.max(1, Number(session.game.waveCount) || 6);
  let t = 0.8;
  let zombieId = 1;
  for (let wave = 0; wave < waveCount; wave++) {
    const count = (4 + (wave % 4) + randInt(0, 2)) * SERVER_ZOMBIE_COUNT_MULTIPLIER;
    for (let i = 0; i < count; i++) {
      const targetSlot = BOT_WINDOW_SLOTS[Math.floor(rng() * BOT_WINDOW_SLOTS.length)];
      const spawnAt = t + i * (0.9 + rng() * 0.8);
      const breachAt = spawnAt + 12 + rng() * 18;
      zombies.push({
        id: zombieId++,
        hp: 3,
        alive: false,
        dead: false,
        spawnAt,
        breachAt,
        targetSlot,
      });
    }
    t += 6.5 + count * 0.75;
  }
  session.runtime = {
    createdAt: Date.now(),
    startedAt: 0,
    zombies,
    boards: new Map(BOT_WINDOW_SLOTS.map((s) => [s, 0])),
    recentBrokenUntil: new Map(), // slot -> timestamp(ms) until considered "recently broken"
    windowSlots: new Set(BOT_WINDOW_SLOTS),
    crateSlot: BOT_CRATE_SLOT,
    maxObservedSlot: BOT_SLOT_COUNT - 1,
    playerState: new Map(), // playerId -> runtime state
    nextBotAddAt: Date.now() + randInt(BOT_ADD_MIN_MS, BOT_ADD_MAX_MS),
    lastTickAt: Date.now(),
  };
  return session.runtime;
}

function ensurePlayerRuntimeState(session, player) {
  const rt = ensureRuntime(session);
  if (!rt.playerState.has(player.playerId)) {
    const slot = BOT_WINDOW_SLOTS[Math.floor(Math.random() * BOT_WINDOW_SLOTS.length)];
    const st = makeBotRuntimePlayer(slot);
    if (player?.isBot) {
      const u1 = hashToUnit(`${player.playerId}:acc`);
      const u2 = hashToUnit(`${player.playerId}:head`);
      const u3 = hashToUnit(`${player.playerId}:aim`);
      st.baseAccuracy = 0.62 + u1 * 0.26; // 62%-88%
      st.baseHeadshotChance = 0.10 + u2 * 0.26; // 10%-36%
      st.baseAimSpread = 0.06 + u3 * 0.14; // tighter to wider
    }
    rt.playerState.set(player.playerId, st);
  }
  return rt.playerState.get(player.playerId);
}

function addBotToSession(session) {
  if (session.status !== 'open') return null;
  if (!session.botsFill) return null;
  if (session.players.size >= session.maxPlayers) return null;
  const playerId = randomId('b_');
  const bot = {
    playerId,
    name: pickBotName(session),
    isHost: false,
    isBot: true,
  };
  session.players.set(playerId, bot);
  const st = ensurePlayerRuntimeState(session, bot);
  broadcastToSession(session.sessionId, {
    type: 'player_joined',
    sessionId: session.sessionId,
    player: { playerId: bot.playerId, name: bot.name, isHost: false, slotIndex: st.slotIndex ?? 0 },
  });
  return bot;
}

function removeOneBotForHumanJoin(session) {
  let victim = null;
  for (const p of session.players.values()) {
    if (p?.isBot) {
      victim = p;
      break;
    }
  }
  if (!victim) return null;
  session.players.delete(victim.playerId);
  if (session.runtime) session.runtime.playerState.delete(victim.playerId);
  broadcastToSession(session.sessionId, {
    type: 'player_left',
    sessionId: session.sessionId,
    playerId: victim.playerId,
  });
  return victim;
}

function desiredOpenLobbyBots(session) {
  if (!session.botsFill) return 0;
  const humans = countHumans(session);
  const cap = Math.max(0, session.maxPlayers - humans);
  if (cap <= 0) return 0;
  // Keep lobbies lively but leave room for real players.
  return Math.min(cap, Math.max(1, Math.floor(session.maxPlayers * 0.6) - humans + 1));
}

function maybeTrickleBots(session, nowMs) {
  if (session.status !== 'open') return;
  const rt = ensureRuntime(session);
  if (!session.botsFill) return;
  const bots = countBots(session);
  const desired = desiredOpenLobbyBots(session);
  if (bots >= desired) return;
  if (nowMs < rt.nextBotAddAt) return;
  const added = addBotToSession(session);
  rt.nextBotAddAt = nowMs + randInt(BOT_ADD_MIN_MS, BOT_ADD_MAX_MS);
  if (added) {
    // Optional small chance of immediate second trickle in very empty lobbies.
    if (countHumans(session) <= 1 && countBots(session) < desired && Math.random() < 0.25) {
      rt.nextBotAddAt = nowMs + randInt(1200, 2500);
    }
  }
}

function emitBotAction(session, bot, payload) {
  const envelope = {
    type: 'relay',
    sessionId: session.sessionId,
    fromPlayerId: bot.playerId,
    payload,
    ts: Date.now(),
  };
  broadcastToSession(session.sessionId, envelope, null);
}

function slotDistance(a, b) {
  return Math.abs(a - b);
}

function rememberObservedSlot(rt, slot) {
  if (!Number.isFinite(slot)) return;
  const s = Math.max(0, Math.floor(slot));
  rt.maxObservedSlot = Math.max(rt.maxObservedSlot || 0, s);
}

function getBotCrateSlot(rt) {
  return Number.isFinite(rt?.crateSlot) ? Math.floor(rt.crateSlot) : BOT_CRATE_SLOT;
}

function getBotWindowSlots(rt) {
  if (!rt?.windowSlots || rt.windowSlots.size === 0) return BOT_WINDOW_SLOTS.slice();
  const crate = getBotCrateSlot(rt);
  return Array.from(rt.windowSlots)
    .filter((s) => Number.isFinite(s))
    .map((s) => Math.max(0, Math.floor(s)))
    .filter((s) => s !== crate)
    .sort((a, b) => a - b);
}

function circularWindowDistance(windowSlots, a, b) {
  const idxA = windowSlots.indexOf(a);
  const idxB = windowSlots.indexOf(b);
  if (idxA < 0 || idxB < 0 || windowSlots.length < 2) return Math.abs(a - b);
  const d = Math.abs(idxA - idxB);
  return Math.min(d, windowSlots.length - d);
}

function zombieRangeScore(state, z, windowSlots, elapsed) {
  const slotDist = circularWindowDistance(windowSlots, state.slotIndex, z.targetSlot);
  const slotNorm = Math.max(0, Math.min(1, slotDist / Math.max(1, BOT_VIEW_CONE_SLOT_RADIUS)));
  const timeToBreach = Math.max(0, (z.breachAt || 0) - elapsed);
  const timeNorm = Math.max(0, Math.min(1, (timeToBreach - 2) / 18));
  return Math.max(slotNorm * 0.85, timeNorm);
}

function canBotSeeZombieFromSlot(state, z, windowSlots, elapsed) {
  const slotDist = circularWindowDistance(windowSlots, state.slotIndex, z.targetSlot);
  if (slotDist > BOT_VIEW_CONE_SLOT_RADIUS) return false;
  if (slotDist > 0) {
    const timeToBreach = Math.max(0, (z.breachAt || 0) - elapsed);
    if (timeToBreach > 20) return false;
  }
  return true;
}

function updateRuntimeFromHumanAction(session, playerId, msg) {
  const player = session.players.get(playerId);
  if (!player) return;
  const state = ensurePlayerRuntimeState(session, player);
  const rt = ensureRuntime(session);
  if (msg.type === 'player_move') {
    const next = Number(msg.toSlotIndex);
    if (Number.isFinite(next)) {
      state.slotIndex = Math.max(0, Math.floor(next));
      rememberObservedSlot(rt, state.slotIndex);
    }
    return;
  }
  if (msg.type === 'player_ammo_pickup') {
    const slot = Number(msg.slotIndex);
    if (Number.isFinite(slot)) {
      rt.crateSlot = Math.max(0, Math.floor(slot));
      rememberObservedSlot(rt, rt.crateSlot);
      if (!rt.windowSlots) rt.windowSlots = new Set(BOT_WINDOW_SLOTS);
      rt.windowSlots.delete(rt.crateSlot);
    }
    state.clipsCarried = BOT_MAX_CLIPS;
    return;
  }
  if (msg.type === 'player_board_complete') {
    const slot = Number(msg.slotIndex);
    const key = Number.isFinite(slot) ? Math.floor(slot) : -1;
    if (key >= 0) {
      rememberObservedSlot(rt, key);
      if (!rt.windowSlots) rt.windowSlots = new Set(BOT_WINDOW_SLOTS);
      rt.windowSlots.add(key);
      if (key !== rt.crateSlot && !rt.boards.has(key)) rt.boards.set(key, 0);
    }
    if (rt.boards.has(key)) {
      rt.boards.set(key, Math.min(3, (rt.boards.get(key) || 0) + 1));
      if ((rt.boards.get(key) || 0) >= 3 && rt.recentBrokenUntil) rt.recentBrokenUntil.delete(key);
    }
    return;
  }
  if (msg.type === 'player_shot') {
    const slot = Number(msg.slotIndex);
    if (Number.isFinite(slot)) {
      rememberObservedSlot(rt, slot);
      if (!rt.windowSlots) rt.windowSlots = new Set(BOT_WINDOW_SLOTS);
      rt.windowSlots.add(Math.floor(slot));
    }
    const target = Number(msg.targetSlotIndex);
    if (Number.isFinite(target)) {
      rememberObservedSlot(rt, target);
      if (!rt.windowSlots) rt.windowSlots = new Set(BOT_WINDOW_SLOTS);
      rt.windowSlots.add(Math.floor(target));
    }
  }
}

function tickBotGameplay(session, nowMs) {
  if (session.status !== 'in_progress') return;
  const rt = ensureRuntime(session);
  if (!rt.recentBrokenUntil) rt.recentBrokenUntil = new Map();
  if (!session.game.startedAt || nowMs < session.game.startedAt) return;
  if (!rt.startedAt) rt.startedAt = session.game.startedAt;
  const elapsed = (nowMs - rt.startedAt) / 1000;

  for (const z of rt.zombies) {
    if (!z.alive && !z.dead && elapsed >= z.spawnAt) z.alive = true;
  }

  // Very simple breach model for headless runtime.
  for (const z of rt.zombies) {
    if (!z.alive || z.dead) continue;
    const boards = rt.boards.get(z.targetSlot) || 0;
    if (boards < 3) {
      rt.recentBrokenUntil.set(z.targetSlot, Math.max(rt.recentBrokenUntil.get(z.targetSlot) || 0, nowMs + BOT_BROKEN_BOARD_PRIORITY_MS));
    }
    if (boards <= 0 && elapsed >= z.breachAt && !session.lossVote) {
      // Trigger consensus-driven game over request.
      const proposalId = randomId('loss_');
      const deadline = Date.now() + 1200;
      const votes = new Map(); // bots don't vote; connected humans vote.
      session.lossVote = {
        proposalId,
        deadline,
        votes,
        reason: 'window_breach',
        meta: { zombieId: z.id, targetSlot: z.targetSlot },
        timer: setTimeout(() => finalizeLossVote(session.sessionId, proposalId, true), 1250),
      };
      broadcastToSession(session.sessionId, {
        type: 'game_over_vote_request',
        sessionId: session.sessionId,
        proposalId,
        deadline,
        reason: session.lossVote.reason,
        meta: session.lossVote.meta,
      });
      break;
    }
  }

  const occupancy = slotOccupancyCounts(session);
  const crateSlot = getBotCrateSlot(rt);
  const windowSlots = (() => {
    const ws = getBotWindowSlots(rt);
    return ws.length ? ws : BOT_WINDOW_SLOTS.slice();
  })();
  if (!rt.boards) rt.boards = new Map();
  for (const s of windowSlots) {
    if (s === crateSlot) continue;
    if (!rt.boards.has(s)) rt.boards.set(s, 0);
  }
  const canMove = (state) => nowMs >= (state.moveCooldownUntil || 0) && nowMs >= (state.holdSlotUntil || 0);
  for (const [slot, until] of rt.recentBrokenUntil) {
    if (until <= nowMs || (rt.boards.get(slot) || 0) >= 3) rt.recentBrokenUntil.delete(slot);
  }
  const freshBrokenSlots = windowSlots.filter((s) => (rt.recentBrokenUntil.get(s) || 0) > nowMs && (rt.boards.get(s) || 0) < 3);
  const applyMove = (bot, state, toSlot) => {
    const maxSlot = Math.max(rt.maxObservedSlot || 0, crateSlot, ...windowSlots) + 2;
    const next = Math.max(0, Math.min(maxSlot, Math.floor(toSlot)));
    if (next === state.slotIndex) return false;
    const prev = state.slotIndex;
    state.slotIndex = next;
    // De-crowd accounting for subsequent bots in this tick.
    occupancy.set(prev, Math.max(0, (occupancy.get(prev) || 1) - 1));
    occupancy.set(next, (occupancy.get(next) || 0) + 1);
    emitBotAction(session, bot, {
      type: 'player_move',
      fromSlotIndex: prev,
      toSlotIndex: state.slotIndex,
      at: nowMs,
    });
    state.moveCooldownUntil = nowMs + randInt(BOT_MOVE_COOLDOWN_MIN_MS, BOT_MOVE_COOLDOWN_MAX_MS);
    state.holdSlotUntil = nowMs + BOT_POST_MOVE_HOLD_MS + randInt(0, 350);
    state.actionUntil = nowMs + randInt(700, 1500);
    state.recentSlots = (state.recentSlots || []).concat([next]).slice(-8);
    state.aimTargetZombieId = -1;
    state.aimReadyAt = 0;
    return true;
  };

  for (const bot of session.players.values()) {
    if (!bot?.isBot) continue;
    const state = ensurePlayerRuntimeState(session, bot);
    if (nowMs < state.actionUntil) continue;

    if (state.boardUntil && nowMs >= state.boardUntil) {
      const slot = state.boardTargetSlot;
      if (rt.boards.has(slot)) {
        rt.boards.set(slot, Math.min(3, (rt.boards.get(slot) || 0) + 1));
        emitBotAction(session, bot, {
          type: 'player_board_complete',
          slotIndex: slot,
          slotKey: `bot-slot-${slot}`,
          boardsNow: rt.boards.get(slot),
          at: nowMs,
        });
      }
      state.boardUntil = 0;
      state.boardTargetSlot = -1;
      state.actionUntil = nowMs + randInt(BOT_ACTION_DELAY_MIN_MS, BOT_ACTION_DELAY_MAX_MS);
      continue;
    }

    if (state.reloadUntil && nowMs >= state.reloadUntil) {
      if (state.clipsCarried > 0) {
        state.shotsInClip = BOT_CLIP_SIZE;
        state.clipsCarried = Math.max(0, state.clipsCarried - 1);
      }
      state.reloadUntil = 0;
      state.actionUntil = nowMs + randInt(260, 520);
      continue;
    }

    if (state.ejectUntil && nowMs < state.ejectUntil) continue;

    const visibleZombies = rt.zombies
      .filter((z) => z.alive && !z.dead && canBotSeeZombieFromSlot(state, z, windowSlots, elapsed))
      .map((z) => ({ z, rangeScore: zombieRangeScore(state, z, windowSlots, elapsed) }));
    const currentBoards = rt.boards.get(state.slotIndex) || 0;

    // 1) If bot can't currently see zombies, prioritize boarding nearby/current window.
    const totalAmmo = Math.max(0, state.shotsInClip) + Math.max(0, state.clipsCarried) * BOT_CLIP_SIZE;

    // Hard rule: when fully out, bot only handles ammo run + reload.
    if (totalAmmo <= 0) {
      state.aimTargetZombieId = -1;
      state.aimReadyAt = 0;
      if (state.slotIndex !== crateSlot) {
        if (!canMove(state)) {
          state.actionUntil = nowMs + randInt(260, 520);
          continue;
        }
        applyMove(bot, state, crateSlot);
      } else {
        state.clipsCarried = BOT_MAX_CLIPS;
        emitBotAction(session, bot, {
          type: 'player_ammo_pickup',
          slotIndex: crateSlot,
          slotKey: 'bot-slot-crate',
          clipsCarried: state.clipsCarried,
          at: nowMs,
        });
        state.reloadUntil = nowMs + BOT_RELOAD_MS;
        emitBotAction(session, bot, {
          type: 'player_reload_start',
          slotIndex: state.slotIndex,
          at: nowMs,
        });
        state.actionUntil = state.reloadUntil;
      }
      continue;
    }

    // Low ammo behavior: occasionally top up early.
    if (state.clipsCarried <= 2 && state.slotIndex !== crateSlot && Math.random() < 0.2) {
      state.aimTargetZombieId = -1;
      state.aimReadyAt = 0;
      if (!canMove(state)) {
        state.actionUntil = nowMs + randInt(240, 480);
        continue;
      }
      applyMove(bot, state, crateSlot);
      continue;
    }

    if (visibleZombies.length === 0 && state.slotIndex !== crateSlot && currentBoards < 3 && !state.boardUntil) {
      state.aimTargetZombieId = -1;
      state.aimReadyAt = 0;
      emitBotAction(session, bot, {
        type: 'player_board_start',
        slotIndex: state.slotIndex,
        slotKey: `bot-slot-${state.slotIndex}`,
        boardsOnFloor: Math.max(0, 3 - currentBoards),
        at: nowMs,
      });
      state.boardTargetSlot = state.slotIndex;
      state.boardUntil = nowMs + BOT_BOARD_MS;
      state.actionUntil = state.boardUntil;
      continue;
    }

    const threatened = rt.zombies.find((z) => z.alive && !z.dead && slotDistance(state.slotIndex, z.targetSlot) <= 2 && (rt.boards.get(z.targetSlot) || 0) < 3);
    if (threatened && !state.boardUntil) {
      state.aimTargetZombieId = -1;
      state.aimReadyAt = 0;
      if (state.slotIndex !== threatened.targetSlot) {
        if (!canMove(state)) {
          state.actionUntil = nowMs + randInt(220, 420);
          continue;
        }
        const nearby = windowSlots.filter((s) => slotDistance(s, threatened.targetSlot) <= 1);
        const targetSlot = chooseUnoccupiedBiasedSlot(nearby.length ? nearby : [threatened.targetSlot], occupancy, state.recentSlots);
        applyMove(bot, state, targetSlot);
        continue;
      }
      emitBotAction(session, bot, {
        type: 'player_board_start',
        slotIndex: state.slotIndex,
        slotKey: `bot-slot-${state.slotIndex}`,
        boardsOnFloor: Math.max(0, 3 - (rt.boards.get(state.slotIndex) || 0)),
        at: nowMs,
      });
      state.boardTargetSlot = state.slotIndex;
      state.boardUntil = nowMs + BOT_BOARD_MS;
      state.actionUntil = state.boardUntil;
      continue;
    }

    // Priority patrol: if any window was recently broken, rotate bots there first.
    if (freshBrokenSlots.length > 0 && !state.boardUntil && state.slotIndex !== crateSlot) {
      const targetBroken = chooseUnoccupiedBiasedSlot(freshBrokenSlots, occupancy, state.recentSlots);
      if (state.slotIndex !== targetBroken) {
        if (!canMove(state)) {
          state.actionUntil = nowMs + randInt(220, 420);
          continue;
        }
        applyMove(bot, state, targetBroken);
        continue;
      }
    }

    if (visibleZombies.length > 0 && state.shotsInClip > 0 && !state.reloadUntil) {
      visibleZombies.sort((a, b) => a.rangeScore - b.rangeScore);
      // Keep lock on the current aimed target when possible.
      let targetWrap = null;
      if (state.aimTargetZombieId >= 0) {
        targetWrap = visibleZombies.find((vw) => Number(vw.z.id) === Number(state.aimTargetZombieId)) || null;
      }
      // If lock is lost, acquire a new target and wait to aim once.
      if (!targetWrap) {
        targetWrap = Math.random() < 0.78
          ? visibleZombies[0]
          : visibleZombies[Math.floor(Math.random() * visibleZombies.length)];
        const targetId = Number(targetWrap.z.id);
        if (state.aimTargetZombieId !== targetId) {
          state.aimTargetZombieId = targetId;
          state.aimReadyAt = nowMs + randInt(BOT_AIM_NEW_TARGET_MIN_MS, BOT_AIM_NEW_TARGET_MAX_MS);
          state.actionUntil = state.aimReadyAt;
          continue;
        }
      }
      if ((state.aimReadyAt || 0) > nowMs) {
        state.actionUntil = state.aimReadyAt;
        continue;
      }
      const target = targetWrap.z;
      const targetId = Number(target.id);
      const rangeScore = targetWrap.rangeScore;
      const hitChance = Math.max(0.2, Math.min(0.95, state.baseAccuracy - 0.42 * rangeScore + randRange(-0.05, 0.05)));
      const headshotChance = Math.max(0.02, Math.min(0.7, state.baseHeadshotChance - 0.24 * rangeScore + randRange(-0.03, 0.03)));
      const roll = Math.random();
      let hit = null;
      if (roll < hitChance) {
        const headshot = Math.random() < headshotChance;
        const dmg = headshot ? 3 : 1;
        target.hp -= dmg;
        const killed = target.hp <= 0;
        if (killed) {
          target.dead = true;
          target.alive = false;
        }
        hit = {
          type: 'zombie',
          zombieId: target.id,
          headshot,
          killed,
        };
      }
      state.shotsInClip = Math.max(0, state.shotsInClip - 1);
      emitBotAction(session, bot, {
        type: 'player_shot',
        at: nowMs,
        slotIndex: state.slotIndex,
        targetSlotIndex: target.targetSlot,
        px: randInt(160, 300),
        py: randInt(90, 190),
        dir: {
          x: Number(randRange(-state.baseAimSpread, state.baseAimSpread).toFixed(4)),
          y: Number(randRange(-state.baseAimSpread * 0.75, state.baseAimSpread * 0.75).toFixed(4)),
          z: Number(randRange(0.85, 0.99).toFixed(4)),
        },
        canSeeOutside: true,
        hit,
        shotsInClip: state.shotsInClip,
      });
      if (state.shotsInClip <= 0) {
        state.ejectUntil = nowMs + BOT_EJECT_MS;
        state.aimTargetZombieId = -1;
        state.aimReadyAt = 0;
        if (state.clipsCarried > 0) {
          state.reloadUntil = nowMs + BOT_RELOAD_MS;
          emitBotAction(session, bot, {
            type: 'player_reload_start',
            slotIndex: state.slotIndex,
            at: nowMs,
          });
        }
      }
      state.lastShotZombieId = targetId;
      state.aimTargetZombieId = targetId;
      state.aimReadyAt = nowMs + randInt(BOT_AIM_SAME_TARGET_MIN_MS, BOT_AIM_SAME_TARGET_MAX_MS);
      state.actionUntil = nowMs + randInt(BOT_ACTION_DELAY_MIN_MS, BOT_ACTION_DELAY_MAX_MS);
      continue;
    }

    if (state.shotsInClip <= 0 && state.clipsCarried <= 0) {
      if (state.slotIndex !== crateSlot) {
        if (!canMove(state)) {
          state.actionUntil = nowMs + randInt(220, 420);
          continue;
        }
        applyMove(bot, state, crateSlot);
      } else {
        state.clipsCarried = BOT_MAX_CLIPS;
        emitBotAction(session, bot, {
          type: 'player_ammo_pickup',
          slotIndex: crateSlot,
          slotKey: 'bot-slot-crate',
          clipsCarried: state.clipsCarried,
          at: nowMs,
        });
        state.reloadUntil = nowMs + BOT_RELOAD_MS;
        emitBotAction(session, bot, {
          type: 'player_reload_start',
          slotIndex: state.slotIndex,
          at: nowMs,
        });
        state.actionUntil = nowMs + randInt(700, 1300);
      }
      continue;
    }

    if (state.shotsInClip <= 0 && state.clipsCarried > 0 && !state.reloadUntil) {
      state.reloadUntil = nowMs + BOT_RELOAD_MS;
      emitBotAction(session, bot, {
        type: 'player_reload_start',
        slotIndex: state.slotIndex,
        at: nowMs,
      });
      state.actionUntil = state.reloadUntil;
      continue;
    }

    // Idle movement to keep bots looking alive.
    if (!canMove(state)) {
      state.actionUntil = nowMs + randInt(260, 520);
      continue;
    }
    const targetSlot = chooseUnoccupiedBiasedSlot(windowSlots, occupancy, state.recentSlots);
    if (!applyMove(bot, state, targetSlot)) {
      state.actionUntil = nowMs + randInt(900, 1700);
    }
  }
}

function connectedPlayersForSession(sessionId) {
  const room = wsBySession.get(sessionId);
  if (!room || room.size === 0) return [];
  const ids = [];
  room.forEach((ws) => {
    if (ws.readyState === ws.OPEN && ws.playerId) ids.push(ws.playerId);
  });
  return ids;
}

function totalConnectedPlayers() {
  let total = 0;
  for (const sessionId of wsBySession.keys()) total += connectedPlayersForSession(sessionId).length;
  return total;
}

function activeGameCount() {
  let n = 0;
  for (const s of sessions.values()) {
    if (s.status === 'starting' || s.status === 'in_progress') n++;
  }
  return n;
}

function isOverloadedForNewGame() {
  return activeGameCount() >= MAX_ACTIVE_GAMES || totalConnectedPlayers() >= MAX_CONNECTED_PLAYERS;
}

function closeAndRemoveSession(sessionId, reason = 'Session closed') {
  const room = wsBySession.get(sessionId);
  if (room) {
    room.forEach((ws) => {
      try { ws.close(1000, reason); } catch {}
    });
  }
  wsBySession.delete(sessionId);
  sessions.delete(sessionId);
}

function finalizeHandshake(sessionId) {
  const session = sessions.get(sessionId);
  if (!session || session.status !== 'starting' || session.game.startedAt) return;
  const connected = connectedPlayersForSession(sessionId);
  if (connected.length === 0) return;
  const votes = connected
    .map((pid) => ({ playerId: pid, hash: session.handshake.votes.get(pid) || '' }))
    .filter((v) => !!v.hash);
  if (votes.length === 0) return;

  const counts = new Map();
  votes.forEach((v) => counts.set(v.hash, (counts.get(v.hash) || 0) + 1));
  let winnerHash = '';
  let winnerCount = -1;
  counts.forEach((count, hash) => {
    if (count > winnerCount || (count === winnerCount && hash < winnerHash)) {
      winnerHash = hash;
      winnerCount = count;
    }
  });
  if (!winnerHash) return;

  const room = wsBySession.get(sessionId);
  if (room) {
    room.forEach((ws) => {
      if (ws.readyState !== ws.OPEN) return;
      const voted = session.handshake.votes.get(ws.playerId) || '';
      if (voted && voted !== winnerHash) {
        ws.send(JSON.stringify({
          type: 'hash_mismatch',
          agreedHash: winnerHash,
          yourHash: voted,
        }));
        setTimeout(() => {
          try { ws.close(1008, 'State hash mismatch'); } catch {}
        }, 120);
      }
    });
  }

  session.game.agreedHash = winnerHash;
  session.game.startedAt = Date.now() + 1200;
  session.status = 'in_progress';
  const rt = ensureRuntime(session);
  rt.startedAt = session.game.startedAt;
  if (session.handshake.timer) {
    clearTimeout(session.handshake.timer);
    session.handshake.timer = null;
  }
  broadcastToSession(sessionId, {
    type: 'start_game',
    sessionId,
    seed: session.game.seed,
    waveCount: session.game.waveCount,
    bunkerLayoutId: typeof session.game.bunkerLayoutId === 'number' ? session.game.bunkerLayoutId : 0,
    playerCount: connectedPlayersForSession(sessionId).length,
    agreedHash: session.game.agreedHash,
    startAt: session.game.startedAt,
  });
}

function finalizeLossVote(sessionId, proposalId, byTimeout = false) {
  const session = sessions.get(sessionId);
  if (!session || !session.lossVote || session.lossVote.proposalId !== proposalId) return;
  const vote = session.lossVote;
  const connected = connectedPlayersForSession(sessionId);
  const allVoted = connected.every((pid) => vote.votes.has(pid));
  if (!allVoted && !byTimeout) return;
  const allAgree = connected.length > 0 && connected.every((pid) => vote.votes.get(pid) === true);

  if (allAgree) {
    session.status = 'ended';
    session.endedAt = Date.now();
    broadcastToSession(sessionId, {
      type: 'game_over_confirm',
      sessionId,
      proposalId,
      reason: vote.reason || 'window_breach',
      at: Date.now(),
      meta: vote.meta || {},
    });
  } else {
    broadcastToSession(sessionId, {
      type: 'game_over_canceled',
      sessionId,
      proposalId,
      reason: byTimeout ? 'timeout_or_disagree' : 'disagree',
      at: Date.now(),
    });
  }
  if (vote.timer) clearTimeout(vote.timer);
  session.lossVote = null;
}

function createSession(data = {}) {
  const sessionId = randomId('sess_');
  const joinCode = randomJoinCode();
  const privacy = data.privacy === 'public' ? 'public' : 'private';
  const maxPlayers = Math.max(2, Math.min(64, Number(data.maxPlayers) || 8));
  const botsFill = !!data.botsFill;
  const difficulty = ['normal', 'hard', 'nightmare'].includes(data.difficulty) ? data.difficulty : 'normal';
  const raw = data.bunkerLayoutId;
  const bunkerLayoutId = Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
  const hostName = sanitizeName(data.playerName || data.hostName);
  const hostPlayerId = randomId('p_');
  const session = {
    sessionId,
    joinCode,
    privacy,
    maxPlayers,
    botsFill,
    difficulty,
    status: 'open',
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    endedAt: 0,
    players: new Map([[hostPlayerId, { playerId: hostPlayerId, name: hostName, isHost: true, isBot: false }]]),
    game: {
      seed: (crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff) || 1,
      waveCount: 9,
      bunkerLayoutId,
      agreedHash: '',
      startedAt: 0,
    },
    handshake: {
      votes: new Map(), // playerId -> hash
      timer: null,
    },
    lossVote: null, // { proposalId, deadline, votes: Map<playerId,bool>, timer }
  };
  sessions.set(sessionId, session);
  ensurePlayerRuntimeState(session, session.players.get(hostPlayerId));
  return { session, hostPlayerId };
}

async function handleApi(req, res, urlObj) {
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return true;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, now: Date.now(), sessionCount: sessions.size });
    return true;
  }

  if (req.method === 'GET' && urlObj.pathname === '/api/sessions/public') {
    const list = Array.from(sessions.values())
      .filter((s) => s.status === 'open' && s.privacy === 'public' && (s.players.size < s.maxPlayers || countBots(s) > 0))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({
        sessionId: s.sessionId,
        playerCount: s.players.size,
        humanCount: countHumans(s),
        botCount: countBots(s),
        maxPlayers: s.maxPlayers,
        difficulty: s.difficulty,
        botsFill: s.botsFill,
        createdAt: s.createdAt,
      }));
    sendJson(res, 200, { sessions: list });
    return true;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/sessions/create') {
    if (isOverloadedForNewGame()) {
      sendJson(res, 503, { ok: false, error: overloadError() });
      return true;
    }
    const body = await readJsonBody(req);
    const { session, hostPlayerId } = createSession(body || {});
    ensureRuntime(session);
    sendJson(res, 200, {
      ok: true,
      ...sessionSnapshot(session, req),
      playerId: hostPlayerId,
    });
    return true;
  }

  if (req.method === 'POST' && urlObj.pathname === '/api/sessions/join') {
    if (isOverloadedForNewGame()) {
      sendJson(res, 503, { ok: false, error: overloadError() });
      return true;
    }
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const joinCode = String(body.joinCode || '').trim().toUpperCase();
    const session = sessionId ? sessions.get(sessionId) : getSessionByJoinCode(joinCode);
    if (!session) {
      sendJson(res, 404, { ok: false, error: 'Session not found' });
      return true;
    }
    if (session.status !== 'open') {
      sendJson(res, 409, { ok: false, error: 'Session not open' });
      return true;
    }
    if (session.players.size >= session.maxPlayers) {
      const removedBot = removeOneBotForHumanJoin(session);
      if (!removedBot) {
        sendJson(res, 409, { ok: false, error: 'Session is full' });
        return true;
      }
    }
    const playerId = randomId('p_');
    const player = { playerId, name: sanitizeName(body.playerName), isHost: false, isBot: false };
    session.players.set(playerId, player);
    const st = ensurePlayerRuntimeState(session, player);
    broadcastToSession(session.sessionId, {
      type: 'player_joined',
      sessionId: session.sessionId,
      player: { playerId: player.playerId, name: player.name, isHost: false, slotIndex: st.slotIndex ?? 0 },
    });
    sendJson(res, 200, {
      ok: true,
      ...sessionSnapshot(session, req),
      playerId,
    });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  try {
    const handled = await handleApi(req, res, urlObj);
    if (handled) return;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err?.message || 'Request failed' });
    return;
  }

  if (req.method === 'GET' && urlObj.pathname === '/') {
    setCors(res);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Please Shoot the Zombies server is running.\n');
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const urlObj = new URL(req.url || '/', `ws://${req.headers.host || `localhost:${PORT}`}`);
  const sessionId = urlObj.searchParams.get('sessionId') || '';
  const playerId = urlObj.searchParams.get('playerId') || '';
  const session = sessions.get(sessionId);
  const player = session?.players.get(playerId);
  if (!session || !player) {
    ws.close(1008, 'Invalid session/player');
    return;
  }

  ws.sessionId = sessionId;
  ws.playerId = playerId;
  const room = ensureSessionRoom(sessionId);
  room.add(ws);
  console.log(`[${nowIso()}] WS connected session=${sessionId} player=${playerId} (${req.socket.remoteAddress})`);

  ws.send(JSON.stringify({
    type: 'welcome',
    serverTime: Date.now(),
    session: {
      sessionId: session.sessionId,
      joinCode: session.joinCode,
      privacy: session.privacy,
      maxPlayers: session.maxPlayers,
      botsFill: session.botsFill,
      difficulty: session.difficulty,
      gameSeed: session.game.seed,
      waveCount: session.game.waveCount,
      bunkerLayoutId: typeof session.game.bunkerLayoutId === 'number' ? session.game.bunkerLayoutId : 0,
      playerCount: connectedPlayersForSession(sessionId).length,
      agreedHash: session.game.agreedHash || '',
      startedAt: session.game.startedAt || 0,
      players: Array.from(session.players.values()).map((p) => ({
        playerId: p.playerId,
        name: p.name,
        isHost: !!p.isHost,
        slotIndex: ensurePlayerRuntimeState(session, p).slotIndex ?? 0,
      })),
    },
    you: { playerId: player.playerId, name: player.name, isHost: !!player.isHost },
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      session.lastActivityAt = Date.now();
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      }
      if (msg.type === 'disconnect') {
        ws.close(1000, 'Client disconnect');
        return;
      }
      if (session.status === 'ended') return;
      if (msg.type === 'state_hash') {
        if (session.status !== 'starting') return;
        const hash = String(msg.hash || '').trim();
        if (!hash) return;
        session.handshake.votes.set(ws.playerId, hash);
        const connected = connectedPlayersForSession(sessionId);
        if (connected.length > 0 && connected.every((pid) => !!session.handshake.votes.get(pid))) {
          finalizeHandshake(sessionId);
        } else if (!session.handshake.timer) {
          session.handshake.timer = setTimeout(() => finalizeHandshake(sessionId), 4000);
        }
        return;
      }
      if (msg.type === 'start_match') {
        if (!player.isHost) return;
        if (session.status !== 'open') return;
        if (isOverloadedForNewGame()) {
          ws.send(JSON.stringify({ type: 'server_overloaded', error: overloadError(), at: Date.now() }));
          return;
        }
        session.status = 'starting';
        session.handshake.votes.clear();
        if (session.handshake.timer) {
          clearTimeout(session.handshake.timer);
          session.handshake.timer = null;
        }
        session.game.startedAt = 0;
        session.game.agreedHash = '';
        broadcastToSession(sessionId, {
          type: 'handshake_request',
          sessionId,
          seed: session.game.seed,
          waveCount: session.game.waveCount,
          bunkerLayoutId: typeof session.game.bunkerLayoutId === 'number' ? session.game.bunkerLayoutId : 0,
          playerCount: connectedPlayersForSession(sessionId).length,
          at: Date.now(),
        });
        return;
      }
      if (msg.type === 'game_over_proposal') {
        if (!session.lossVote) {
          const proposalId = randomId('loss_');
          const deadline = Date.now() + 1200;
          const votes = new Map([[ws.playerId, true]]);
          session.lossVote = {
            proposalId,
            deadline,
            votes,
            reason: String(msg.reason || 'window_breach'),
            meta: msg.meta || {},
            timer: setTimeout(() => finalizeLossVote(sessionId, proposalId, true), 1250),
          };
          broadcastToSession(sessionId, {
            type: 'game_over_vote_request',
            sessionId,
            proposalId,
            deadline,
            reason: session.lossVote.reason,
            meta: session.lossVote.meta,
          });
          finalizeLossVote(sessionId, proposalId, false);
        }
        return;
      }
      if (msg.type === 'game_over_vote') {
        if (!session.lossVote) return;
        if (msg.proposalId !== session.lossVote.proposalId) return;
        session.lossVote.votes.set(ws.playerId, !!msg.agree);
        finalizeLossVote(sessionId, session.lossVote.proposalId, false);
        return;
      }
      if (typeof msg.type === 'string' && msg.type.startsWith('player_')) {
        updateRuntimeFromHumanAction(session, ws.playerId, msg);
      }
      const envelope = {
        type: 'relay',
        sessionId,
        fromPlayerId: ws.playerId,
        payload: msg,
        ts: Date.now(),
      };
      broadcastToSession(sessionId, envelope, ws);
    } catch {
      // Ignore invalid payloads.
    }
  });

  ws.on('close', () => {
    room.delete(ws);
    const s = sessions.get(sessionId);
    if (!s) return;
    const left = s.players.get(playerId);
    s.players.delete(playerId);
    if (left) {
      broadcastToSession(sessionId, {
        type: 'player_left',
        sessionId,
        playerId,
      });
    }
    session.handshake.votes.delete(playerId);
    if (s.runtime) s.runtime.playerState.delete(playerId);
    if (s.lossVote) {
      s.lossVote.votes.delete(playerId);
      finalizeLossVote(sessionId, s.lossVote.proposalId, false);
    }
    if (s.players.size === 0 || countHumans(s) === 0) {
      closeAndRemoveSession(sessionId, 'No players');
      return;
    }
    const hasHost = Array.from(s.players.values()).some((p) => p.isHost);
    if (!hasHost) {
      let first = null;
      for (const p of s.players.values()) {
        if (!p.isBot) { first = p; break; }
      }
      if (!first) first = s.players.values().next().value;
      if (first) {
        first.isHost = true;
        broadcastToSession(sessionId, {
          type: 'host_changed',
          sessionId,
          playerId: first.playerId,
        });
      }
    }
  });

  ws.on('error', () => {
    // no-op
  });
});

setInterval(() => {
  const nowMs = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    const idleForMs = nowMs - (session.lastActivityAt || session.createdAt || nowMs);
    if (session.status === 'ended' && session.endedAt > 0 && (nowMs - session.endedAt) > SESSION_ENDED_GRACE_MS) {
      closeAndRemoveSession(sessionId, 'Game ended');
      continue;
    }
    const connected = connectedPlayersForSession(sessionId);
    const hasConnectedHuman = connected.some((pid) => {
      const p = session.players.get(pid);
      return !!p && !p.isBot;
    });
    const timeoutMs = (session.status === 'in_progress' && hasConnectedHuman)
      ? SESSION_IDLE_TIMEOUT_MS * 6
      : SESSION_IDLE_TIMEOUT_MS;
    if (idleForMs > timeoutMs) {
      closeAndRemoveSession(sessionId, 'Session timeout');
      continue;
    }
    if (session.status === 'ended') continue;
    maybeTrickleBots(session, nowMs);
    tickBotGameplay(session, nowMs);
  }
}, BOT_THINK_INTERVAL_MS);

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
