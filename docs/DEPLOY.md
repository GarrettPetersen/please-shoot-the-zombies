# Deploy to game server (from any machine)

Use this when you're on **another machine** (e.g. second laptop) and want to connect to the EC2 game server and push code updates. You need the **PEM key** and the **server IP**.

---

## What you need

- **PEM key** — Copy `credentials/please-shoot-the-zombies.pem` to this machine (e.g. into the project's `credentials/` folder, or `~/.ssh/`). Do not commit it.
- **Server IP** — The EC2 instance's **Public IPv4 address**. If you don't have it: AWS Console → EC2 → Instances → select your instance → copy **Public IPv4 address**.  
  *(If you stop/start the instance, this IP can change unless you use an Elastic IP.)*

Replace `<PUBLIC_IP>` and `<PATH_TO_PEM>` in the commands below with your values (e.g. `100.52.203.69` and `credentials/please-shoot-the-zombies.pem`).

---

## 1. Connect via SSH

From the **project root** (or wherever the PEM is):

```bash
chmod 400 <PATH_TO_PEM>
ssh -i <PATH_TO_PEM> ec2-user@<PUBLIC_IP>
```

Example:

```bash
chmod 400 credentials/please-shoot-the-zombies.pem
ssh -i credentials/please-shoot-the-zombies.pem ec2-user@100.52.203.69
```

You should see the EC2 prompt (`ec2-user@ip-...`). For Amazon Linux the user is `ec2-user`; for Ubuntu it's `ubuntu`.

---

## 2. Deploy code updates (push new server code)

From your **local machine**, in the **project root** (where the `server/` folder is):

**Step A — Copy server files to EC2**

```bash
scp -i <PATH_TO_PEM> -r server/* ec2-user@<PUBLIC_IP>:~/game-server/
```

Example:

```bash
scp -i credentials/please-shoot-the-zombies.pem -r server/* ec2-user@100.52.203.69:~/game-server/
```

**Step B — On the server: install deps (if needed) and restart**

SSH in (see above), then:

```bash
cd ~/game-server
npm install
pkill -f 'node index'   # stop current server
nohup node index.js > server.log 2>&1 &
```

Or do it in one shot from your **local** machine (no need to stay SSH'd):

```bash
ssh -i <PATH_TO_PEM> ec2-user@<PUBLIC_IP> "cd ~/game-server && npm install && pkill -f 'node index' || true && nohup node index.js > server.log 2>&1 &"
```

Example:

```bash
ssh -i credentials/please-shoot-the-zombies.pem ec2-user@100.52.203.69 "cd ~/game-server && npm install && pkill -f 'node index' || true && nohup node index.js > server.log 2>&1 &"
```

---

## 3. Useful one-liners (from project root)

| Task | Command |
|------|---------|
| **Deploy and restart** | `scp -i credentials/please-shoot-the-zombies.pem -r server/* ec2-user@<PUBLIC_IP>:~/game-server/` then `ssh -i credentials/please-shoot-the-zombies.pem ec2-user@<PUBLIC_IP> "cd ~/game-server && npm install && pkill -f 'node index' || true && nohup node index.js > server.log 2>&1 &"` |
| **View server log** | `ssh -i credentials/please-shoot-the-zombies.pem ec2-user@<PUBLIC_IP> "tail -50 ~/game-server/server.log"` |
| **Is server running?** | `ssh -i credentials/please-shoot-the-zombies.pem ec2-user@<PUBLIC_IP> "pgrep -f 'node index' && echo running"` |
| **Stop server** | `ssh -i credentials/please-shoot-the-zombies.pem ec2-user@<PUBLIC_IP> "pkill -f 'node index'"` |
| **Start server** | `ssh -i credentials/please-shoot-the-zombies.pem ec2-user@<PUBLIC_IP> "cd ~/game-server && nohup node index.js > server.log 2>&1 &"` |

Replace `<PUBLIC_IP>` with your instance's public IP (e.g. `100.52.203.69`).

---

## 4. Game client WebSocket URL

Point the game client at:

```
ws://<PUBLIC_IP>:3000
```

(e.g. `ws://100.52.203.69:3000`). Ensure the EC2 security group allows **inbound TCP 3000** from 0.0.0.0/0 (or your test IP).
