/**
 * Simple JSON-based Database for Group Settings
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const DB_PATH = path.join(__dirname, 'database');
const GROUPS_DB = path.join(DB_PATH, 'groups.json');
const USERS_DB = path.join(DB_PATH, 'users.json');
const WARNINGS_DB = path.join(DB_PATH, 'warnings.json');
const MODS_DB = path.join(DB_PATH, 'mods.json');

// Initialize database directory
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// Initialize database files
const initDB = (filePath, defaultData = {}) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
  }
};

initDB(GROUPS_DB, {});
initDB(USERS_DB, {});
initDB(WARNINGS_DB, {});
initDB(MODS_DB, { moderators: [] });

// Read database
const readDB = (filePath) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading database: ${error.message}`);
    return {};
  }
};

// Write database
const writeDB = (filePath, data) => {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing database: ${error.message}`);
    return false;
  }
};

// Group Settings
const getGroupSettings = (groupId) => {
  const groups = readDB(GROUPS_DB);
  if (!groups[groupId]) {
    groups[groupId] = { ...config.defaultGroupSettings };
    writeDB(GROUPS_DB, groups);
  }
  return groups[groupId];
};

const updateGroupSettings = (groupId, settings) => {
  const groups = readDB(GROUPS_DB);
  groups[groupId] = { ...groups[groupId], ...settings };
  return writeDB(GROUPS_DB, groups);
};

// User Data
const getUser = (userId) => {
  const users = readDB(USERS_DB);
  if (!users[userId]) {
    users[userId] = {
      registered: Date.now(),
      premium: false,
      banned: false
    };
    writeDB(USERS_DB, users);
  }
  return users[userId];
};

const updateUser = (userId, data) => {
  const users = readDB(USERS_DB);
  users[userId] = { ...users[userId], ...data };
  return writeDB(USERS_DB, users);
};

// ─── Warnings System (.warn command) ─────────────────────────────────────────
// Stored under key:  groupId_userId
// Limit stored in group settings as:  warnLimit  (default 3)

const DEFAULT_WARN_LIMIT = 3;

const getWarnLimit = (groupId) => {
  const settings = getGroupSettings(groupId);
  return typeof settings.warnLimit === 'number' ? settings.warnLimit : DEFAULT_WARN_LIMIT;
};

const setWarnLimit = (groupId, limit) => {
  return updateGroupSettings(groupId, { warnLimit: limit });
};

const getWarnings = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  return warnings[key] || { count: 0, warnings: [] };
};

const addWarning = (groupId, userId, reason) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;

  if (!warnings[key]) {
    warnings[key] = { count: 0, warnings: [] };
  }

  warnings[key].count++;
  warnings[key].warnings.push({
    reason,
    date: Date.now()
  });

  writeDB(WARNINGS_DB, warnings);
  return warnings[key];
};

const removeWarning = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;

  if (warnings[key] && warnings[key].count > 0) {
    warnings[key].count--;
    warnings[key].warnings.pop();
    writeDB(WARNINGS_DB, warnings);
    return true;
  }
  return false;
};

const clearWarnings = (groupId, userId) => {
  const warnings = readDB(WARNINGS_DB);
  const key = `${groupId}_${userId}`;
  delete warnings[key];
  return writeDB(WARNINGS_DB, warnings);
};

// ─── Per-feature Anti-Warning System ─────────────────────────────────────────
// Each anti feature has its own:
//   - Warning counts, stored under key:  groupId_FEATURE_userId
//   - Warning limit, stored in group settings as:  FEATURE_warnLimit  (default 3)
//
// Completely separate from .warn system.  No sharing between features or groups.

const DEFAULT_ANTI_WARN_LIMIT = 3;

const getAntiWarnLimit = (groupId, type) => {
  const settings = getGroupSettings(groupId);
  const key = `${type}_warnLimit`;
  return typeof settings[key] === 'number' ? settings[key] : DEFAULT_ANTI_WARN_LIMIT;
};

const setAntiWarnLimit = (groupId, type, limit) => {
  const key = `${type}_warnLimit`;
  return updateGroupSettings(groupId, { [key]: limit });
};

const getAntiWarnings = (groupId, userId, type) => {
  return getWarnings(groupId, `${type}_${userId}`);
};

const addAntiWarning = (groupId, userId, type, reason) => {
  return addWarning(groupId, `${type}_${userId}`, reason);
};

const clearAntiWarnings = (groupId, userId, type) => {
  return clearWarnings(groupId, `${type}_${userId}`);
};

// Moderators System
const getModerators = () => {
  const mods = readDB(MODS_DB);
  return mods.moderators || [];
};

const addModerator = (userId) => {
  const mods = readDB(MODS_DB);
  if (!mods.moderators) mods.moderators = [];
  if (!mods.moderators.includes(userId)) {
    mods.moderators.push(userId);
    return writeDB(MODS_DB, mods);
  }
  return false;
};

const removeModerator = (userId) => {
  const mods = readDB(MODS_DB);
  if (mods.moderators) {
    mods.moderators = mods.moderators.filter(id => id !== userId);
    return writeDB(MODS_DB, mods);
  }
  return false;
};

const isModerator = (userId) => {
  const mods = getModerators();
  return mods.includes(userId);
};

// ─── Sudo System ──────────────────────────────────────────────────────────────

const SUDO_DB = path.join(DB_PATH, 'sudo.json');
initDB(SUDO_DB, { sudos: [] });

const getSudos = () => {
  const db = readDB(SUDO_DB);
  return db.sudos || [];
};

const addSudo = (number) => {
  const clean = String(number).replace(/[^0-9]/g, '');
  const db = readDB(SUDO_DB);
  if (!db.sudos) db.sudos = [];
  if (db.sudos.includes(clean)) return false;
  db.sudos.push(clean);
  return writeDB(SUDO_DB, db);
};

const removeSudo = (number) => {
  const clean = String(number).replace(/[^0-9]/g, '');
  const db = readDB(SUDO_DB);
  if (!db.sudos) return false;
  const before = db.sudos.length;
  db.sudos = db.sudos.filter(n => n !== clean);
  if (db.sudos.length === before) return false;
  return writeDB(SUDO_DB, db);
};

const isSudo = (jidOrNumber) => {
  const clean = String(jidOrNumber).split('@')[0].replace(/[^0-9]/g, '');
  return getSudos().includes(clean);
};

// ─── Message Count System ─────────────────────────────────────────────────────

const MSGCOUNT_DB = path.join(DB_PATH, 'msgcount.json');
initDB(MSGCOUNT_DB, {});

const getMsgCount = (groupId, userId) => {
  const db = readDB(MSGCOUNT_DB);
  return db[groupId]?.[userId] || 0;
};

const incrementMsgCount = (groupId, userId) => {
  const db = readDB(MSGCOUNT_DB);
  if (!db[groupId]) db[groupId] = {};
  db[groupId][userId] = (db[groupId][userId] || 0) + 1;
  writeDB(MSGCOUNT_DB, db);
};

const resetMsgCount = (groupId, userId) => {
  const db = readDB(MSGCOUNT_DB);
  if (db[groupId]) {
    db[groupId][userId] = 0;
    writeDB(MSGCOUNT_DB, db);
  }
};

const getGroupMsgCounts = (groupId) => {
  const db = readDB(MSGCOUNT_DB);
  return db[groupId] || {};
};

// ── DM Mute helpers ──────────────────────────────────────────────────────────
// dmMute is stored in config.js (same pattern as selfMode).
// These helpers provide a clean API so handler.js and the command don't
// need to know about file paths or cache-busting details.

const getDmMute = () => {
  delete require.cache[require.resolve('./config')];
  return require('./config').dmMute === true;
};

const setDmMute = (value) => {
  const fs   = require('fs');
  const path = require('path');
  const cfgPath = path.join(__dirname, 'config.js');
  let src = fs.readFileSync(cfgPath, 'utf8');
  src = src.replace(/(dmMute\s*:\s*)(true|false)/, `$1${value}`);
  fs.writeFileSync(cfgPath, src, 'utf8');
  delete require.cache[require.resolve('./config')];
};


// ─── Ban System ───────────────────────────────────────────────────────────────
const BANNED_DB = path.join(DB_PATH, 'banned.json');
initDB(BANNED_DB, { banned: [] });

const getBannedNumbers = () => {
  const db = readDB(BANNED_DB);
  return db.banned || [];
};

const banNumber = (number) => {
  const clean = String(number).split('@')[0].replace(/[^0-9]/g, '');
  const db = readDB(BANNED_DB);
  if (!db.banned) db.banned = [];
  if (db.banned.includes(clean)) return false;
  db.banned.push(clean);
  return writeDB(BANNED_DB, db);
};

const unbanNumber = (number) => {
  const clean = String(number).split('@')[0].replace(/[^0-9]/g, '');
  const db = readDB(BANNED_DB);
  if (!db.banned) return false;
  const before = db.banned.length;
  db.banned = db.banned.filter(n => n !== clean);
  if (db.banned.length === before) return false;
  return writeDB(BANNED_DB, db);
};

const isBanned = (jidOrNumber) => {
  const clean = String(jidOrNumber).split('@')[0].replace(/[^0-9]/g, '');
  return getBannedNumbers().includes(clean);
};

module.exports = {
  // Group settings
  getGroupSettings,
  updateGroupSettings,
  // Users
  getUser,
  updateUser,
  // .warn system (separate from anti)
  getWarnLimit,
  setWarnLimit,
  getWarnings,
  addWarning,
  removeWarning,
  clearWarnings,
  // Anti-feature warning system (per feature, per group)
  getAntiWarnLimit,
  setAntiWarnLimit,
  getAntiWarnings,
  addAntiWarning,
  clearAntiWarnings,
  // Mods
  getModerators,
  addModerator,
  removeModerator,
  isModerator,
  // Sudo
  getSudos,
  addSudo,
  removeSudo,
  isSudo,
  // DM Mute
  getDmMute,
  setDmMute,
  // Message counts
  getMsgCount,
  incrementMsgCount,
  resetMsgCount,
  getGroupMsgCounts,
  // Ban system
  getBannedNumbers,
  banNumber,
  unbanNumber,
  isBanned,
};
