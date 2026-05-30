/**
 * Afnan Bot - WhatsApp Multi-Device Panel
 * Express + Socket.io + Baileys
 *
 * ROOT CAUSE FIX:
 * requestPairingCode() MUST be called immediately after makeWASocket(),
 * before the Node.js event loop processes any WebSocket messages.
 * Calling it inside the 'qr' event handler is TOO LATE — by then, WhatsApp's
 * server has already committed to the QR handshake flow (sent pair-device,
 * received iq result from Baileys). Sending link_code_companion_reg after
 * that creates a conflicting state on WhatsApp's server → "couldn't link device".
 *
 * Official Baileys docs pattern (the ONLY correct way):
 *   const sock = makeWASocket({ printQRInTerminal: false })
 *   if (!sock.authState.creds.registered) {
 *     const code = await sock.requestPairingCode(number)
 *   }
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
    console.log('Owner registered: ' + normalized);
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
    console.log('Loaded ' + data.owners.length + ' owner(s)');
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
      status:      data.status,
      phone:       data.phone       || null,
      connectedAt: data.connectedAt || null,
      isOwner:     data.isOwner     || false,
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
  io.to('user:' + userId).emit(event, data);
}
function setStatus(userId, status, extra) {
  extra = extra || {};
  const s = sessions.get(userId) || {};
  s.status = status;
  Object.assign(s, extra);
  sessions.set(userId, s);
  emitToUser(userId, 'status', Object.assign({ status: status }, extra));
  console.log('[' + userId + '] -> ' + status);
}

async function destroySession(userId, deleteFiles) {
  const s = sessions.get(userId);
  if (s) {
    clearTimeout(s.reconnectTimer);
    try { if (s.sock) await s.sock.end(undefined); } catch (_) {}
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
  console.log('Bot handler loaded');
} catch (e) {
  console.warn('Bot handler not found: ' + e.message);
}

// ─── Start Session ────────────────────────────────────────────────────────────
async function startSession(userId, pairingPhone, reconnectAttempt) {
  pairingPhone = pairingPhone || null;
  reconnectAttempt = reconnectAttempt || 0;

  const existing = sessions.get(userId);
  if (existing && existing.reconnectTimer) clearTimeout(existing.reconnectTimer);
  if (existing && existing.sock) {
    try { await existing.sock.end(undefined); } catch (_) {}
  }

  const dir = sessionDir(userId);

  // Wipe session folder BEFORE useMultiFileAuthState when starting a fresh pairing.
  // This ensures no stale creds/keys from a previous failed attempt interfere.
  if (pairingPhone) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  setStatus(userId, 'connecting');

  let state, saveCreds;
  try {
    ({ state, saveCreds } = await useMultiFileAuthState(dir));
  } catch (e) {
    setStatus(userId, 'error');
    emitToUser(userId, 'logs', 'Auth state error: ' + e.message);
    return;
  }

  // Fetch latest WA version. fetchLatestBaileysVersion never throws —
  // it returns the bundled fallback on network error. So no try/catch needed,
  // but we keep it to be safe. The bundled version in the installed package
  // is used if github is unreachable (e.g. Replit network restrictions).
  let version;
  try {
    const versionResult = await fetchLatestBaileysVersion();
    version = versionResult.version;
    console.log('[' + userId + '] WA version: ' + version.join('.') + (versionResult.isLatest ? ' (latest)' : ' (bundled fallback)'));
  } catch (_) {
    version = [2, 3000, 1023223821];
  }

  const logger = pino({ level: 'silent' });
  const cleanPhone = pairingPhone ? pairingPhone.replace(/[^0-9]/g, '') : null;

  // Create the socket. Same config for both QR and pairing code modes.
  // Do NOT pass usePairingCode — it is not a real Baileys option and does nothing.
  // Do NOT use Browsers.ubuntu() for pairing — use a plain array with 'Chrome'.
  const sock = makeWASocket({
    version:             version,
    logger:              logger,
    printQRInTerminal:   false,
    browser:             ['Afnan Bot', 'Chrome', '120.0.0.0'],
    auth: {
      creds: state.creds,
      // makeCacheableSignalKeyStore is required — without it, signal key
      // operations fail silently causing auth errors during pairing.
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    syncFullHistory:     false,
    downloadHistory:     false,
    markOnlineOnConnect: false,
    getMessage:          async () => ({ conversation: '' }),
  });

  sessions.set(userId, {
    sock:         sock,
    status:       'connecting',
    pairingPhone: pairingPhone,
  });

  sock.ev.on('creds.update', saveCreds);

  // ── THE FIX: Call requestPairingCode() IMMEDIATELY after makeWASocket() ──────
  //
  // WHY THIS WORKS:
  // makeWASocket() starts the WebSocket connection and immediately kicks off
  // the Noise handshake + registration node exchange asynchronously.
  // At this point, the Node.js event loop has not yet run any WS message
  // handlers. No 'pair-device' node from WA's server has been processed yet.
  //
  // requestPairingCode() sends link_code_companion_reg which tells WA's server
  // "I want to pair via code, not QR". WA's server receives this BEFORE
  // it would have sent the pair-device (QR) node, so it switches to pairing
  // code mode, generates the code server-side, and sends a push notification
  // to the target phone. The user enters the code and pairing succeeds.
  //
  // WHY THE OLD CODE FAILED:
  // Calling requestPairingCode() inside the 'qr' event is too late.
  // The 'qr' event fires AFTER WA's server sent 'pair-device' AND Baileys
  // already replied with 'iq result' acknowledging QR mode. At that point
  // WA's server has committed to QR flow. Sending link_code_companion_reg
  // after creates a conflicting state → "couldn't link device".
  //
  // TIMING: requestPairingCode() calls sendNode() which calls sendRawMessage()
  // which checks ws.isOpen. The WS may not be open the instant after makeWASocket()
  // returns. So we wait for the socket to be ready using a tiny poll before calling.
  // This is safe because pair-device only arrives after the full handshake completes
  // (multiple async round trips), giving us a reliable window.

  if (pairingPhone && !state.creds.registered) {
    emitToUser(userId, 'logs', 'Requesting pairing code for +' + cleanPhone + '...');

    // Wait for WebSocket to be open (typically < 500ms), then call immediately.
    // We check ws.isOpen via the sock.ws property.
    const requestCode = async () => {
      // Poll until socket WS is open, max 10s
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const wsOpen = sock.ws && (sock.ws.isOpen === true || sock.ws.readyState === 1);
        if (wsOpen) break;
        await new Promise(r => setTimeout(r, 100));
      }

      try {
        const code = await sock.requestPairingCode(cleanPhone);
        const formatted = code && code.match(/.{1,4}/g) ? code.match(/.{1,4}/g).join('-') : code;
        emitToUser(userId, 'pairing-code', formatted);
        emitToUser(userId, 'logs', 'Pairing code: ' + formatted);
        emitToUser(userId, 'logs', 'Open WhatsApp -> Linked Devices -> Link a Device -> Link with phone number -> enter the code above');
        setStatus(userId, 'pairing');
      } catch (e) {
        emitToUser(userId, 'logs', 'Pairing code error: ' + e.message);
        emitToUser(userId, 'logs', 'Make sure the number is correct (e.g. 919876543210) and try again');
        setStatus(userId, 'disconnected');
        try { await sock.end(undefined); } catch (_) {}
      }
    };

    // Call without await so we don't block the event listener registration below.
    // This schedules requestCode() to run in the next microtask tick, giving
    // Baileys time to finish its internal socket setup synchronously first.
    Promise.resolve().then(requestCode);
  }

  // ── Connection events ─────────────────────────────────────────────────────
  sock.ev.on('connection.update', async function(update) {
    const connection   = update.connection;
    const lastDisconnect = update.lastDisconnect;
    const qr           = update.qr;

    // QR code — only shown in QR mode (no pairingPhone)
    if (qr && !pairingPhone) {
      try {
        const qrDataUrl = await qrcode.toDataURL(qr, {
          margin: 2,
          width: 300,
          color: { dark: '#000000', light: '#ffffff' },
        });
        setStatus(userId, 'qr');
        emitToUser(userId, 'qr', qrDataUrl);
        emitToUser(userId, 'logs', 'QR code ready - scan with WhatsApp');
      } catch (e) {
        emitToUser(userId, 'logs', 'QR generation failed: ' + e.message);
      }
    }

    if (connection === 'open') {
      const rawId = (sock.user && sock.user.id) ? sock.user.id : '';
      const phone = rawId.split(':')[0].split('@')[0] || 'unknown';
      const connectedAt = new Date().toISOString();

      const ownerPhone = (pairingPhone || phone).replace(/[^0-9]/g, '');
      if (ownerPhone) registerOwner(ownerPhone);

      setStatus(userId, 'connected', { phone: phone, connectedAt: connectedAt, isOwner: true });
      emitToUser(userId, 'logs', 'Connected! WhatsApp: +' + phone + ' (Owner registered)');

      if (botHandler) {
        sock.ev.on('messages.upsert', function(arg) {
          const messages = arg.messages;
          const type = arg.type;
          if (type !== 'notify') return;
          for (var i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (!msg.message || !msg.key || !msg.key.id || !msg.key.remoteJid) continue;
            botHandler.handleMessage(sock, msg).catch(function() {});
          }
        });
        sock.ev.on('group-participants.update', function(upd) {
          botHandler.handleGroupUpdate(sock, upd).catch(function() {});
        });
        if (typeof botHandler.initializeAntiCall === 'function') {
          botHandler.initializeAntiCall(sock);
        }
        emitToUser(userId, 'logs', 'Afnan Bot commands active');
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode : null;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const reason = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.message)
        ? lastDisconnect.error.message : ('code ' + statusCode);

      console.log('[' + userId + '] closed - ' + reason);
      emitToUser(userId, 'logs', 'Connection closed: ' + reason);

      const currentSession = sessions.get(userId);
      const wasConnected = currentSession && currentSession.phone;

      if (loggedOut && wasConnected) {
        emitToUser(userId, 'logs', 'Logged out - session removed, please re-pair');
        await destroySession(userId, true);
      } else if (pairingPhone) {
        // Pairing failed or timed out — don't auto-reconnect, let user retry
        setStatus(userId, 'disconnected');
        emitToUser(userId, 'logs', 'Pairing session ended - click Connect to try again');
      } else if (!wasConnected || reconnectAttempt >= 5) {
        emitToUser(userId, 'logs', 'Could not restore session - please re-pair');
        await destroySession(userId, true);
      } else {
        setStatus(userId, 'reconnecting');
        emitToUser(userId, 'logs', 'Reconnecting in 5s... (' + (reconnectAttempt + 1) + '/5)');
        const timer = setTimeout(function() {
          startSession(userId, null, reconnectAttempt + 1);
        }, 5000);
        const s = sessions.get(userId) || {};
        s.reconnectTimer = timer;
        sessions.set(userId, s);
      }
    }
  });

  sock.ev.on('error', function(err) {
    const code = err && err.output ? err.output.statusCode : null;
    if (code !== 515 && code !== 503 && code !== 408) {
      emitToUser(userId, 'logs', 'Socket error: ' + (err.message || err));
    }
  });

  return sock;
}

// ─── Auto-restore sessions on startup ────────────────────────────────────────
async function autoRestoreSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return;
  const dirs = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    .filter(function(e) { return e.isDirectory(); })
    .map(function(e) { return e.name; });
  if (!dirs.length) return;
  console.log('Auto-restoring ' + dirs.length + ' session(s)');
  for (let i = 0; i < dirs.length; i++) {
    const userId = dirs[i];
    const creds = path.join(SESSIONS_DIR, userId, 'creds.json');
    if (fs.existsSync(creds)) {
      sessions.set(userId, { status: 'restoring' });
      await startSession(userId, null, 0).catch(function(e) {
        console.error('[' + userId + '] restore failed: ' + e.message);
      });
      await new Promise(function(r) { setTimeout(r, 1500); });
    }
  }
}

// ─── Socket.io events ─────────────────────────────────────────────────────────
io.on('connection', function(socket) {
  console.log('Browser connected: ' + socket.id);

  socket.on('join', function(userId) {
    if (!userId) return;
    socket.join('user:' + userId);
    const s = sessions.get(userId);
    if (s) socket.emit('status', { status: s.status, phone: s.phone, connectedAt: s.connectedAt, isOwner: s.isOwner });
  });

  socket.on('start-session', async function(userId) {
    if (!userId || typeof userId !== 'string') return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!safe) return;
    socket.join('user:' + safe);
    const existing = sessions.get(safe);
    if (existing && existing.status === 'connected') {
      socket.emit('status', { status: 'connected', phone: existing.phone });
      socket.emit('logs', 'Already connected!');
      return;
    }
    await startSession(safe, null, 0);
  });

  socket.on('start-pairing', async function(data) {
    const userId = data && data.userId;
    const phone  = data && data.phone;
    if (!userId || !phone) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    if (!safe || cleanPhone.length < 7) {
      socket.emit('logs', 'Invalid phone number - include country code, e.g. 919876543210');
      return;
    }
    socket.join('user:' + safe);
    const existing = sessions.get(safe);
    if (existing && existing.status === 'connected') {
      socket.emit('status', { status: 'connected', phone: existing.phone });
      socket.emit('logs', 'Already connected!');
      return;
    }
    if (existing && (existing.status === 'connecting' || existing.status === 'pairing')) {
      socket.emit('logs', 'Already connecting, please wait...');
      return;
    }
    await startSession(safe, cleanPhone, 0);
  });

  socket.on('logout-session', async function(userId) {
    if (!userId) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    await destroySession(safe, false);
    socket.emit('logs', 'Device logged out');
    io.emit('sessions-updated');
  });

  socket.on('delete-session', async function(userId) {
    if (!userId) return;
    const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    await destroySession(safe, true);
    socket.emit('logs', 'Session deleted');
    io.emit('sessions-updated');
  });

  socket.on('disconnect', function() {
    console.log('Browser left: ' + socket.id);
  });
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', async function() {
  console.log('Afnan Bot Panel running at http://0.0.0.0:' + PORT);
  patchConfigOwners();
  await autoRestoreSessions();
});

process.on('uncaughtException', function(err) {
  if (err.code === 'ENOSPC') return;
  console.error('Uncaught:', err.message);
});
process.on('unhandledRejection', function(err) {
  if (err && err.message && err.message.includes('rate-overlimit')) return;
  console.error('Rejection:', (err && err.message) ? err.message : err);
});
