# Multiplayer & server spec

High-level plan for matchmaking, game flow, state sync, voice, and bots.

---

## 1. Matchmaking (Steam API)

- Steam API for lobbies; **we draw the player list in our game** (Steam members + server bot slots in one list, no labels). Client connects to our game server with session/lobby ID. Server knows human vs bot slots. "Start match" from Steam or our logic → server sends parameters, clients begin handshake.

---

## 2. Audio (Steam API)

- Steam voice for chat. Proximity from `slotVoiceVolumeMatrix` (same = full, adjacent/back-to-back = partial, distant = none); client or server tells who is in range and at what gain. Bots excluded from voice.

---

## 3. Start a game with parameters

- When a match starts, the server (or host) sends **game parameters** to all clients, e.g.:
  - **Initial random seed** (for world gen: zombie spawns, paths, trees, etc.)
  - **Game plan identifier or hash** (bunker layout, spawn tables, etc.) so everyone uses the same "map"
  - Any rules (e.g. difficulty, time limit)
- All clients and the server use these parameters to generate the same deterministic world. No need to send full world state—only the seed and plan reference.

---

## 4. Initial handshake (agree on game state hash)

- Before the game starts, all players must **agree on the initial game state** so no one is on a different map or RNG.
- **Flow:**
  1. Server sends **game parameters** (seed, plan id/hash, etc.) to all clients.
  2. Each client (and server) **generates the full initial game state** locally (bunker, zombie spawn schedule, tree positions, etc.) using the same deterministic logic.
  3. Each client (and server) **hashes** that initial state (e.g. SHA-256 of a canonical serialization) and sends the hash to the server.
  4. Server collects hashes from all clients; if **all match**, server broadcasts "handshake OK, start at time T." If any mismatch, server rejects (e.g. "client X has wrong hash") and can resend parameters or abort.
- Ensures everyone is in sync before any gameplay messages are processed. No play until handshake OK.

---

## 5. Messages relayed between players

- After handshake, the server **relays discrete game events** so all clients stay in sync. Each client runs the same deterministic sim and applies the same events.
- **Examples:**
  - **Movement:** `Player A moved from slot 0 to slot 1` (at time T or tick N).
  - **Shot:** `Player B shot zombie Y at pixel (12, 36), killing it` (and optionally: damage dealt, hole position, etc.).
  - **Boards:** `Player C nailed a board at window W.`
- Messages are **authoritative**: server validates (or is the source of truth) and broadcasts to all clients. Clients apply events in order so their sim state stays identical.
- Format can be minimal: e.g. `{ type: 'move', playerId, fromSlot, toSlot, time }`, `{ type: 'shot', playerId, zombieId, sx, sy, killed, time }`, etc. See [Game sync](GAME_SYNC.md).

---

## 6. Record stuff about players (game history)

- **Server** (or a separate service) records **per-player** and **per-match** data, e.g.:
  - **Game history:** matches played, result (win/loss, score), duration, who else was in the match.
  - **Stats:** kills, deaths (if applicable), shots hit, boards placed, etc.
  - **Aggregates:** total games, win rate, favorite slots, etc.
- Storage can be DB (e.g. RDS, DynamoDB) or simple logs later processed. Needs to be designed so it does not block the game loop (e.g. write async after match end).
- Used for: leaderboards, profile, anti-cheat signals, and "recent games" / history views.

---

## 7. Bots on the server

- Server-side bots: same event types as players (move, shot, boards), no voice. Server runs a bot controller, broadcasts bot actions like player actions. Clients treat them identically; **no `isBot` flag or label**—player list is our UI (Steam members + server slots merged), bots get plausible names from a pool.
- **Trickle in:** Bots join open matches gradually (not all at once) so lobbies fill. When a human joins, a bot can leave to free the slot; humans have priority.

---

## 8. Server architecture

- One EC2 can run matchmaking + game server(s). Add more EC2s (or Lambda for matchmaking) when scaling.

---

## Summary table

| Area | Approach |
|------|----------|
| Matchmaking | Steam API; we draw list (Steam + bot slots merged) |
| Audio | Steam voice + proximity (slot matrix); bots excluded |
| Game start | Parameters (seed, plan id/hash) from server |
| Handshake | All generate state, hash, agree before play |
| In-game sync | Relayed messages (move, shot, boards); deterministic sim |
| Player records | Server records history/stats per player and match |
| Bots | Server-run; same events, no voice; unlabeled; trickle in; yield to humans |

---

## Dependencies and order

- **Steamworks SDK** integration in the Electron client (and possibly server for lobby/matchmaking callbacks if needed).
- **Game server** already has WebSocket; extend it with: game parameters, handshake (collect/compare hashes), message relay (move, shot, boards), and bot loop.
- **Proximity** and **slot volume matrix** are already designed; wire them to "who can hear whom" for Steam voice.
- **Player records** need a store (DB or logs) and a clear "match end" event to write history.

This doc can be updated as you implement each piece.
