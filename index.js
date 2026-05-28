/**
 * WhatsApp Multi-User Bot Panel
 * Express + Socket.io + Baileys
 * Replit-compatible: binds to 0.0.0.0, keeps alive via UptimeRobot ping
 */

process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const fs         = require('fs');
const pino       = require('pino');
const qrcode     = require('qrcode');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const BOT_DIR      = path.join(__dirname, 'bot');  // your existing bot folder

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── Express + Socket.io setup ────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Replit keep-alive ping endpoint
app.get('/ping', (req, res) => res.send('pong'));

// REST: list active sessions
app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const [userId, data] of sessions.entries()) {
    list.push({
      userId,
      status:    data.status,
      phone:     data.phone  || null,
      connectedAt: data.connectedAt || null,
    });
  }
  res.json(list);
});

// REST: delete / logout a session
app.delete('/api/sessions/:userId', async (req, res) => {
  const { userId } = req.params;
  await destroySession(userId, true);
  res.json({ success: true });
});

// ─── Session store ────────────────────────────────────────────────────────────
// Map<userId, { sock, status, phone, connectedAt, reconnectTimer }>
const sessions = new Map();

function sessionDir(userId) {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(SESSIONS_DIR, safe);
}

function emitToUser(userId, event, data) {
  io.to(`user:${userId}`).emit(event, data);
}

function setStatus(userId, status, extra = {}) {
  const s = sessions.get(userId) || {};
  s.status = status;
  Object.assign(s, extra);
  sessions.set(userId, s);
  emitToUser(userId, 'status', { status, ...extra });
  console.log(`[${userId}] status → ${status}`);
}

// ─── Destroy / cleanup session ────────────────────────────────────────────────
async function destroySession(userId, deleteFiles = false) {
  const s = sessions.get(userId);
  if (s) {
    clearTimeout(s.reconnectTimer);
    try { await s.sock?.end(undefined); } catch (_) {}
    sessions.delete(userId);
  }
  if (deleteFiles) {
    const dir = sessionDir(userId);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  setStatus(userId, 'disconnected');
}

// ─── Load bot command handler (optional — attach to each session) ─────────────
let botHandler = null;
try {
  botHandler = require('./bot/handler');
  console.log('✅ Bot handler loaded — commands active for all sessions');
} catch (e) {
  console.warn('⚠️  Bot handler not found. Running as QR/session panel only.');
}

// ─── Start / reconnect a WhatsApp session ────────────────────────────────────
async function startSession(userId) {
  // Cancel any existing reconnect timer
  const existing = sessions.get(userId);
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);

  // Close existing socket if any
  if (existing?.sock) {
    try { await existing.sock.end(undefined); } catch (_) {}
  }

  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  setStatus(userId, 'connecting');

  let state, saveCreds;
  try {
    ({ state, saveCreds } = await useMultiFileAuthState(dir));
  } catch (e) {
    setStatus(userId, 'error');
    emitToUser(userId, 'logs', `❌ Auth state error: ${e.message}`);
    return;
  }

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch (_) {
    version = [2, 3000, 1015901307];
  }

  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: state,
    syncFullHistory:     false,
    downloadHistory:     false,
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  // Store reference immediately
  sessions.set(userId, {
    ...(sessions.get(userId) || {}),
    sock,
    status: 'connecting',
  });

  // ── Credentials ──────────────────────────────────────────────────────────
  sock.ev.on('creds.update', saveCreds);

  // ── Connection updates ───────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // QR generated — convert to data URL and send to browser
    if (qr) {
      try {
        const qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 280 });
        setStatus(userId, 'qr');
        emitToUser(userId, 'qr', qrDataUrl);
        emitToUser(userId, 'logs', '📱 QR code ready — scan with WhatsApp');
      } catch (e) {
        emitToUser(userId, 'logs', `❌ QR generation failed: ${e.message}`);
      }
    }

    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] || sock.user?.id || 'unknown';
      const connectedAt = new Date().toISOString();
      setStatus(userId, 'connected', { phone, connectedAt });
      emitToUser(userId, 'logs', `✅ Connected! WhatsApp number: ${phone}`);

      // Attach bot handler if available
      if (botHandler) {
        sock.ev.on('messages.upsert', ({ messages, type }) => {
          if (type !== 'notify') return;
          for (const msg of messages) {
            if (!msg.message || !msg.key?.id) continue;
            const from = msg.key.remoteJid;
            if (!from) continue;
            botHandler.handleMessage(sock, msg).catch(() => {});
          }
        });

        sock.ev.on('group-participants.update', async (update) => {
          await botHandler.handleGroupUpdate(sock, update).catch(() => {});
        });

        botHandler.initializeAntiCall?.(sock);
        emitToUser(userId, 'logs', '🤖 Bot commands active');
      }
    }

    if (connection === 'close') {
      const statusCode  = lastDisconnect?.error?.output?.statusCode;
      const loggedOut   = statusCode === DisconnectReason.loggedOut;
      const reason      = lastDisconnect?.error?.message || `code ${statusCode}`;

      emitToUser(userId, 'logs', `⚠️  Connection closed (${reason})`);

      if (loggedOut) {
        // Logged out — clear session files, require re-scan
        emitToUser(userId, 'logs', '🚪 Logged out — please reconnect and scan QR again');
        await destroySession(userId, true);
      } else {
        // Temporary disconnect — auto reconnect after 5s
        setStatus(userId, 'reconnecting');
        emitToUser(userId, 'logs', '🔄 Reconnecting in 5 seconds...');
        const timer = setTimeout(() => startSession(userId), 5000);
        const s = sessions.get(userId) || {};
        s.reconnectTimer = timer;
        sessions.set(userId, s);
      }
    }
  });

  // ── Socket error ─────────────────────────────────────────────────────────
  sock.ev.on('error', (err) => {
    const code = err?.output?.statusCode;
    if (![515, 503, 408].includes(code)) {
      emitToUser(userId, 'logs', `⚠️  Socket error: ${err.message || err}`);
    }
  });

  return sock;
}

// ─── Auto-restore sessions on server start ───────────────────────────────────
async function autoRestoreSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);

  if (dirs.length === 0) return;
  console.log(`🔄 Auto-restoring ${dirs.length} session(s): ${dirs.join(', ')}`);

  for (const userId of dirs) {
    // Only restore if creds.json exists (i.e. was previously connected)
    const creds = path.join(SESSIONS_DIR, userId, 'creds.json');
    if (fs.existsSync(creds)) {
      sessions.set(userId, { status: 'restoring' });
      await startSession(userId).catch(e =>
        console.error(`[${userId}] Auto-restore failed:`, e.message)
      );
      // Small delay between restores to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// ─── Socket.io connection handler ────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🌐 Browser connected: ${socket.id}`);

  // Browser joins a room for a specific user
  socket.on('join', (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    console.log(`[${userId}] Browser joined room`);

    // Send current status immediately if session exists
    const s = sessions.get(userId);
    if (s) {
      socket.emit('status', { status: s.status, phone: s.phone, connectedAt: s.connectedAt });
    }
  });

  // Start a new session
  socket.on('start-session', async (userId) => {
    if (!userId || typeof userId !== 'string') return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safe) return;

    console.log(`[${safe}] start-session request`);
    socket.join(`user:${safe}`);

    const existing = sessions.get(safe);
    if (existing?.status === 'connected') {
      socket.emit('status', { status: 'connected', phone: existing.phone });
      socket.emit('logs', '✅ Already connected!');
      return;
    }

    await startSession(safe);
  });

  // Disconnect a session
  socket.on('disconnect-session', async (userId) => {
    if (!userId) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`[${safe}] disconnect-session request`);
    await destroySession(safe, false);
    socket.emit('logs', '🔌 Session disconnected');
  });

  // Delete a session completely
  socket.on('delete-session', async (userId) => {
    if (!userId) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    console.log(`[${safe}] delete-session request`);
    await destroySession(safe, true);
    socket.emit('logs', '🗑️ Session deleted');
  });

  socket.on('disconnect', () => {
    console.log(`🌐 Browser disconnected: ${socket.id}`);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 WhatsApp Panel running at http://0.0.0.0:${PORT}`);
  console.log(`📁 Sessions folder: ${SESSIONS_DIR}`);
  console.log(`🤖 Bot integration: ${botHandler ? 'enabled' : 'disabled (panel-only mode)'}\n`);
  await autoRestoreSessions();
});

process.on('uncaughtException', (err) => {
  if (err.code === 'ENOSPC') { console.warn('⚠️  Disk full'); return; }
  console.error('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (err) => {
  if (err?.message?.includes('rate-overlimit')) return;
  console.error('Unhandled Rejection:', err?.message || err);
});
