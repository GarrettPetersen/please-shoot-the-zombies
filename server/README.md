# Game server

Matchmaking + roomed WebSocket server for **Please Shoot the Zombies** multiplayer. Run this on EC2 (see [AWS setup](../docs/AWS_MULTIPLAYER_SETUP.md)).

## Run locally

```bash
cd server
npm install
npm start
```

Listens on `http://localhost:3000` (or `PORT` env var).

## Matchmaking API

- `GET /api/health` -> basic health info
- `GET /api/sessions/public` -> list open public sessions
- `POST /api/sessions/create` -> create session
  - body: `{ privacy, maxPlayers, botsFill, difficulty, playerName }`
  - returns: `{ sessionId, joinCode, playerId, wsUrl, ... }`
- `POST /api/sessions/join` -> join by `sessionId` or `joinCode`
  - body: `{ sessionId?, joinCode?, playerName }`
  - returns: `{ sessionId, joinCode, playerId, wsUrl, ... }`

## Built-in bots

- In open lobbies with `botsFill: true`, bots trickle in over time to keep rooms lively.
- If a human joins and the lobby is full, a bot leaves to make room.
- During matches, bots send normal player-style actions (`player_move`, `player_shot`, `player_board_*`, `player_ammo_pickup`) with realistic delays/reload rules.

## WebSocket protocol

- Connect to `ws://<host>:3000/ws?sessionId=<id>&playerId=<id>`.
- Server sends `welcome` on connect and `pong` for `{ type: 'ping' }`.
- Other messages are relayed to other players in the same session as:
  - `{ type: 'relay', sessionId, fromPlayerId, payload, ts }`
- Server also emits `player_joined`, `player_left`, and `host_changed` events.

Set `PUBLIC_HTTP_URL` / `PUBLIC_WS_URL` env vars if you need to override returned public URLs.
