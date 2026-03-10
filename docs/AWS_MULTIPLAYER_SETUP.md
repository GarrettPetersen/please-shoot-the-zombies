# Connecting Please Shoot the Zombies to AWS (Free Tier)

This guide walks you through using a new AWS Free Tier account to run a game server so the Electron client can connect for multiplayer.

---

## 1. Log in and choose a region

1. Go to [AWS Console](https://console.aws.amazon.com/) and sign in.
2. In the top-right, open the **region** dropdown (e.g. "N. Virginia").
3. Pick a region close to you (e.g. **us-east-1**, **us-west-2**, **eu-west-1**). You’ll create all resources in this region.

Free Tier applies per region; one small instance is well within the 750 hours/month limit.

---

## 2. Create an EC2 key pair (for SSH)

1. In the console search bar, type **EC2** and open **EC2**.
2. In the left sidebar, under **Network & Security**, click **Key Pairs**.
3. Click **Create key pair**.
   - **Name:** e.g. `please-shoot-the-zombies`
   - **Key pair type:** RSA
   - **Private key format:** .pem (for SSH on Mac/Linux) or .ppk (for PuTTY on Windows)
4. Click **Create key pair**. A file will download — **store it somewhere safe** and never commit it to git. You need it to SSH into the server.

---

## 3. Launch an EC2 instance

1. In the EC2 sidebar, click **Instances** → **Launch instance**.
2. **Name:** e.g. `game-server`.
3. **AMI:** leave **Amazon Linux 2023** (or pick **Ubuntu 22.04** if you prefer).
4. **Instance type:** **t2.micro** (Free tier eligible). t3.micro is also free-tier eligible.
5. **Key pair:** Select the key pair you created (e.g. `please-shoot-the-zombies`).
6. **Network settings** → **Edit**:
   - **Create security group** (or use an existing one).
   - **Security group name:** e.g. `game-server-sg`.
   - **Inbound rules:**  
     - **SSH:** Type = SSH, Port = 22, Source = **My IP** (so only you can SSH).  
     - **Game server:** Add rule → Custom TCP, Port = **3000**, Source = **0.0.0.0/0** (so game clients can connect).  
       - For testing you can use **My IP** first, then open to 0.0.0.0/0 when you’re ready for others.
7. **Storage:** 8 GB is enough and within free tier.
8. Click **Launch instance**.

---

## 4. Get the server’s public address

1. In **Instances**, select your instance.
2. Copy the **Public IPv4 address** (or **Public IPv4 DNS**). You’ll use this to SSH and to configure the game client (e.g. `GAME_SERVER_URL=ws://<this-ip>:3000`).

---

## 5. Connect with SSH and install Node.js

**Linux / macOS (terminal):**

```bash
# Fix key permissions (required for SSH)
chmod 400 /path/to/please-shoot-the-zombies.pem

# Replace with your instance's public IP and key path
ssh -i /path/to/please-shoot-the-zombies.pem ec2-user@<PUBLIC_IP>
```

- For **Amazon Linux**, the user is usually `ec2-user`.
- For **Ubuntu**, the user is usually `ubuntu`:  
  `ssh -i /path/to/key.pem ubuntu@<PUBLIC_IP>`

**Install Node.js (Amazon Linux 2023):**

```bash
sudo dnf install -y nodejs
node -v   # should show v18 or similar
```

**Install Node.js (Ubuntu):**

```bash
sudo apt update
sudo apt install -y nodejs npm
# Or for a newer Node version:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

---

## 6. Run the game server on the instance

**Option A — Copy server files to the instance**

From your **local** machine (in the project root):

```bash
scp -i /path/to/please-shoot-the-zombies.pem -r server/* ec2-user@<PUBLIC_IP>:~/game-server/
```

Then on the **EC2** instance:

```bash
cd ~/game-server
npm install
node index.js
```

**Option B — Clone the repo on the instance** (if the project is in a git repo)

On the **EC2** instance:

```bash
git clone <your-repo-url> please-shoot-the-zombies
cd please-shoot-the-zombies/server
npm install
node index.js
```

The server will listen on port **3000**. Leave this terminal open, or run it in the background (e.g. `nohup node index.js &` or use a process manager like `pm2`).

---

## 7. Test that the server is reachable

- From your **local** machine, open a browser or a WebSocket test page and connect to:  
  `ws://<PUBLIC_IP>:3000`  
  You should see a connection (and the server may log the connection).
- If it fails, check:
  - Security group allows **inbound TCP 3000** from your IP or 0.0.0.0/0.
  - The server process is running on the EC2 instance (`node index.js`).

---

## 8. Point the game client at the server

When you add networking to the Electron client:

- Set the WebSocket URL from the server’s public address, e.g.  
  `ws://<PUBLIC_IP>:3000`  
  or, after you add a domain and HTTPS,  
  `wss://your-domain.com`
- Use an environment variable or config (e.g. `GAME_SERVER_URL`) so you can switch between local (`ws://localhost:3000`) and AWS (`ws://<PUBLIC_IP>:3000`) without code changes.

---

## 9. Keep the server running (optional)

- **Simple:** run in background with `nohup node index.js &` and log to a file.
- **Better:** install **pm2** and run `pm2 start index.js` so the process restarts on crash and survives some reboots.
- **Security:** keep the key pair (.pem) private, use **My IP** for SSH in the security group if possible, and only open port 3000 to 0.0.0.0/0 when you need other players to connect.

---

## 10. Will this scale?

**Short answer:** The single-EC2 setup is fine for **early development and tens of players**. It will **not** scale to many concurrent games or hundreds of players without changes.

| Phase | What you have | Rough limit |
|-------|----------------|-------------|
| **Now** | One t2.micro, one Node process, in-memory clients | Tens of concurrent connections; one full match (e.g. 64 players) is possible but may stress CPU/RAM. |
| **More players / multiple matches** | Same single instance | Becomes CPU- or memory-bound; no redundancy. |

**To scale when you have a bunch of players:**

1. **Single match, 64 players**  
   - Prefer a **larger instance** (e.g. t3.small) and keep one game server process per match.  
   - Optimize: batch broadcasts, limit message rate, keep payloads small.

2. **Many concurrent matches (e.g. hundreds of players)**  
   - **One game server process (or instance) per match/session.**  
   - Add a **matchmaking / lobby** service (e.g. API on API Gateway + Lambda, or a small always-on service) that:  
     - Creates or assigns a game server (e.g. ECS task or EC2), and  
     - Returns the WebSocket URL for that match so clients connect to the right place.  
   - Optionally **ECS** (or ECS + Fargate): run the same Node server in a container, scale tasks by number of active matches.

3. **Shared state across instances**  
   - If you need cross-match or global state, add **Redis** (ElastiCache) or similar; the current server is in-memory only.

So: start with this single EC2 for cost and simplicity; when you need more capacity or reliability, move to “one server per match” plus a matchmaking layer and, if needed, ECS/containers.

**Is this setup scalable? Yes.** More players means more concurrent matches. Each match runs on one game server (one process or container). So you scale by **adding more servers**: one new match → one new game server (or one host running many match processes). You don't try to put everyone on one machine. Matchmaking assigns players to a match and gives them that match's WebSocket URL. Game data is lightweight (seed + plan hash + actions); the main load is proximity voice, which is per match, so each additional server carries one match's voice traffic. Add more servers as you get more players.

---

## 11. Connect and deploy from another machine

From a different computer (e.g. second laptop), you need the **PEM key** and the **server public IP**. Full steps: **[Deploy to game server (DEPLOY.md)](DEPLOY.md)**. Summary:

- **SSH:** `chmod 400 <path-to-pem>` then `ssh -i <path-to-pem> ec2-user@<PUBLIC_IP>`
- **Push code:** `scp -i <path-to-pem> -r server/* ec2-user@<PUBLIC_IP>:~/game-server/`
- **Restart server (remote):** `cd ~/game-server && npm install && pkill -f 'node index' || true && nohup node index.js > server.log 2>&1 &`

Get the public IP from AWS Console → EC2 → Instances → your instance. If you stop/start the instance, the IP can change unless you use an Elastic IP.

---

## Summary checklist

- [ ] AWS account created, region chosen.
- [ ] EC2 key pair created and .pem file saved securely.
- [ ] EC2 instance launched (t2.micro, Amazon Linux or Ubuntu).
- [ ] Security group: SSH (22) from your IP, TCP 3000 for game server.
- [ ] SSH works with `ssh -i key.pem ec2-user@<IP>`.
- [ ] Node.js installed on the instance.
- [ ] `server/` copied or cloned, `npm install` and `node index.js` run.
- [ ] Client can connect to `ws://<PUBLIC_IP>:3000`.
- [ ] Game client configured with this URL (env or config) for multiplayer.

Once this works, you can add game logic (rooms, state sync, etc.) to the server and wire the Electron client to it.
