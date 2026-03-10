/**
 * Minimal WebSocket game server for Please Shoot the Zombies.
 * Run on EC2: npm install && node index.js
 * Clients connect to ws://<EC2_PUBLIC_IP>:3000
 */

const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Please Shoot the Zombies game server — connect via WebSocket.\n');
});

const wss = new WebSocketServer({ server });

const clients = new Set();

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress;
  clients.add(ws);
  console.log(`[${new Date().toISOString()}] Client connected (${addr}), total: ${clients.size}`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        return;
      }
      // Broadcast to all other clients (for future game state / actions)
      clients.forEach((client) => {
        if (client !== ws && client.readyState === 1) {
          client.send(raw.toString());
        }
      });
    } catch {
      // Non-JSON or invalid: ignore or broadcast as-is
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[${new Date().toISOString()}] Client disconnected, total: ${clients.size}`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });

  // Send welcome so client knows connection is live
  ws.send(JSON.stringify({ type: 'welcome', serverTime: Date.now() }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game server listening on ws://0.0.0.0:${PORT}`);
});
