# Please Shoot the Zombies

A retro pixel art multiplayer shooter: defend a bunker against wave after wave of zombies.

## Concept

- **Shooting gallery gameplay** — You defend a series of windows. You can move between windows but don’t have free movement.
- **Scale** — Up to 64 players in one game, defending 96 windows.
- **Tech** — Vanilla JS, bundled as a desktop app with Electron. Game servers on AWS ECS. Proximity-based voice chat. Minimal server payload per client to keep costs low.

## Project structure

```
├── assets/           # Sprites and art (Lee Enfield, zombies, etc.)
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

## Assets

- **Lee Enfield** — Two sprite sheets: fire-only loop, and fire + reload loop. First frame is “ready to fire.”
- **Zombies** — German zombie sprites (front/back for window positioning).
