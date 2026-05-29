/**
 * Afnan Bot - WhatsApp Multi-Device Panel
 * Express + Socket.io + Baileys
 * Features: QR + Phone Pairing Code, Multi-Device, Device Logout, Auto-Owner
 */

// ─── Polyfill Web Crypto API ──────────────────────────────────────────────────
// In Node.js 18, bare `crypto` is undefined inside CommonJS module files even
// though globalThis.crypto exists in REPL mode. Baileys' Utils/crypto.js uses
// bare `crypto.subtle.importKey` — this polyfill must run before any require().
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

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
const BOT_DIR      = path.join(__dirname, 'bot');
const OWNER_FILE   = path.join(__dirname, 'bot', 'database', 'owner.json');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── Owner management ─────────────────────────────────────────────────────────
function loadOwnerData() {
  try {
    if (fs.existsSync(OWNER_FILE)) {
      return JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
    }
  } catch (_) {}
  return { owners: [] };
}

function saveOwnerData(data) {
  try {
    fs.writeFileSync(OWNER_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save owner data:', e.message);
  }
}

function registerOwner(phoneNumber) {
  const data = loadOwnerData();
  const normalized = phoneNumber.replace(/[^0-9]/g, '');
  if (!data.owners.includes(normalized)) {
    data.owners.push(normalized);
    saveOwnerData(data);
    console.log(`👑 New owner registered: ${normalized}`);
    // Also update config.js ownerNumber array dynamically
    try {
      const config = require('./bot/config');
      if (!config.ownerNumber.includes(normalized)) {
        config.ownerNumber.push(normalized);
      }
    } catch (_) {}
  }
}

// Patch config on startup to include persisted owners
function patchConfigOwners() {
  const data = loadOwnerData();
  if (data.owners.length === 0) return;
  try {
    const config = require('./bot/config');
    for (const num of data.owners) {
      if (!config.ownerNumber.includes(num)) {
        config.ownerNumber.push(num);
      }
    }
    console.log(`👑 Loaded ${data.owners.length} persisted owner(s)`);
  } catch (_) {}
}

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

// Replit keep-alive
app.get('/ping', (req, res) => res.send('pong'));

// REST: list active sessions
app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const [userId, data] of sessions.entries()) {
    list.push({
      userId,
      status:      data.status,
      phone:       data.phone       || null,
      connectedAt: data.connectedAt || null,
      isOwner:     data.isOwner     || false,
    });
  }
  res.json(list);
});

// REST: logout (disconnect without deleting files)
app.post('/api/sessions/:userId/logout', async (req, res) => {
  const { userId } = req.params;
  await destroySession(userId, false);
  res.json({ success: true });
});

// REST: delete session completely
app.delete('/api/sessions/:userId', async (req, res) => {
  const { userId } = req.params;
  await destroySession(userId, true);
  res.json({ success: true });
});

// ─── Session store ────────────────────────────────────────────────────────────
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

// ─── Load bot handler ─────────────────────────────────────────────────────────
let botHandler = null;
try {
  botHandler = require('./bot/handler');
  console.log('✅ Bot handler loaded — commands active for all sessions');
} catch (e) {
  console.warn('⚠️  Bot handler not found. Running as panel-only mode.', e.message);
}

// ─── Start / reconnect a WhatsApp session ─────────────────────────────────────
async function startSession(userId, pairingPhone = null, reconnectAttempt = 0) {
  const existing = sessions.get(userId);
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);
  if (existing?.sock) {
    try { await existing.sock.end(undefined); } catch (_) {}
  }

  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // ── If a phone number is given, wipe stale creds so we always get a fresh
  //    pairing flow (avoids creds.registered=true blocking pairing mode)
  if (pairingPhone) {
    const credsFile = path.join(dir, 'creds.json');
    if (fs.existsSync(credsFile)) {
      try { fs.unlinkSync(credsFile); } catch (_) {}
    }
  }

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

  // Always use pairing code mode when a phone number is given
  const usePairingCode = !!pairingPhone;

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

  sessions.set(userId, {
    ...(sessions.get(userId) || {}),
    sock,
    status: 'connecting',
    pairingPhone,
  });

  sock.ev.on('creds.update', saveCreds);

  const cleanPhone = pairingPhone ? pairingPhone.replace(/[^0-9]/g, '') : null;

  // ── Pairing code request flag (prevents double-request if qr fires twice) ──
  let pairingCodeRequested = false;

  // ── Connection updates ────────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (usePairingCode && !pairingCodeRequested) {
        // qr event = WA server noise handshake done = safe to request pairing code.
        // We do NOT pass usePairingCode to makeWASocket — that changes Baileys'
        // internal protocol flow and causes CB:failure (401) from WA server.
        // Instead we use the standard flow and call requestPairingCode on the qr event.
        pairingCodeRequested = true;
        try {
          emitToUser(userId, 'logs', `📲 Requesting pairing code for +${cleanPhone}...`);
          const code = await sock.requestPairingCode(cleanPhone);
          const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
          emitToUser(userId, 'pairing-code', formatted);
          emitToUser(userId, 'logs', `🔑 Pairing code: ${formatted} — enter it in WhatsApp within 60s`);
          setStatus(userId, 'pairing');
        } catch (e) {
          emitToUser(userId, 'logs', `❌ Pairing code error: ${e.message}`);
          emitToUser(userId, 'logs', `💡 Check the number format (e.g. 94123456789) and try again`);
        }
      } else if (!usePairingCode) {
        // QR mode — show scannable QR code
        try {
          const qrDataUrl = await qrcode.toDataURL(qr, { margin: 2, width: 300, color: { dark: '#000000', light: '#ffffff' } });
          setStatus(userId, 'qr');
          emitToUser(userId, 'qr', qrDataUrl);
          emitToUser(userId, 'logs', '📱 QR code ready — scan with WhatsApp');
        } catch (e) {
          emitToUser(userId, 'logs', `❌ QR generation failed: ${e.message}`);
        }
      }
    }

    if (connection === 'open') {
      const rawId = sock.user?.id || '';
      const phone = rawId.split(':')[0].split('@')[0] || 'unknown';
      const connectedAt = new Date().toISOString();

      let isOwner = false;
      if (pairingPhone || phone !== 'unknown') {
        const ownerPhone = (pairingPhone || phone).replace(/[^0-9]/g, '');
        registerOwner(ownerPhone);
        isOwner = true;
      }

      setStatus(userId, 'connected', { phone, connectedAt, isOwner });
      emitToUser(userId, 'logs', `✅ Connected! WhatsApp: +${phone}${isOwner ? ' 👑 (Owner registered)' : ''}`);

      if (botHandler) {
        sock.ev.on('messages.upsert', ({ messages, type }) => {
          if (type !== 'notify') return;
          for (const msg of messages) {
            if (!msg.message || !msg.key?.id) continue;
            if (!msg.key.remoteJid) continue;
            botHandler.handleMessage(sock, msg).catch(() => {});
          }
        });

        sock.ev.on('group-participants.update', async (upd) => {
          await botHandler.handleGroupUpdate(sock, upd).catch(() => {});
        });

        botHandler.initializeAntiCall?.(sock);
        emitToUser(userId, 'logs', '🤖 Afnan Bot commands active');
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut  = statusCode === DisconnectReason.loggedOut;
      const reason     = lastDisconnect?.error?.message || `code ${statusCode}`;

      console.log(`[${userId}] closed — ${reason} (attempt ${reconnectAttempt})`);
      emitToUser(userId, 'logs', `⚠️  Connection closed: ${reason}`);

      // Only treat as "logged out" if the session was previously connected (has creds).
      // During pairing, a 401/CB:failure just means auth didn't complete — don't delete.
      const wasConnected = sessions.get(userId)?.phone;
      if (loggedOut && wasConnected) {
        emitToUser(userId, 'logs', '🚪 Logged out — session deleted, please reconnect');
        await destroySession(userId, true);
      } else if (pairingPhone || loggedOut) {
        // Pairing session (or failed auth attempt) — let user retry manually
        setStatus(userId, 'disconnected');
        emitToUser(userId, 'logs', '🔁 Click Connect to try again');
      } else if (reconnectAttempt < 5) {
        // Auto-restore sessions: retry up to 5 times then give up
        setStatus(userId, 'reconnecting');
        emitToUser(userId, 'logs', `🔄 Reconnecting in 5 seconds... (${reconnectAttempt + 1}/5)`);
        const timer = setTimeout(() => startSession(userId, null, reconnectAttempt + 1), 5000);
        const s = sessions.get(userId) || {};
        s.reconnectTimer = timer;
        sessions.set(userId, s);
      } else {
        emitToUser(userId, 'logs', '❌ Could not restore session — please re-pair from the panel');
        await destroySession(userId, true);
      }
    }
  });

  sock.ev.on('error', (err) => {
    const code = err?.output?.statusCode;
    console.log(`[${userId}] socket error code=${code}: ${err.message}`);
    if (![515, 503, 408].includes(code)) {
      emitToUser(userId, 'logs', `⚠️  Socket error: ${err.message || err}`);
    }
  });

  return sock;
}

// ─── Auto-restore sessions ────────────────────────────────────────────────────
async function autoRestoreSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  if (dirs.length === 0) return;
  console.log(`🔄 Auto-restoring ${dirs.length} session(s): ${dirs.join(', ')}`);
  for (const userId of dirs) {
    const creds = path.join(SESSIONS_DIR, userId, 'creds.json');
    if (fs.existsSync(creds)) {
      sessions.set(userId, { status: 'restoring' });
      await startSession(userId).catch(e =>
        console.error(`[${userId}] Auto-restore failed:`, e.message)
      );
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// ─── Socket.io connection handler ────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🌐 Browser connected: ${socket.id}`);

  socket.on('join', (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    const s = sessions.get(userId);
    if (s) {
      socket.emit('status', { status: s.status, phone: s.phone, connectedAt: s.connectedAt, isOwner: s.isOwner });
    }
  });

  // Start session with QR
  socket.on('start-session', async (userId) => {
    if (!userId || typeof userId !== 'string') return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safe) return;
    socket.join(`user:${safe}`);
    const existing = sessions.get(safe);
    if (existing?.status === 'connected') {
      socket.emit('status', { status: 'connected', phone: existing.phone });
      socket.emit('logs', '✅ Already connected!');
      return;
    }
    await startSession(safe, null);
  });

  // Start session with pairing code
  socket.on('start-pairing', async ({ userId, phone }) => {
    if (!userId || !phone) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!safe || !cleanPhone) return;
    socket.join(`user:${safe}`);
    const existing = sessions.get(safe);
    if (existing?.status === 'connected') {
      socket.emit('status', { status: 'connected', phone: existing.phone });
      socket.emit('logs', '✅ Already connected!');
      return;
    }
    // Block duplicate starts — prevent double requestPairingCode if socket reconnects mid-flow
    if (existing?.status === 'connecting' || existing?.status === 'pairing') {
      socket.emit('logs', '⏳ Already connecting, please wait...');
      return;
    }
    await startSession(safe, cleanPhone);
  });

  // Logout (disconnect, keep session files for reconnect)
  socket.on('logout-session', async (userId) => {
    if (!userId) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    await destroySession(safe, false);
    socket.emit('logs', '🔌 Device logged out');
    io.emit('sessions-updated');
  });

  // Delete session completely
  socket.on('delete-session', async (userId) => {
    if (!userId) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    await destroySession(safe, true);
    socket.emit('logs', '🗑️ Session deleted');
    io.emit('sessions-updated');
  });

  socket.on('disconnect', () => {
    console.log(`🌐 Browser disconnected: ${socket.id}`);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🤖 Afnan Bot Panel running at http://0.0.0.0:${PORT}`);
  console.log(`📁 Sessions folder: ${SESSIONS_DIR}`);
  console.log(`🤖 Bot integration: ${botHandler ? 'enabled' : 'disabled (panel-only mode)'}\n`);
  patchConfigOwners();
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
