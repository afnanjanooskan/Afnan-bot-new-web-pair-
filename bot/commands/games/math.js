/**
 * ╔═══════════════════════════════════════════════════════╗
 *   🧮  MATH GAME  —  Afnan's Bot  v3.0
 *   Advanced WhatsApp Math Game  |  Full Spec Build
 * ╚═══════════════════════════════════════════════════════╝
 *
 *  .math                  → Main menu
 *  .math poor             → Start Poor level
 *  .math easy             → Start Easy level
 *  .math hard             → Start Hard level
 *  .math insane           → Start Insane level
 *  .math impossible       → Start Impossible level
 *  .math daily            → Daily challenge (once/day)
 *  .math profile          → Your personal stats
 *  .math leaderboard      → Group top-10 leaderboard
 *  .math stop             → Admin: stop all active sessions
 *
 *  Players answer by typing the number in chat — no prefix.
 *  Multiplayer: every player has their own independent session.
 *  Wrong answer: player is told to try again (session stays open).
 *  Timeout: answer revealed, streak reset.
 *  Stats persist to data/math_stats.json across bot restarts.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════
//  FILE-BASED PERSISTENCE
// ═══════════════════════════════════════════════════════
const STATS_FILE = path.join(__dirname, '../../data/math_stats.json');

function _loadAll() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (_) {}
  return {};
}

function _saveAll(data) {
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
  } catch (_) {}
}

function loadPlayer(jid) {
  const all = _loadAll();
  if (!all[jid]) {
    all[jid] = {
      score:      0,
      xp:         0,
      level:      1,
      correct:    0,
      wrong:      0,
      streak:     0,
      bestStreak: 0,
      dailyDate:  '',
      dailyDone:  false,
      history:    {}
    };
    _saveAll(all);
  }
  return all[jid];
}

function savePlayer(jid, p) {
  const all = _loadAll();
  all[jid]  = p;
  _saveAll(all);
}

// ═══════════════════════════════════════════════════════
//  DIFFICULTY DEFINITIONS
// ═══════════════════════════════════════════════════════
const DIFF = {
  poor: {
    label:   'Poor',
    emoji:   '🟢',
    desc:    'Numbers 0–5, Addition only',
    timeout: 20_000,
    points:  1,
    xp:      5
  },
  easy: {
    label:   'Easy',
    emoji:   '🔵',
    desc:    'Numbers 0–20, Add & Subtract',
    timeout: 20_000,
    points:  3,
    xp:      10
  },
  hard: {
    label:   'Hard',
    emoji:   '🟡',
    desc:    'Numbers 0–50, Multiplication',
    timeout: 15_000,
    points:  5,
    xp:      15
  },
  insane: {
    label:   'Insane',
    emoji:   '🟠',
    desc:    'Mixed multi-step operations',
    timeout: 12_000,
    points:  8,
    xp:      25
  },
  impossible: {
    label:   'Impossible',
    emoji:   '🔴',
    desc:    'Large numbers, brackets, multi-step',
    timeout: 10_000,
    points:  12,
    xp:      40
  }
};

const DAILY_DIFF = {
  label: 'Daily Challenge', emoji: '🌟',
  timeout: 30_000, points: 20, xp: 60
};

// ═══════════════════════════════════════════════════════
//  RANK TIERS  (score-based)
// ═══════════════════════════════════════════════════════
const RANKS = [
  { min: 0,   emoji: '⚪', name: 'Beginner'    },
  { min: 10,  emoji: '🥉', name: 'Bronze'      },
  { min: 30,  emoji: '🥈', name: 'Silver'      },
  { min: 60,  emoji: '🥇', name: 'Gold'        },
  { min: 120, emoji: '💎', name: 'Diamond'     },
  { min: 200, emoji: '🏆', name: 'Math Legend' }
];

function getRank(score) {
  let r = RANKS[0];
  for (const tier of RANKS) { if (score >= tier.min) r = tier; }
  return r;
}

function getNextRank(score) {
  return RANKS.find(r => score < r.min) || null;
}

// ═══════════════════════════════════════════════════════
//  LEVEL SYSTEM  (xp-based, 10 levels)
// ═══════════════════════════════════════════════════════
const LVLS = [
  { n: 1,  xp: 0    },
  { n: 2,  xp: 100  },
  { n: 3,  xp: 250  },
  { n: 4,  xp: 500  },
  { n: 5,  xp: 900  },
  { n: 6,  xp: 1400 },
  { n: 7,  xp: 2100 },
  { n: 8,  xp: 3000 },
  { n: 9,  xp: 4200 },
  { n: 10, xp: 6000 }
];

function getLevel(xp) {
  let lv = LVLS[0];
  for (const l of LVLS) { if (xp >= l.xp) lv = l; }
  return lv;
}

function getNextLevel(xp) {
  return LVLS.find(l => xp < l.xp) || null;
}

function makeXpBar(xp) {
  const cur  = getLevel(xp);
  const next = getNextLevel(xp);
  if (!next) return '█'.repeat(10) + '  MAX ⭐';
  const pct    = Math.min(1, (xp - cur.xp) / (next.xp - cur.xp));
  const filled = Math.floor(pct * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + `  ${xp}/${next.xp}`;
}

// ═══════════════════════════════════════════════════════
//  QUESTION GENERATORS  — integer answers only
// ═══════════════════════════════════════════════════════
function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// POOR: 0–5 addition
function qPoor() {
  const a = ri(0, 5), b = ri(0, 5);
  return { q: `${a} + ${b}`, a: a + b };
}

// EASY: 0–20 add / subtract (result always ≥ 0)
function qEasy() {
  if (ri(0, 1) === 0) {
    const a = ri(0, 20), b = ri(0, 20);
    return { q: `${a} + ${b}`, a: a + b };
  }
  const a = ri(1, 20), b = ri(0, a);
  return { q: `${a} − ${b}`, a: a - b };
}

// HARD: 0–50 multiplication
function qHard() {
  const a = ri(2, 50), b = ri(2, 20);
  return { q: `${a} × ${b}`, a: a * b };
}

// INSANE: mixed multi-step (BODMAS)
function qInsane() {
  const t = ri(0, 3);
  if (t === 0) {
    const a = ri(2, 25), b = ri(2, 15), c = ri(1, 50);
    return { q: `${a} × ${b} + ${c}`, a: a * b + c };
  }
  if (t === 1) {
    const a = ri(5, 30), b = ri(2, 12), c = ri(1, 30);
    const ans = a * b - c;
    if (ans < 0) return qInsane();
    return { q: `${a} × ${b} − ${c}`, a: ans };
  }
  if (t === 2) {
    const a = ri(10, 50), b = ri(2, 10), c = ri(2, 10);
    return { q: `${a} + ${b} × ${c}`, a: a + b * c };
  }
  const a = ri(5, 30), b = ri(2, 10), c = ri(2, 15);
  return { q: `${a} × ${b} + ${b} × ${c}`, a: a * b + b * c };
}

// IMPOSSIBLE: large numbers, brackets, multi-step
function qImpossible() {
  const t = ri(0, 4);
  if (t === 0) {
    const a = ri(20, 200), b = ri(5, 20), c = ri(10, 100);
    return { q: `(${a} × ${b}) + ${c}`, a: a * b + c };
  }
  if (t === 1) {
    const a = ri(50, 150), b = ri(10, 30), c = ri(5, 50);
    const ans = a * b - c;
    if (ans < 0) return qImpossible();
    return { q: `(${a} × ${b}) − ${c}`, a: ans };
  }
  if (t === 2) {
    const a = ri(10, 50), b = ri(10, 50), c = ri(5, 20);
    return { q: `(${a} + ${b}) × ${c}`, a: (a + b) * c };
  }
  if (t === 3) {
    const a = ri(50, 200), b = ri(5, 20), c = ri(20, 80), d = ri(2, 10);
    return { q: `${a} × ${b} + ${c} × ${d}`, a: a * b + c * d };
  }
  const a = ri(5, 30), b = ri(5, 20), c = ri(2, 10), d = ri(5, 30);
  const ans = (a + b) * c - d;
  if (ans < 0) return qImpossible();
  return { q: `(${a} + ${b}) × ${c} − ${d}`, a: ans };
}

// DAILY: hardest variant
function qDaily() {
  const gens = [
    () => { const a=ri(50,200),b=ri(10,30),c=ri(20,100); return { q:`(${a}+${b})×${c}`, a:(a+b)*c }; },
    () => { const a=ri(30,100),b=ri(10,30),c=ri(20,80),d=ri(10,40); return { q:`${a}×${b}+${c}×${d}`, a:a*b+c*d }; },
    () => { const a=ri(10,30),b=ri(10,30),c=ri(5,15),d=ri(10,50); const r=(a+b)*c-d; if(r<0)return null; return{q:`(${a}+${b})×${c}−${d}`,a:r}; },
    () => { const a=ri(20,60),b=ri(5,20),c=ri(10,50),d=ri(3,8); return{q:`${a}×${b}+(${c}+${d})×${b}`,a:a*b+(c+d)*b}; }
  ];
  for (let i = 0; i < 15; i++) {
    const fn  = gens[ri(0, gens.length - 1)];
    const res = fn();
    if (res && Number.isFinite(res.a) && Number.isInteger(res.a) && res.a >= 0) return res;
  }
  return { q: '(120 × 8) + 45', a: 1005 };
}

const GENS = { poor: qPoor, easy: qEasy, hard: qHard, insane: qInsane, impossible: qImpossible };

function safeGen(level) {
  for (let i = 0; i < 15; i++) {
    const r = GENS[level]();
    if (r && Number.isFinite(r.a) && Number.isInteger(r.a) && r.a >= 0) return r;
  }
  return { q: '5 × 5', a: 25 };
}

// ═══════════════════════════════════════════════════════
//  ACTIVE SESSIONS  (per-player, supports multiplayer)
//  key: playerJid  →  { question, answer, level, diff,
//                       timer, startedAt, groupId, daily }
// ═══════════════════════════════════════════════════════
const activeSessions = new Map();

// ═══════════════════════════════════════════════════════
//  SEND HELPERS
// ═══════════════════════════════════════════════════════
async function sendMsg(sock, jid, text, mentions = []) {
  try {
    await sock.sendMessage(jid, mentions.length ? { text, mentions } : { text });
  } catch (_) {}
}

function tag(jid) { return `@${jid.split('@')[0]}`; }
const DIV = '━━━━━━━━━━━━━━━━━━━━';

// ═══════════════════════════════════════════════════════
//  START A QUESTION
// ═══════════════════════════════════════════════════════
async function startQuestion(sock, chatId, playerJid, level, isDaily) {
  // Anti-spam: block if player already has an open session
  if (activeSessions.has(playerJid)) {
    const s    = activeSessions.get(playerJid);
    const d    = s.diff;
    const left = Math.max(0, Math.ceil((s.startedAt + d.timeout - Date.now()) / 1000));
    await sendMsg(sock, chatId,
      `⚠️ ${tag(playerJid)} you already have an active question!\n\n` +
      `❓ *${s.question} = ?*\n` +
      `⏱️ *${left}s* remaining — answer it first!`,
      [playerJid]);
    return;
  }

  const diff    = isDaily ? DAILY_DIFF : DIFF[level];
  const { q, a } = isDaily ? qDaily() : safeGen(level);

  // Auto-timeout
  const timer = setTimeout(async () => {
    if (!activeSessions.has(playerJid)) return;
    activeSessions.delete(playerJid);

    // Reset streak on timeout
    const p = loadPlayer(playerJid);
    p.streak = 0;
    savePlayer(playerJid, p);

    await sendMsg(sock, chatId,
      `⏰ *Time's up!* ${tag(playerJid)}\n` +
      `${DIV}\n` +
      `❓ *${q} = ?*\n` +
      `✅ Correct answer: *${a}*\n\n` +
      `_Your streak has been reset. Try again!_`,
      [playerJid]);
  }, diff.timeout);

  activeSessions.set(playerJid, {
    question:  q,
    answer:    a,
    level:     level || 'daily',
    diff,
    timer,
    startedAt: Date.now(),
    groupId:   chatId,
    daily:     isDaily
  });

  const secs = diff.timeout / 1000;
  let text  = `\n🧮 *MATH CHALLENGE*\n${DIV}\n`;
  text += isDaily
    ? `🌟 *DAILY CHALLENGE*  —  Extra Points!\n\n`
    : `${diff.emoji} Level: *${diff.label.toUpperCase()}*\n\n`;
  text += `${tag(playerJid)}, what is:\n\n`;
  text += `❓  *${q} = ?*\n\n`;
  text += `${DIV}\n`;
  text += `⏱️ Time limit: *${secs}s*\n`;
  text += `💰 Reward: *+${diff.points} pts*  |  ⭐ *+${diff.xp} XP*\n`;
  text += `_Just type your answer in the chat!_`;

  await sendMsg(sock, chatId, text, [playerJid]);
}

// ═══════════════════════════════════════════════════════
//  ANSWER HANDLER  (called by handler.js)
// ═══════════════════════════════════════════════════════
async function handleMathAnswer(sock, msg, senderJid, text, chatId) {
  // Find any active session in this chat (any player may have started it)
  let session = null;
  let sessionOwnerJid = null;
  for (const [pJid, s] of activeSessions) {
    if (s.groupId === chatId) {
      session = s;
      sessionOwnerJid = pJid;
      break;
    }
  }
  if (!session) return false;

  const raw = text.trim().replace(/,/g, '').replace(/\s/g, '');
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return false;

  const isCorrect = Math.abs(num - session.answer) < 0.001;

  // ── WRONG answer ──────────────────────────────────
  if (!isCorrect) {
    await sendMsg(sock, chatId,
      `❌ *Wrong answer!* ${tag(senderJid)}\n` +
      `_Try again — you still have time left!_`,
      [senderJid]);
    return true; // consumed — prevent other handlers
  }

  // ── CORRECT answer ────────────────────────────────
  clearTimeout(session.timer);
  activeSessions.delete(sessionOwnerJid);

  const elapsed  = ((Date.now() - session.startedAt) / 1000).toFixed(1);
  const diff     = session.diff;
  const p        = loadPlayer(senderJid);
  const prevScore = p.score;
  const prevXP    = p.xp;
  const prevRank  = getRank(prevScore);
  const prevLevel = getLevel(prevXP);

  // Update stats
  p.correct++;
  p.streak     = (p.streak || 0) + 1;
  if (p.streak > (p.bestStreak || 0)) p.bestStreak = p.streak;
  p.score     += diff.points;
  p.xp        += diff.xp;
  p.level      = getLevel(p.xp).n;
  if (!p.history) p.history = {};
  p.history[session.daily ? 'daily' : session.level] =
    (p.history[session.daily ? 'daily' : session.level] || 0) + 1;
  if (session.daily) {
    p.dailyDate = new Date().toDateString();
    p.dailyDone = true;
  }
  savePlayer(senderJid, p);

  const newRank   = getRank(p.score);
  const newLevel  = getLevel(p.xp);
  const nextRank  = getNextRank(p.score);
  const nextLevel = getNextLevel(p.xp);

  let reply = `\n✅ *CORRECT!*\n${DIV}\n`;
  reply += `🏆 ${tag(senderJid)} answered in *${elapsed}s*!\n\n`;
  reply += `❓ *${session.question} = ${session.answer}*  ✅\n\n`;
  reply += `${DIV}\n`;
  reply += `💰 Points:  *+${diff.points}*  →  Total: *${p.score} pts*\n`;
  reply += `⭐ XP:      *+${diff.xp}*  →  Total: *${p.xp} XP*\n`;
  reply += `🔥 Streak:  *${p.streak}*${p.streak > 1 ? ` 🔥` : ''}  (Best: ${p.bestStreak})\n`;
  reply += `${newRank.emoji} Rank:   *${newRank.name}*\n`;
  reply += `📈 Level:   *${newLevel.n}*  |  ${makeXpBar(p.xp)}\n`;
  if (nextRank) reply += `_${nextRank.min - p.score} pts away from ${nextRank.emoji} ${nextRank.name}_\n`;

  // 🎉 Rank-up
  if (newRank.name !== prevRank.name) {
    reply += `\n🎉 *RANK UP!*\n`;
    reply += `${prevRank.emoji} ${prevRank.name}  →  ${newRank.emoji} *${newRank.name}*\n`;
    reply += `Congrats ${tag(senderJid)}! 🎊`;
  }

  // ⬆️ Level-up
  if (newLevel.n > prevLevel.n) {
    reply += `\n⬆️ *LEVEL UP!*  ${prevLevel.n} → *Level ${newLevel.n}* ✨`;
  }

  await sendMsg(sock, chatId, reply, [senderJid]);
  return true;
}

// ═══════════════════════════════════════════════════════
//  PROFILE TEXT
// ═══════════════════════════════════════════════════════
function buildProfile(jid) {
  const p      = loadPlayer(jid);
  const rank   = getRank(p.score);
  const nextR  = getNextRank(p.score);
  const lv     = getLevel(p.xp);
  const nextLv = getNextLevel(p.xp);
  const total  = p.correct + (p.wrong || 0);
  const acc    = total > 0 ? Math.round((p.correct / total) * 100) : 0;
  const today  = new Date().toDateString();

  const favEntry = Object.entries(p.history || {}).sort((a,b) => b[1]-a[1])[0];
  const fav = favEntry
    ? `${(DIFF[favEntry[0]] || DAILY_DIFF).emoji} ${(DIFF[favEntry[0]] || DAILY_DIFF).label}`
    : 'N/A';

  let t = `\n📊 *MATH PROFILE*\n${DIV}\n\n`;
  t += `${rank.emoji} *Rank:*        ${rank.name}\n`;
  if (nextR) t += `   _${nextR.min - p.score} pts to ${nextR.emoji} ${nextR.name}_\n`;
  t += `\n📈 *Level:*       ${lv.n}${nextLv ? ` / 10` : ' ⭐ MAX'}\n`;
  t += `   ${makeXpBar(p.xp)}\n`;
  if (nextLv) t += `   _${nextLv.xp - p.xp} XP to Level ${nextLv.n}_\n`;
  t += `\n🏅 *Score:*       ${p.score} pts\n`;
  t += `⭐ *Total XP:*    ${p.xp}\n`;
  t += `✅ *Correct:*     ${p.correct}\n`;
  t += `❌ *Wrong:*       ${p.wrong || 0}\n`;
  t += `🎯 *Accuracy:*    ${acc}%\n`;
  t += `🔥 *Streak:*      ${p.streak}  (Best: ${p.bestStreak || 0})\n`;
  t += `🎮 *Fav Level:*   ${fav}\n`;
  t += `📅 *Daily:*       ${p.dailyDate === today ? '✅ Done today' : '❌ Available'}\n`;
  return t;
}

// ═══════════════════════════════════════════════════════
//  LEADERBOARD TEXT
// ═══════════════════════════════════════════════════════
function buildLeaderboard() {
  const all     = _loadAll();
  const entries = Object.entries(all)
    .map(([jid, p]) => ({ jid, score: p.score||0, xp: p.xp||0, correct: p.correct||0 }))
    .filter(e => e.score > 0 || e.correct > 0)
    .sort((a, b) => b.score - a.score || b.xp - a.xp)
    .slice(0, 10);

  if (!entries.length) {
    return `📊 *Math Leaderboard*\n${DIV}\n\nNo scores yet!\nStart playing with *.math poor*`;
  }

  const medals = ['🥇', '🥈', '🥉'];
  let t = `\n🏆 *Math Leaderboard*\n${DIV}\n\n`;
  entries.forEach((e, i) => {
    const rank = getRank(e.score);
    const lv   = getLevel(e.xp);
    const num  = e.jid.split('@')[0];
    const med  = medals[i] || `*${i + 1}.*`;
    t += `${med} ${rank.emoji}  +${num}\n`;
    t += `     🏅 *${e.score} pts*  ⭐ ${e.xp} XP  Lv.${lv.n}  ✅ ${e.correct}\n\n`;
  });
  return t.trim();
}

// ═══════════════════════════════════════════════════════
//  MAIN MENU TEXT
// ═══════════════════════════════════════════════════════
function buildMenu(prefix) {
  const p = prefix;
  let t = `\n🧮 *MATH GAME*\n${DIV}\n\n`;
  t += `*Choose a difficulty level:*\n\n`;
  for (const [key, d] of Object.entries(DIFF)) {
    t += `${d.emoji} *${d.label}*\n`;
    t += `   ${d.desc}\n`;
    t += `   ⏱ ${d.timeout/1000}s  |  💰 +${d.points} pts  |  ⭐ +${d.xp} XP\n`;
    t += `   ➤ \`${p}math ${key}\`\n\n`;
  }
  t += `🌟 *Daily Challenge*  _(once per day)_\n`;
  t += `   ⏱ 30s  |  💰 +20 pts  |  ⭐ +60 XP\n`;
  t += `   ➤ \`${p}math daily\`\n\n`;
  t += `${DIV}\n`;
  t += `📊 \`${p}math profile\`      Your stats\n`;
  t += `🏆 \`${p}math leaderboard\`  Top players\n\n`;
  t += `*📌 Rank Tiers:*\n`;
  RANKS.forEach(r => {
    const nextR = RANKS.find(x => x.min > r.min);
    const range = nextR ? `${r.min}–${nextR.min - 1} pts` : `${r.min}+ pts`;
    t += `   ${r.emoji} *${r.name}*  —  ${range}\n`;
  });
  return t;
}

// ═══════════════════════════════════════════════════════
//  COMMAND EXPORT
// ═══════════════════════════════════════════════════════
module.exports = {
  name:        'math',
  aliases:     ['mathgame'],
  category:    'games',
  description: 'Advanced Math Game: 5 levels, XP, ranks, streaks & daily challenges!',
  usage:       '.math [poor|easy|hard|insane|impossible|daily|profile|leaderboard]',

  // Exposed for handler.js answer interception
  handleMathAnswer,
  activeSessions,

  async execute(sock, msg, args, extra) {
    const { from, sender, reply } = extra;
    const sub    = (args[0] || '').toLowerCase().trim();
    const config = require('../../config');
    const prefix = config.prefix || '.';

    // ── main menu ──────────────────────────────────
    if (!sub || sub === 'help' || sub === 'menu') {
      return reply(buildMenu(prefix));
    }

    // ── difficulty: start a question ──────────────
    if (DIFF[sub]) {
      await startQuestion(sock, from, sender, sub, false);
      return;
    }

    // ── daily challenge ────────────────────────────
    if (sub === 'daily') {
      const p     = loadPlayer(sender);
      const today = new Date().toDateString();
      if (p.dailyDate === today && p.dailyDone) {
        return reply(
          `🌟 *Daily Challenge*\n${DIV}\n\n` +
          `✅ You already completed today's challenge!\n` +
          `_Come back tomorrow for a new one._ 🕐\n\n` +
          `Use \`${prefix}math profile\` to see your stats.`
        );
      }
      await startQuestion(sock, from, sender, null, true);
      return;
    }

    // ── profile ────────────────────────────────────
    if (sub === 'profile' || sub === 'stats' || sub === 'me') {
      return reply(buildProfile(sender));
    }

    // ── leaderboard ────────────────────────────────
    if (sub === 'leaderboard' || sub === 'top' || sub === 'lb') {
      return reply(buildLeaderboard());
    }

    // ── stop  (admin force-stop all sessions in this chat) ──
    if (sub === 'stop') {
      let count = 0;
      for (const [pJid, s] of activeSessions) {
        if (s.groupId === from) {
          clearTimeout(s.timer);
          activeSessions.delete(pJid);
          count++;
          await sendMsg(sock, from,
            `🛑 ${tag(pJid)}'s question stopped.\n✅ Answer was: *${s.answer}*`,
            [pJid]);
        }
      }
      if (!count) return reply('❌ No active questions to stop.');
      return;
    }

    // ── fallback ───────────────────────────────────
    return reply(
      `❓ Unknown option.\n\n` +
      `Levels: \`poor\` · \`easy\` · \`hard\` · \`insane\` · \`impossible\`\n` +
      `Commands: \`daily\` · \`profile\` · \`leaderboard\` · \`stop\`\n\n` +
      `Type \`${prefix}math\` to see the full menu.`
    );
  }
};
