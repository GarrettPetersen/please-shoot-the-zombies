# Please Shoot the Zombies

A retro pixel art multiplayer shooter: defend a bunker against wave after wave of zombies.

## Concept

- **Shooting gallery gameplay** — You defend a series of windows. You can move between windows but don’t have free movement.
- **Scale** — Up to 64 players in one game, defending 96 windows.
- **Tech** — Vanilla JS, bundled as a desktop app with Electron. Game servers on AWS ECS. Proximity-based voice chat (precomputed slot relationships: same = full volume, adjacent/back-to-back = partial, distant = none; see [Proximity voice](docs/PROXIMITY_VOICE.md)). Game sync is lightweight (seed + plan hash + discrete actions); see [Game sync](docs/GAME_SYNC.md). Proximity audio is the main data through the cloud.

## Project structure

```
├── assets/           # Sprites and art (Lee Enfield, zombies, etc.)
├── docs/             # Design: AWS, proximity voice, game sync, deploy, multiplayer spec (MULTIPLAYER_SPEC.md)
├── server/           # WebSocket game server (run on EC2)
├── src/              # Game client (canvas, input, game loop)
├── main.js           # Electron main process
├── index.html        # Game canvas + entry
└── package.json
```

## Run locally

```bash
npm install
npm start
```

## Roadmap

- [x] Scaffolding, single-window shooting gallery (no networking)
- [ ] Multiple windows, move between them
- [ ] Networking + AWS ECS game servers
- [ ] Proximity voice chat
- [ ] 64 players × 96 windows scale

Full multiplayer plan (Steam matchmaking & voice, handshake, relayed messages, player history, bots): [MULTIPLAYER_SPEC.md](docs/MULTIPLAYER_SPEC.md).

## Assets

- **Lee Enfield** — Two sprite sheets: fire-only loop, and fire + reload loop. First frame is “ready to fire.”
- **Zombies** — German zombie sprites (front/back for window positioning).
