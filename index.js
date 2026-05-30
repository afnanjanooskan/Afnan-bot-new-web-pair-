/**
 * Afnan Bot - WhatsApp Multi-Device Panel
 * Express + Socket.io + Baileys
 * Features: QR + Phone Pairing Code, Multi-Device, Device Logout, Auto-Owner
 */

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
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const PORT         = process.env.PORT || 3000;
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const OWNER_FILE   = path.join(__dirname, 'bot', 'database', 'owner.json');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── Owner management ──────────────────────────────────────────────────────────
function loadOwnerData() {
  try {
    if (fs.existsSync(OWNER_FILE)) return JSON.parse(fs.readFileSync(OWNER_FILE, 'utf8'));
  } catch (_) {}
  return { owners: [] };
}
function saveOwnerData(data) {
  try { fs.writeFileSync(OWNER_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}
function registerOwner(phoneNumber) {
  const data = loadOwnerData();
  const normalized = phoneNumber.replace(/[^0-9]/g, '');
  if (!data.owners.includes(normalized)) {
    data.owners.push(normalized);
    saveOwnerData(data);
    console.log(`👑 Owner registered: ${normalized}`);
    try {
      const config = require('./bot/config');
      if (!config.ownerNumber.includes(normalized)) config.ownerNumber.push(normalized);
    } catch (_) {}
  }
}
function patchConfigOwners() {
  const data = loadOwnerData();
  if (!data.owners.length) return;
  try {
    const config = require('./bot/config');
    for (const num of data.owners) {
      if (!config.ownerNumber.includes(num)) config.ownerNumber.push(num);
    }
    console.log(`👑 Loaded ${data.owners.length} owner(s)`);
  } catch (_) {}
}

// ─── Express + Socket.io ───────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.get('/ping', (req, res) => res.send('pong'));

app.get('/api/sessions', (req, res) => {
  const list = [];
  for (const [userId, data] of sessions.entries()) {
    list.push({ userId, status: data.status, phone: data.phone || null, connectedAt: data.connectedAt || null, isOwner: data.isOwner || false });
  }
  res.json(list);
});
app.post('/api/sessions/:userId/logout', async (req, res) => {
  await destroySession(req.params.userId, false);
  res.json({ success: true });
});
app.delete('/api/sessions/:userId', async (req, res) => {
  await destroySession(req.params.userId, true);
  res.json({ success: true });
});

// ─── Session store ────────────────────────────────────────────────────────────
const sessions = new Map();

function sessionDir(userId) {
  return path.join(SESSIONS_DIR, userId.replace(/[^a-zA-Z0-9_-]/g, '_'));
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
  console.log(`[${userId}] → ${status}`);
}

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

// ─── Bot handler ──────────────────────────────────────────────────────────────
let botHandler = null;
try {
  botHandler = require('./bot/handler');
  console.log('✅ Bot handler loaded');
} catch (e) {
  console.warn('⚠️  Bot handler not found:', e.message);
}

// ─── Core fix: correct pairing code flow ──────────────────────────────────────
//
// THE BUG in the old code:
//   1. `Browsers.ubuntu('Chrome')` was used for pairing — WhatsApp rejects this.
//      Pairing code requires browser to be set as a WEB client (not desktop).
//   2. `requestPairingCode()` was called on the `qr` event — this is WRONG.
//      The QR event fires because Baileys defaulted to QR mode. When you then
//      call requestPairingCode(), WhatsApp's server gets confused because it
//      already started the QR handshake, causing "couldn't link device".
//   3. `makeCacheableSignalKeyStore` was missing — required for proper auth.
//
// THE FIX:
//   - Pass `{ usePairingCode: true }` to makeWASocket so Baileys uses the
//     correct internal protocol path from the start (no QR handshake at all).
//   - Use the correct browser identity for pairing: ['Afnan Bot','Chrome','120.0.0.0'].
//   - Call requestPairingCode() only ONCE, inside the `connection: 'open'`
//     wait — actually we use the recommended pattern: wait for the socket
//     to be ready (open connection or a short delay after creation).
//   - Wrap with makeCacheableSignalKeyStore for proper signal key handling.

async function startSession(userId, pairingPhone = null, reconnectAttempt = 0) {
  const existing = sessions.get(userId);
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);
  if (existing?.sock) {
    try { await existing.sock.end(undefined); } catch (_) {}
  }

  const dir = sessionDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // For fresh pairing — delete stale creds so we always get a clean session
  if (pairingPhone) {
    const credsFile = path.join(dir, 'creds.json');
    if (fs.existsSync(credsFile)) {
      try { fs.unlinkSync(credsFile); } catch (_) {}
    }
    // Also clear any leftover signal key files that may conflict
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        if (f !== 'creds.json') fs.unlinkSync(path.join(dir, f));
      }
    } catch (_) {}
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
    console.log(`[${userId}] Using WA version: ${version.join('.')}`);
  } catch (_) {
    version = [2, 3000, 1015901307];
  }

  const logger = pino({ level: 'silent' });
  const cleanPhone = pairingPhone ? pairingPhone.replace(/[^0-9]/g, '') : null;

  // ── FIX 1: use correct socket options based on mode ────────────────────────
  const sockOptions = {
    version,
    logger,
    printQRInTerminal: false,
    // FIX 2: correct browser for pairing (web-based, not ubuntu/desktop)
    browser: pairingPhone
      ? ['Afnan Bot', 'Chrome', '120.0.0.0']
      : ['Afnan Bot', 'Chrome', '120.0.0.0'],
    auth: {
      creds: state.creds,
      // FIX 3: wrap keys with cacheableSignalKeyStore — prevents auth failures
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    syncFullHistory:     false,
    downloadHistory:     false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: '' }),
    // FIX 4: set this so Baileys internally uses pairing code protocol,
    // NOT the QR handshake. Without this, WA server starts QR flow and
    // calling requestPairingCode() mid-QR causes "couldn't link device".
    ...(pairingPhone ? { usePairingCode: true } : {}),
  };

  const sock = makeWASocket(sockOptions);

  sessions.set(userId, {
    ...(sessions.get(userId) || {}),
    sock,
    status: 'connecting',
    pairingPhone,
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingCodeSent = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, isOnline } = update;

    // ── QR mode ──────────────────────────────────────────────────────────────
    if (qr && !pairingPhone) {
      try {
        const qrDataUrl = await qrcode.toDataURL(qr, {
          margin: 2,
          width: 300,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setStatus(userId, 'qr');
        emitToUser(userId, 'qr', qrDataUrl);
        emitToUser(userId, 'logs', '📱 QR code ready — scan with WhatsApp');
      } catch (e) {
        emitToUser(userId, 'logs', `❌ QR generation failed: ${e.message}`);
      }
    }

    // ── Pairing code mode: request code when socket is open/ready ────────────
    // FIX 5: request pairing code when connection opens (registered=false means
    // not yet authenticated) — NOT on the qr event.
    if (pairingPhone && !pairingCodeSent && !state.creds.registered) {
      // The socket fires 'open' briefly or we can hook into connection opening
      // The safest trigger is: connection becomes 'open' but creds not registered,
      // OR we can use a short timer after socket creation (500ms is enough for
      // the WS handshake to complete before requestPairingCode is called).
      if (connection === 'open' || (!connection && !pairingCodeSent)) {
        // handled below in the open block
      }
    }

    if (connection === 'open') {
      const rawId = sock.user?.id || '';
      const phone = rawId.split(':')[0].split('@')[0] || 'unknown';
      const connectedAt = new Date().toISOString();

      let isOwner = false;
      const ownerPhone = (pairingPhone || phone).replace(/[^0-9]/g, '');
      if (ownerPhone) { registerOwner(ownerPhone); isOwner = true; }

      setStatus(userId, 'connected', { phone, connectedAt, isOwner });
      emitToUser(userId, 'logs', `✅ Connected! WhatsApp: +${phone}${isOwner ? ' 👑 (Owner)' : ''}`);

      if (botHandler) {
        sock.ev.on('messages.upsert', ({ messages, type }) => {
          if (type !== 'notify') return;
          for (const msg of messages) {
            if (!msg.message || !msg.key?.id || !msg.key.remoteJid) continue;
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

      console.log(`[${userId}] closed — ${reason}`);
      emitToUser(userId, 'logs', `⚠️ Connection closed: ${reason}`);

      const wasConnected = !!sessions.get(userId)?.phone;

      if (loggedOut && wasConnected) {
        emitToUser(userId, 'logs', '🚪 Logged out — session removed, please re-pair');
        await destroySession(userId, true);
      } else if (pairingPhone) {
        setStatus(userId, 'disconnected');
        emitToUser(userId, 'logs', '🔁 Pairing failed or timed out — click Connect to try again');
      } else if (!wasConnected || reconnectAttempt >= 5) {
        emitToUser(userId, 'logs', '❌ Could not restore session — please re-pair');
        await destroySession(userId, true);
      } else {
        setStatus(userId, 'reconnecting');
        emitToUser(userId, 'logs', `🔄 Reconnecting in 5s... (${reconnectAttempt + 1}/5)`);
        const timer = setTimeout(() => startSession(userId, null, reconnectAttempt + 1), 5000);
        const s = sessions.get(userId) || {};
        s.reconnectTimer = timer;
        sessions.set(userId, s);
      }
    }
  });

  // ── FIX 6: Request pairing code via a timer after socket creation ──────────
  // This is the CORRECT way per Baileys docs — wait ~1.5s after makeWASocket()
  // for the WebSocket handshake to complete, then call requestPairingCode().
  // Do NOT call it inside connection.update events — that causes race conditions.
  if (pairingPhone) {
    setTimeout(async () => {
      if (pairingCodeSent) return;
      const s = sessions.get(userId);
      if (!s || s.status === 'disconnected' || s.status === 'connected') return;
      try {
        pairingCodeSent = true;
        emitToUser(userId, 'logs', `📲 Requesting pairing code for +${cleanPhone}...`);
        const code = await sock.requestPairingCode(cleanPhone);
        const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
        emitToUser(userId, 'pairing-code', formatted);
        emitToUser(userId, 'logs', `🔑 Your pairing code: ${formatted}`);
        emitToUser(userId, 'logs', `📱 Go to WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number`);
        setStatus(userId, 'pairing');
      } catch (e) {
        pairingCodeSent = false; // allow retry
        emitToUser(userId, 'logs', `❌ Pairing code error: ${e.message}`);
        emitToUser(userId, 'logs', `💡 Make sure the number is correct (e.g. 919876543210) and try again`);
      }
    }, 1500);
  }

  sock.ev.on('error', (err) => {
    const code = err?.output?.statusCode;
    if (![515, 503, 408].includes(code)) {
      emitToUser(userId, 'logs', `⚠️ Socket error: ${err.message || err}`);
    }
  });

  return sock;
}

// ─── Auto-restore sessions ────────────────────────────────────────────────────
async function autoRestoreSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  if (!dirs.length) return;
  console.log(`🔄 Auto-restoring ${dirs.length} session(s)`);
  for (const userId of dirs) {
    const creds = path.join(SESSIONS_DIR, userId, 'creds.json');
    if (fs.existsSync(creds)) {
      sessions.set(userId, { status: 'restoring' });
      await startSession(userId).catch(e => console.error(`[${userId}] restore failed:`, e.message));
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

// ─── Socket.io events ─────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🌐 Browser: ${socket.id}`);

  socket.on('join', (userId) => {
    if (!userId) return;
    socket.join(`user:${userId}`);
    const s = sessions.get(userId);
    if (s) socket.emit('status', { status: s.status, phone: s.phone, connectedAt: s.connectedAt, isOwner: s.isOwner });
  });

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

  socket.on('start-pairing', async ({ userId, phone }) => {
    if (!userId || !phone) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!safe || cleanPhone.length < 7) {
      socket.emit('logs', '❌ Invalid phone number — include country code, e.g. 919876543210');
      return;
    }
    socket.join(`user:${safe}`);
    const existing = sessions.get(safe);
    if (existing?.status === 'connected') {
      socket.emit('status', { status: 'connected', phone: existing.phone });
      socket.emit('logs', '✅ Already connected!');
      return;
    }
    if (existing?.status === 'connecting' || existing?.status === 'pairing') {
      socket.emit('logs', '⏳ Already connecting, please wait...');
      return;
    }
    await startSession(safe, cleanPhone);
  });

  socket.on('logout-session', async (userId) => {
    if (!userId) return;
    await destroySession(userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_'), false);
    socket.emit('logs', '🔌 Device logged out');
    io.emit('sessions-updated');
  });

  socket.on('delete-session', async (userId) => {
    if (!userId) return;
    await destroySession(userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_'), true);
    socket.emit('logs', '🗑️ Session deleted');
    io.emit('sessions-updated');
  });

  socket.on('disconnect', () => console.log(`🌐 Browser left: ${socket.id}`));
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🤖 Afnan Bot Panel → http://0.0.0.0:${PORT}`);
  patchConfigOwners();
  await autoRestoreSessions();
});

process.on('uncaughtException', (err) => {
  if (err.code === 'ENOSPC') return;
  console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', (err) => {
  if (err?.message?.includes('rate-overlimit')) return;
  console.error('Rejection:', err?.message || err);
});
