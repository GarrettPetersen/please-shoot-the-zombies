# Game server

Minimal WebSocket server for **Please Shoot the Zombies** multiplayer. Run this on an EC2 instance (see [AWS setup](../docs/AWS_MULTIPLAYER_SETUP.md)).

## Run locally

```bash
cd server
npm install
npm start
```

Listens on `ws://localhost:3000` (or `PORT` env var).

## Protocol (minimal)

- **Server → client:** `{ type: 'welcome', serverTime }` on connect; `{ type: 'pong', ts }` in response to ping.
- **Client → server:** Any JSON. `{ type: 'ping' }` gets a pong; other messages are broadcast to all other connected clients.

Game-specific messages (join, state, actions) can be added later; the client will need to connect to `ws://<EC2_PUBLIC_IP>:3000` (or `wss://...` with TLS).
