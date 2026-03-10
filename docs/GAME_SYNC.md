# Game sync (lightweight, deterministic)

Game state is kept in sync with **minimal data**: shared parameters, a seed, a plan hash, and discrete player actions. The heavy traffic is **proximity voice**, not game updates.

## What gets transmitted (game channel)

- **One-time per match**
  - **Game parameters** — Rules, constants (e.g. zombie HP, damage, spawn limits).
  - **Initial random seed** — So all clients generate the same world (zombie spawn times, paths, etc.) from the same RNG.
  - **Hash of the game plan** — Bunker shape, zombie spawn times and paths, tree locations, etc. Clients can verify they’re on the same “map” without sending the full plan; full plan can be distributed out-of-band or from a single authoritative source.

- **Ongoing (discrete actions only)**
  - **Movement** — Player moved to slot X at time T.
  - **Shots** — What was damaged/killed, where the shot happened, direction (and any needed hit info).
  - **Boards nailed up** — Which window, when.

No continuous position streams: **actions only**. With the same seed and plan, clients (and server) can simulate the same deterministic world and only need to broadcast these discrete events.

## Bandwidth split

- **Game data** — Very lightweight (parameters, seed, plan hash once; then small action messages).
- **Proximity voice** — Main data through the cloud. Precomputed slot relationships (same / adjacent-or-back-to-back / distant) drive who gets full, partial, or no audio. See [Proximity voice](PROXIMITY_VOICE.md).
