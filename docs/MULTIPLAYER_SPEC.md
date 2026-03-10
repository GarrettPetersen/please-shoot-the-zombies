# Multiplayer & server spec

High-level plan for matchmaking, game flow, state sync, voice, and bots.

---

## 1. Matchmaking (Steam API)

- Use **Steam** for matchmaking via the **Steam API**: players find or create games via Steam lobbies. Our game calls the API to get lobby members, match state, etc. The **display is in our game**—we draw the lobby list, "players in match", and so on ourselves. So we can show a **unified list**: real Steam accounts (from the API) plus **bot slots** (from our server) in the same UI, with no visual distinction. Bots appear alongside real accounts in the list; we never label them.
- Flow: player opens game → Steam API → find or create lobby → get lobby members → game client connects to our **game server** for that match, with session/lobby ID. Server knows which slots are humans (Steam) and which are bots (server-filled). Server may receive "start match" from Steam (e.g. lobby full, host pressed start) or our own logic; then it starts the game with parameters and tells clients to begin the handshake.

---

## 2. Audio (Steam API)

- Use **Steam voice** for in-game chat (Steamworks voice APIs).
- Our **proximity rules** (same window = full volume, adjacent/back-to-back = partial, distant = none) can be enforced by:
  - **Option A:** Game client tells Steam which peers are "in range" (from our precomputed `slotVoiceVolumeMatrix`); we only enable/route Steam voice for those peers.
  - **Option B:** Server subscribes to player slot updates and tells each client "you hear players X, Y, Z at gains Gx, Gy, Gz" and the client uses Steam voice with volume/gain per peer.
- Bots (see below) do not send or receive voice.

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
- Storage can be DB (e.g. RDS, DynamoDB) or simple logs later processed. Needs to be designed so it doesn’t block the game loop (e.g. write async after match end).
- Used for: leaderboards, profile, anti-cheat signals, and "recent games" / history views.

---

## 7. Bots on the server

- **Server-side bots** that behave like players but don’t use voice:
  - Occupy slots, move between windows, shoot zombies (using the same deterministic sim and event format).
  - Server generates **bot actions** (move, shoot) and broadcasts them like player events so all clients see the same bot behavior.
  - Bots do **not** send or receive voice; they’re excluded from Steam voice and from any proximity voice list.
- **Purpose:** Fill lobbies when there aren’t many humans online so the match feels populated.
- **Implementation:** Server has a "bot controller" that, each tick or on a timer, decides bot moves and shots (e.g. simple AI: target nearest zombie, move toward busy windows) and emits the same message types as players. Clients treat bot events like player events for rendering and sim.

**Unlabeled so the game feels lively:** Bots are not in Steam (only humans use Steam matchmaking). The **player list is rendered by our game** from Steam API (real accounts) + server (all slots, including bots); we merge them into one list so bots appear with real accounts and nobody is labeled. The server never sends an `isBot` flag; bots use the same message types and slot representation as humans. Only the server knows which slots are bots (no handshake from them, excluded from Steam voice, server generates their actions). Assign bot slots plausible names from a pool (no "Bot_1" or "CPU").

**Trickle in (and make room for humans):** Bots **gradually join** open matches over time—they don't all appear at once. So players waiting in a lobby see the list fill up (some real joins, some bot joins), and nobody sits in an empty or near-empty match for long. When a **human joins** via Steam matchmaking, the server can have a bot **leave** (free that slot for the human) so the match doesn't overfill and it looks natural: someone left, someone new joined. Priority: humans get slots; bots fill gaps and trickle in when there's room, and yield when a human is available to take the slot.

---

## Summary table

| Area | Approach |
|------|----------|
| Matchmaking | Steam API; display in our game (merge Steam members + bot slots in one list) |
| Audio | Steam voice + our proximity rules (slot matrix) |
| Game start | Parameters (seed, plan id/hash) from server |
| Handshake | All clients + server generate state, hash it, agree on hash before play |
| In-game sync | Relayed messages (move, shot, boards, etc.); deterministic sim on all clients |
| Player records | Server (or backend) records game history, stats per player/match |
| Bots | Server-run; trickle into open matches over time; yield slot when human joins; same events as players, no voice; never labeled; plausible names; list merged with real accounts in our UI |

---

## Dependencies and order

- **Steamworks SDK** integration in the Electron client (and possibly server for lobby/matchmaking callbacks if needed).
- **Game server** already has WebSocket; extend it with: game parameters, handshake (collect/compare hashes), message relay (move, shot, boards), and bot loop.
- **Proximity** and **slot volume matrix** are already designed; wire them to "who can hear whom" for Steam voice.
- **Player records** need a store (DB or logs) and a clear "match end" event to write history.

This doc can be updated as you implement each piece.
