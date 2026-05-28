# WhatsApp Multi-User Bot Panel

A web-based panel where multiple users can connect their WhatsApp accounts via QR code. Each user gets an independent bot session with auto-reconnect and session persistence.

---

## Project Structure

```
whatsapp-panel/
├── index.js          ← Panel server (Express + Socket.io + Baileys)
├── package.json
├── public/
│   └── index.html    ← Web dashboard
├── sessions/         ← Auto-created, one folder per user
│   ├── alice/
│   ├── john/
│   └── ...
└── bot/              ← Paste your bot files here (optional)
    ├── handler.js
    ├── config.js
    ├── database.js
    ├── commands/
    └── utils/
```

---

## Deploy on Replit

### Step 1 — Create the Replit project
1. Go to [replit.com](https://replit.com) → **Create Repl**
2. Choose **Node.js** template
3. Name it `whatsapp-panel`

### Step 2 — Upload files
Upload these files into the Replit editor:
- `index.js`
- `package.json`
- `public/index.html`

### Step 3 — Add your bot (optional but recommended)
Create a `bot/` folder in Replit and paste your existing bot files:
- `bot/handler.js`
- `bot/config.js`
- `bot/database.js`
- `bot/commands/` (full folder)
- `bot/utils/` (full folder)
- `bot/database/` (JSON files)

> The panel auto-detects the bot folder. If found, every connected session runs your full bot commands automatically.

### Step 4 — Install dependencies
In the Replit Shell:
```bash
npm install
```

### Step 5 — Run
Click the **Run** button or in Shell:
```bash
node index.js
```

The panel opens at your Replit URL (shown in the browser preview).

---

## Keep Alive on Replit (Free Tier)

Replit free projects sleep after inactivity. Use **UptimeRobot** (free) to ping your project every 5 minutes:

1. Go to [uptimerobot.com](https://uptimerobot.com) → Add New Monitor
2. Monitor type: **HTTP(s)**
3. URL: `https://your-repl-name.your-username.repl.co/ping`
4. Interval: **5 minutes**

This keeps your panel (and all connected bots) online 24/7.

> **Replit Hacker/Pro plan**: Use "Always On" toggle instead — no UptimeRobot needed.

---

## How It Works

1. Open the panel URL in your browser
2. Enter a **User ID** (any name, e.g. `alice`, `john`, `mybot`)
3. Click **Connect WhatsApp**
4. Scan the QR code with WhatsApp → Linked Devices → Link a Device
5. Session is saved in `sessions/alice/`
6. Bot stays connected and auto-reconnects if dropped

### Multiple Users
Each user needs a different User ID. All sessions run independently and simultaneously.

---

## Features
- ✅ Multi-user WhatsApp sessions (unlimited)
- ✅ Real-time QR display in browser
- ✅ Session persistence — survives server restarts
- ✅ Auto-reconnect on disconnect
- ✅ Auto-restores all saved sessions on startup
- ✅ Full bot command integration (your existing commands work)
- ✅ Live log console in dashboard
- ✅ Delete / disconnect sessions from UI
- ✅ Replit-compatible (keep-alive `/ping` endpoint)

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ping` | Keep-alive endpoint for UptimeRobot |
| GET | `/api/sessions` | List all sessions and their status |
| DELETE | `/api/sessions/:userId` | Delete a session |

---

## Troubleshooting

**QR not showing**: Check that `qrcode` and `socket.io` are installed (`npm install`).

**Bot commands not working**: Make sure your `bot/` folder is in the right place and `bot/handler.js` exports `handleMessage`, `handleGroupUpdate`, and `initializeAntiCall`.

**Session keeps disconnecting**: WhatsApp limits linked devices. Make sure you're not exceeding 4 linked devices per number.

**Replit sleeping**: Set up UptimeRobot as described above.
