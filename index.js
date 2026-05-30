/**
 * Afnan Bot - WhatsApp Multi-Device Panel
 * Express + Socket.io + Baileys
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

// ─── Owner management ─────────────────────────────────────────────────────────
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

// ─── Express + Socket.io ──────────────────────────────────────────────────────
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
    list.push({
      userId,
      status: data.status,
      phone: data.phone || null,
      connectedAt: data.connectedAt || null,
      isOwner: data.isOwner || false,
    });
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

// ─── Start Session ────────────────────────────────────────────────────────────
async function startSession(userId, pairingPhone = null, reconnectAttempt = 0) {
  const existing = sessions.get(userId);
  if (existing?.reconnectTimer) clearTimeout(existing.reconnectTimer);
  if (existing?.sock) {
    try { await existing.sock.end(undefined); } catch (_) {}
  }

  const dir = sessionDir(userId);

  // ── FIX 1: Wipe the entire session folder BEFORE useMultiFileAuthState ──────
  // The old code deleted files AFTER useMultiFileAuthState already read them,
  // and it had a logic bug (deleted everything except creds.json, then creds.json
  // still had stale data). Correct approach: wipe the whole folder first, then
  // let useMultiFileAuthState create a clean fresh state.
  if (pairingPhone) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

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
    console.log(`[${userId}] WA version: ${version.join('.')}`);
  } catch (_) {
    version = [2, 3000, 1015901307];
  }

  const logger = pino({ level: 'silent' });
  const cleanPhone = pairingPhone ? pairingPhone.replace(/[^0-9]/g, '') : null;

  // ── FIX 2: Do NOT pass usePairingCode to makeWASocket ──────────────────────
  // `usePairingCode` is NOT a valid Baileys option — it is silently ignored.
  // Baileys ALWAYS starts a QR handshake internally at the WebSocket level.
  // If you then call requestPairingCode() mid-QR-flow = "couldn't link device".
  //
  // The CORRECT approach: let the QR event fire (it will), just don't show it
  // to the user. Intercept the `qr` event, and instead of displaying it,
  // call requestPairingCode() at that exact moment — because the qr event
  // fires right when the WS connection is ready and WhatsApp is listening.
  // That is the precise window when requestPairingCode() works correctly.

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    browser: ['Afnan Bot', 'Chrome', '120.0.0.0'],
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    syncFullHistory:     false,
    downloadHistory:     false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: '' }),
  });

  sessions.set(userId, {
    ...(sessions.get(userId) || {}),
    sock,
    status: 'connecting',
    pairingPhone,
  });

  sock.ev.on('creds.update', saveCreds);

  let pairingCodeRequested = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (pairingPhone && !pairingCodeRequested) {
        // ── FIX 3: Call requestPairingCode() on the qr event ─────────────────
        // This is the correct trigger. The `qr` event means the WebSocket
        // is fully open and WhatsApp's server is ready and listening.
        // This is the ONLY safe window to call requestPairingCode().
        // Do NOT use a setTimeout — the timing window can be missed.
        pairingCodeRequested = true;
        try {
          emitToUser(userId, 'logs', `📲 Requesting pairing code for +${cleanPhone}...`);
          const code = await sock.requestPairingCode(cleanPhone);
          const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
          emitToUser(userId, 'pairing-code', formatted);
          emitToUser(userId, 'logs', `🔑 Your pairing code: ${formatted}`);
          emitToUser(userId, 'logs', `📱 WhatsApp → Linked Devices → Link a Device → Link with phone number → enter code`);
          setStatus(userId, 'pairing');
        } catch (e) {
          pairingCodeRequested = false;
          emitToUser(userId, 'logs', `❌ Pairing code error: ${e.message}`);
          emitToUser(userId, 'logs', `💡 Check number format (e.g. 919876543210) and click Connect again`);
          setStatus(userId, 'disconnected');
        }
      } else if (!pairingPhone) {
        // QR mode — show QR to user
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
    }

    if (connection === 'open') {
      const rawId = sock.user?.id || '';
      const phone = rawId.split(':')[0].split('@')[0] || 'unknown';
      const connectedAt = new Date().toISOString();

      const ownerPhone = (pairingPhone || phone).replace(/[^0-9]/g, '');
      if (ownerPhone) registerOwner(ownerPhone);

      setStatus(userId, 'connected', { phone, connectedAt, isOwner: true });
      emitToUser(userId, 'logs', `✅ Connected! WhatsApp: +${phone} 👑 (Owner)`);

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
