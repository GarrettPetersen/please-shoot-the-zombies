# Proximity voice chat (design)

Voice is **proximity-based** and uses **precomputed relationships** between windows, based on **distance and walls between** slots. We precompute **at the start of each game** (once the bunker layout exists). Game data stays minimal; **proximity audio is the main data** transmitted through the cloud.

## Precomputed at game start (distance + walls)

We **precompute** once, right after the bunker and slots are generated:

1. **Distance** — For each pair of slots (A, B), compute world distance between their positions.
2. **Walls between** — Use the same line-of-sight logic as movement: if the straight line between slot A and slot B at camera height hits an opaque wall, treat them as blocked.

Then assign volume:

| Condition | Voice level |
|-----------|-------------|
| **Same slot** (A = B) | **Full volume** (1.0) |
| **Different slots, path blocked by wall** | **No audio** (0) |
| **Different slots, path clear, distance ≤ threshold** | **Partial volume** (0.5) |
| **Different slots, path clear, distance > threshold** | **No audio** (0) |

So: **same window = full volume**; **distant or wall between = no audio**; **close and no wall between (adjacent or back-to-back) = partial volume**.

The threshold for "close enough" for partial volume is in world units (e.g. a multiple of `bunkerTileWorldWidth`). In code this is `VOICE_PARTIAL_MAX_DISTANCE_MULTIPLIER`; the matrix is `slotVoiceVolumeMatrix[i][j]` and the getter is `getSlotVoiceVolume(slotIndexA, slotIndexB)`.

**Minimum volume:** Any volume below `VOICE_MIN_VOLUME_THRESHOLD` (e.g. 0.2) is stored and returned as 0, so the network is not used for barely audible audio. Only values at or above the threshold are sent.

## What the game server exposes for voice

- Each player's **current slot** (updated on movement).
- The **precomputed volume matrix** from game start (distance + walls-between). No need to recompute during the match.

The voice path (SFU, relay, or P2P) then:

- **Full volume** — Only for same-slot peers.
- **Partial volume** — For peers in a different slot but with clear path and within distance threshold.
- **No audio** — For all other pairs.

Game data stays tiny (see [Game sync](GAME_SYNC.md)); proximity audio is the main data transmitted through the cloud.
