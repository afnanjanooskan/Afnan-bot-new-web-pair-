/**
 * Werewolf Game Engine  v2.0
 * Full-featured social-deduction game for WhatsApp groups.
 */
'use strict';

const fs   = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════
//  ROLE CATALOGUE
// ═══════════════════════════════════════════════════════════════
const ROLES = {
  // Village
  VILLAGER: {
    name: 'Villager', emoji: '🧑‍🌾', team: 'village',
    description: 'An ordinary townsfolk. Use your wits at the vote to root out the wolves!',
    nightAction: null
  },
  SEER: {
    name: 'Seer', emoji: '🔮', team: 'village',
    description: 'Each night, investigate ONE player to learn whether they are a werewolf or not.',
    nightAction: 'investigate'
  },
  DOCTOR: {
    name: 'Doctor', emoji: '🩺', team: 'village',
    description: 'Each night, choose ONE player to protect from death. You may protect yourself ONCE per game.',
    nightAction: 'protect', canSelfProtect: true
  },
  HUNTER: {
    name: 'Hunter', emoji: '🏹', team: 'village',
    description: 'When you are killed (by wolves OR by vote), you immediately take ONE player down with you.',
    nightAction: null, deathAbility: true
  },
  MAYOR: {
    name: 'Mayor', emoji: '🎖️', team: 'village',
    description: 'Your vote counts TWICE during the day.',
    nightAction: null, doubleVote: true
  },
  BODYGUARD: {
    name: 'Bodyguard', emoji: '🛡️', team: 'village',
    description: 'Each night, guard ONE player. If they are attacked, you die in their place.',
    nightAction: 'guard'
  },
  WITCH: {
    name: 'Witch', emoji: '🧙', team: 'village',
    description: 'You hold ONE save potion (revive a wolf victim) and ONE kill potion — each usable once.',
    nightAction: 'witch'
  },
  // Werewolf
  WEREWOLF: {
    name: 'Werewolf', emoji: '🐺', team: 'werewolf',
    description: 'Each night coordinate with your pack to kill ONE villager.',
    nightAction: 'kill'
  },
  ALPHA_WEREWOLF: {
    name: 'Alpha Werewolf', emoji: '🐺👑', team: 'werewolf',
    description: 'Pack leader. Your kill bypasses Doctor and Bodyguard protection.',
    nightAction: 'kill', unblockable: true
  },
  WOLF_SHAMAN: {
    name: 'Wolf Shaman', emoji: '🐺🔮', team: 'werewolf',
    description: 'Each night, silence ONE player, blocking their special ability.',
    nightAction: 'block'
  },
  BERSERKER_WOLF: {
    name: 'Berserker Wolf', emoji: '🐺💢', team: 'werewolf',
    description: 'Part of the wolf pack. On death, a random villager also dies.',
    nightAction: 'kill', deathAbility: true, berserker: true
  },
  WOLF_CUB: {
    name: 'Wolf Cub', emoji: '🐺🍼', team: 'werewolf',
    description: 'Part of the wolf pack. If killed, wolves get TWO kills the following night.',
    nightAction: 'kill', cubRevenge: true
  },
  // Neutral
  SERIAL_KILLER: {
    name: 'Serial Killer', emoji: '🔪', team: 'neutral',
    description: 'Each night silently eliminate ONE player. Win by being the LAST survivor.',
    nightAction: 'sk_kill', winCondition: 'last_standing'
  },
  JESTER: {
    name: 'Jester', emoji: '🃏', team: 'neutral',
    description: 'Win by getting yourself voted OUT by the town. Dying to wolves is a loss.',
    nightAction: null, winCondition: 'get_lynched'
  },
  ARSONIST: {
    name: 'Arsonist', emoji: '🔥', team: 'neutral',
    description: 'Douse players at night, then reply ignite to burn all doused players at once.',
    nightAction: 'douse', winCondition: 'burn_all'
  },
  EXECUTIONER: {
    name: 'Executioner', emoji: '⚔️', team: 'neutral',
    description: 'Win by getting your SECRET target (a villager) voted out. Fails if target dies at night.',
    nightAction: null, winCondition: 'execute_target'
  },
  SURVIVOR: {
    name: 'Survivor', emoji: '🏕️', team: 'neutral',
    description: 'No special ability. Win simply by being alive when the game ends.',
    nightAction: null, winCondition: 'survive'
  }
};

const BALANCED_ROLES = {
  4:  ['WEREWOLF','SEER','DOCTOR','VILLAGER'],
  5:  ['WEREWOLF','SEER','DOCTOR','VILLAGER','VILLAGER'],
  6:  ['WEREWOLF','SEER','DOCTOR','VILLAGER','VILLAGER','VILLAGER'],
  7:  ['WEREWOLF','WEREWOLF','SEER','DOCTOR','VILLAGER','VILLAGER','VILLAGER'],
  8:  ['WEREWOLF','WEREWOLF','SEER','DOCTOR','BODYGUARD','VILLAGER','VILLAGER','VILLAGER'],
  9:  ['WEREWOLF','WEREWOLF','SEER','DOCTOR','HUNTER','VILLAGER','VILLAGER','VILLAGER','VILLAGER'],
  10: ['WEREWOLF','WEREWOLF','SEER','DOCTOR','HUNTER','BODYGUARD','VILLAGER','VILLAGER','VILLAGER','VILLAGER'],
  11: ['WEREWOLF','WEREWOLF','ALPHA_WEREWOLF','SEER','DOCTOR','HUNTER','VILLAGER','VILLAGER','VILLAGER','VILLAGER','VILLAGER'],
  12: ['WEREWOLF','WEREWOLF','WEREWOLF','SEER','DOCTOR','HUNTER','MAYOR','WITCH','VILLAGER','VILLAGER','VILLAGER','VILLAGER'],
  13: ['WEREWOLF','WEREWOLF','WEREWOLF','ALPHA_WEREWOLF','SEER','DOCTOR','HUNTER','MAYOR','BODYGUARD','VILLAGER','VILLAGER','VILLAGER','VILLAGER'],
  15: ['WEREWOLF','WEREWOLF','WEREWOLF','ALPHA_WEREWOLF','WOLF_SHAMAN','SEER','DOCTOR','HUNTER','MAYOR','BODYGUARD','WITCH','VILLAGER','VILLAGER','VILLAGER','VILLAGER']
};

const RANDOM_EVENTS = [
  { id:'blood_moon',   name:'🩸 Blood Moon',          description:'The wolf pack grows hungry – they kill TWO players tonight!', probability:0.08 },
  { id:'silent_town',  name:'🤐 Silent Town',          description:'An eerie silence – the discussion phase is skipped!',          probability:0.06 },
  { id:'resurrection', name:'✨ Divine Resurrection',  description:'A miracle! One randomly-chosen dead player returns to life!',  probability:0.05 },
  { id:'storm',        name:'⛈️ Violent Storm',         description:'A storm rages – ALL night abilities fail this night!',         probability:0.04 },
  { id:'paranoia',     name:'😱 Mass Paranoia',         description:'Panic grips the village – no ties allowed tonight!',           probability:0.05 }
];

const PHASE = {
  LOBBY:'lobby', NIGHT:'night', MORNING:'morning',
  DISCUSSION:'discussion', VOTING:'voting',
  DEATH_SHOT:'death_shot', ENDED:'ended'
};

// ─── Stats helpers ────────────────────────────────────────────
const STATS_FILE = path.join(__dirname,'../../data/werewolf_stats.json');

function loadStats() {
  try { if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE,'utf8')); } catch(_){}
  return {};
}
function saveStats(s) {
  try {
    const d=path.dirname(STATS_FILE);
    if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true});
    fs.writeFileSync(STATS_FILE,JSON.stringify(s,null,2));
  } catch(_){}
}
function ensureStat(jid,stats) {
  if (!stats[jid]) stats[jid]={played:0,wins:0,losses:0,xp:0,roleHistory:{},winStreak:0,bestStreak:0};
  return stats[jid];
}

function shuffle(arr) {
  const a=[...arr];
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

// ── Crypto-quality random integer 0..n-1 ─────────────────────────────────────
// Uses crypto.randomInt when available (Node 14.10+), falls back to Math.random
const crypto = (() => { try { return require('crypto'); } catch(_){ return null; } })();
function randInt(n) {
  if (crypto && crypto.randomInt) return crypto.randomInt(n);
  return Math.floor(Math.random() * n);
}

// Fisher-Yates with crypto-quality randomness
function cryptoShuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Role anti-repeat file ─────────────────────────────────────────────────────
// Tracks the role each JID had in their LAST game so we can avoid giving
// them the same role two games in a row.
const LAST_ROLE_FILE = path.join(__dirname, '../../data/werewolf_last_roles.json');

function loadLastRoles() {
  try {
    if (fs.existsSync(LAST_ROLE_FILE)) return JSON.parse(fs.readFileSync(LAST_ROLE_FILE, 'utf8'));
  } catch(_) {}
  return {};
}

function saveLastRoles(map) {
  try {
    const d = path.dirname(LAST_ROLE_FILE);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(LAST_ROLE_FILE, JSON.stringify(map, null, 2));
  } catch(_) {}
}
const DIV = '━━━━━━━━━━━━━━━━━━━━';
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

// ═══════════════════════════════════════════════════════════════
class WerewolfGame {

  constructor(groupId, sock) {
    this.groupId   = groupId;
    this.sock      = sock;
    this.phase     = PHASE.LOBBY;
    this.players   = new Map();
    this.joinOrder = [];
    this.night     = 0;
    this.dayNum    = 0;
    this.timer     = null;
    this.cubRevengeActive = false;
    this.wolfKillsThisNight = 1;
    this.doctorSelfUsed = false;
    this._resetNA();
    this.votes   = new Map();
    this.voteMap = new Map();
    this.dead    = new Map();
    this.pendingDeathShots = [];
    this.activeEvent = null;
    this.executionerTargets = new Map();
    this.witchState = new Map();
    this.stats = loadStats();
  }

  _resetNA() {
    this.nightActions = {
      wolfKillConfirm:null, wolfVoters:new Set(),
      doctorTarget:null,
      seerTarget:null, guardTarget:null,
      skTarget:null, douseTargets:new Set(), ignite:false,
      blockTarget:null, witchSaveTarget:null, witchKillTarget:null
    };
  }

  get alivePlayers() { return [...this.players.values()].filter(p=>p.alive); }
  get aliveCount()   { return this.alivePlayers.length; }
  get aliveWolves()  { return this.alivePlayers.filter(p=>ROLES[p.role]?.team==='werewolf'); }
  get aliveVillage() { return this.alivePlayers.filter(p=>ROLES[p.role]?.team==='village'); }
  getByNum(n)        { return [...this.players.values()].find(p=>p.num===n); }
  getByJid(j)        { return this.players.get(j); }

  // ── Lobby ────────────────────────────────────────────────────
  addPlayer(jid, name) {
    if (this.phase!==PHASE.LOBBY) return 'game_started';
    if (this.players.has(jid))   return 'already_joined';
    const num = this.joinOrder.length+1;
    this.players.set(jid,{jid,num,name,role:null,alive:true,doused:false,blocked:false});
    this.joinOrder.push(jid);
    return 'ok';
  }

  removePlayer(jid) {
    if (this.phase!==PHASE.LOBBY||!this.players.has(jid)) return false;
    this.players.delete(jid);
    this.joinOrder=this.joinOrder.filter(j=>j!==jid);
    let n=1; for (const j of this.joinOrder) this.players.get(j).num=n++;
    return true;
  }

  // ── Role assignment ──────────────────────────────────────────
  // Roles are assigned to a RANDOMLY SHUFFLED copy of the player list,
  // ensuring no one gets the same role just because they joined in the same order.
  assignRoles() {
    const count = this.players.size;

    // ── 1. Pick role bracket ──────────────────────────────────────────────
    const brackets = Object.keys(BALANCED_ROLES).map(Number).sort((a, b) => a - b);
    let bracket = brackets[0];
    for (const b of brackets) { if (count >= b) bracket = b; }

    // ── 2. Build role pool, pad with Villagers ────────────────────────────
    let rolePool = [...BALANCED_ROLES[bracket]];
    while (rolePool.length < count) rolePool.push('VILLAGER');

    // ── 3. Load each player's LAST role to prevent back-to-back repeats ──
    const lastRoles = loadLastRoles();

    // ── 4. Cryptographic shuffle of BOTH players and roles independently ─
    //    Doing two independent shuffles means join-order has zero influence.
    const shuffledJids  = cryptoShuffle(this.joinOrder);
    const shuffledRoles = cryptoShuffle(rolePool).slice(0, count);

    // ── 5. Anti-repeat assignment ─────────────────────────────────────────
    //    For each player who got the same role as last game, try to swap
    //    them with another player who does NOT have a conflict.
    //    We do up to (count) swap passes to resolve as many conflicts as possible.
    const assignment = shuffledJids.map((jid, i) => ({ jid, role: shuffledRoles[i] }));

    for (let pass = 0; pass < count; pass++) {
      let swapped = false;
      for (let i = 0; i < assignment.length; i++) {
        const { jid, role } = assignment[i];
        if (lastRoles[jid] !== role) continue; // no conflict — fine

        // This player had this role last game — find a swap partner:
        //   prefer someone whose last role is NOT the role we'd swap them to,
        //   and whose current assigned role is NOT the same as their own last role.
        let bestJ = -1;
        for (let j = 0; j < assignment.length; j++) {
          if (j === i) continue;
          const { jid: jidJ, role: roleJ } = assignment[j];
          // After swap: i gets roleJ, j gets role
          const iOk = lastRoles[jid]  !== roleJ;
          const jOk = lastRoles[jidJ] !== role;
          if (iOk && jOk) { bestJ = j; break; }      // perfect swap
          if (iOk && bestJ === -1) bestJ = j;          // partial improvement — keep looking
        }

        if (bestJ !== -1) {
          // Perform the swap
          const tmp = assignment[i].role;
          assignment[i].role  = assignment[bestJ].role;
          assignment[bestJ].role = tmp;
          swapped = true;
        }
      }
      if (!swapped) break; // no more improvements possible
    }

    // ── 6. Commit roles & handle special role setup ───────────────────────
    assignment.forEach(({ jid, role }) => {
      const p = this.players.get(jid);
      p.role = role;

      if (p.role === 'EXECUTIONER') {
        const vils = assignment.filter(a => a.jid !== jid && ROLES[a.role]?.team === 'village');
        if (vils.length) {
          this.executionerTargets.set(
            jid,
            vils[randInt(vils.length)].jid
          );
        }
      }

      if (p.role === 'WITCH') {
        this.witchState.set(jid, { usedSave: false, usedKill: false });
      }
    });

    // ── 7. Persist last roles for next game ───────────────────────────────
    for (const { jid, role } of assignment) {
      lastRoles[jid] = role;
    }
    saveLastRoles(lastRoles);
  }

  // ── Role DM ──────────────────────────────────────────────────
  buildRoleDM(jid) {
    const p=this.players.get(jid);
    const role=ROLES[p.role];
    const BANNER={village:'🏘️ VILLAGE',werewolf:'🐺 WEREWOLF',neutral:'🎭 NEUTRAL'};
    let t=`\n╔══════════════════════╗\n   🎭  YOUR SECRET ROLE\n╚══════════════════════╝\n\n`;
    t+=`${role.emoji}  *${role.name}*\n`;
    t+=`🏴  Team: *${BANNER[role.team]}*\n\n`;
    t+=`📋  *Ability:*\n${role.description}\n`;
    if (role.team==='werewolf') {
      const pack=[...this.players.values()].filter(q=>ROLES[q.role]?.team==='werewolf'&&q.jid!==jid);
      t+=`\n${DIV}\n🐺 *YOUR WOLF PACK*\n${DIV}\n\n`;
      if (pack.length > 0) {
        t+=`You have *${pack.length}* pack-mate${pack.length>1?'s':''}. They know you too.\n\n`;
        pack.forEach(w=>{t+=`  🐺 Player ${w.num} — *${w.name}*  (${ROLES[w.role]?.name})\n`;});
        t+=`\n_You will see your pack-mates listed every night so you can coordinate._\n`;
      } else {
        t+=`  🐺 *You are the lone wolf.* No pack-mates — hunt alone!\n`;
        t+=`\n_Each night, choose your victim via DM._\n`;
      }
    }
    if (p.role==='SEER') t+=`\n_Each night: reply with a number to investigate._\n`;
    if (p.role==='DOCTOR') t+=`\n_Each night: reply with a number (or 0 for yourself once) to protect._\n`;
    if (p.role==='EXECUTIONER') {
      const tgt=this.players.get(this.executionerTargets.get(jid));
      if (tgt) t+=`\n🎯 *Your Target:* ${tgt.name}  (Player ${tgt.num})\nGet them voted out to win!\n`;
    }
    if (p.role==='WITCH') {
      t+=`\n🧙 *Potions (each once):*\n`;
      t+=`  • *save [number]* – revive tonight's wolf victim\n`;
      t+=`  • *poison [number]* – eliminate anyone\n`;
      t+=`  • *skip* – do nothing\n`;
    }
    if (p.role==='ARSONIST') t+=`\n_Reply with a number to douse, or *ignite* to burn all doused._\n`;
    t+=`\n${DIV}\n🤫  *Keep your role absolutely secret!*`;
    return t;
  }

  async sendRoleDMs() {
    this.dmFailedJids = [];
    for (const jid of this.joinOrder) {
      let sent = false;
      // Retry up to 3 times with increasing delay — handles WhatsApp rate limiting
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.sock.sendMessage(jid, { text: this.buildRoleDM(jid) });
          sent = true;
          break;
        } catch (_) {
          await delay(attempt * 800); // 800ms, 1600ms, 2400ms backoff
        }
      }
      if (!sent) {
        this.dmFailedJids.push(jid);
      }
      await delay(700); // longer gap between each player to avoid rate limiting with 10+ players
    }
  }

  // ── Night DM ─────────────────────────────────────────────────
  buildNightDM(jid) {
    const p=this.players.get(jid);
    const role=ROLES[p.role];
    if (!role.nightAction && role.team!=='werewolf') return null;
    const nonWolf=[...this.players.values()].filter(q=>q.alive&&ROLES[q.role]?.team!=='werewolf').map(q=>`  ${q.num}. ${q.name}`).join('\n');
    const allElse=[...this.players.values()].filter(q=>q.alive&&q.jid!==jid).map(q=>`  ${q.num}. ${q.name}`).join('\n');
    let t=`🌙 *NIGHT ${this.night}  –  ${role.emoji} ${role.name}*\n${DIV}\n\n`;
    if (role.team==='werewolf') {
      const extra=this.wolfKillsThisNight>1?`\n⚠️ *Double kill night! Choose your first target.*`:'';

      // List alive pack-mates so wolves know each other every night
      const packAlive=[...this.players.values()].filter(q=>q.alive&&ROLES[q.role]?.team==='werewolf'&&q.jid!==jid);
      t+=`🐺 *WOLF PACK — Night ${this.night}*\n${DIV}\n\n`;
      if (packAlive.length>0) {
        t+=`👥 *Your pack-mates still alive:*\n`;
        packAlive.forEach(w=>{t+=`  🐺 Player ${w.num} — *${w.name}*  (${ROLES[w.role]?.name})\n`;});
        t+=`\n`;
      } else {
        t+=`☠️ *You are the only surviving wolf.*\n\n`;
      }
      t+=`🎯 *Choose your victim tonight:*${extra}\n\n${nonWolf||'  (no valid targets)'}\n\n`;
      t+=`_Reply with a player number. The last wolf to reply locks in the target._`;
      return t;
    }
    switch (role.nightAction) {
      case 'investigate': t+=`🔮 *Investigate a player:*\n\n${allElse}\n\n_Reply with a number._`; break;
      case 'protect': {
        const selfNote=!this.doctorSelfUsed?`\n  0. Yourself (once only)`:'';
        t+=`🩺 *Protect a player:*${selfNote}\n\n${allElse}\n\n_Reply with a number._`;
        break;
      }
      case 'guard': t+=`🛡️ *Guard a player (you take their death):*\n\n${allElse}\n\n_Reply with a number._`; break;
      case 'sk_kill': t+=`🔪 *Choose your victim:*\n\n${allElse}\n\n_Reply with a number._`; break;
      case 'douse': {
        const doused=[...this.nightActions.douseTargets].map(j=>this.players.get(j)?.name).filter(Boolean).join(', ')||'none';
        t+=`🔥 *Douse a player OR ignite:*\n\n${allElse}\n\nCurrently doused: *${doused}*\n\n_Reply with a number or *ignite*._`;
        break;
      }
      case 'block': t+=`🔇 *Silence a player's ability:*\n\n${allElse}\n\n_Reply with a number._`; break;
      case 'witch': {
        const ws=this.witchState.get(jid)||{};
        t+=`🧙 *Witch – choose an action:*\n\n`;
        if (!ws.usedSave) t+=`  • *save [number]* – revive tonight's wolf victim\n`;
        if (!ws.usedKill) t+=`  • *poison [number]* – eliminate a player\n`;
        t+=`  • *skip* – do nothing\n\n${allElse}`;
        break;
      }
      default: return null;
    }
    return t;
  }

  // ── Wolf Pack Reveal — sent to every wolf at the start of each night ─
  // Each wolf gets a private DM listing ALL other wolves (alive) by name,
  // player number and role. This is the only way wolves know each other.
  async sendWolfPackReveal() {
    const allWolves = [...this.players.values()].filter(p => p.alive && ROLES[p.role]?.team === 'werewolf');
    if (allWolves.length === 0) return;

    for (const wolf of allWolves) {
      const teammates = allWolves.filter(w => w.jid !== wolf.jid);

      let t = `\n🐺🌙 *WOLF PACK — Night ${this.night}*\n${DIV}\n\n`;

      if (teammates.length === 0) {
        t += `☠️ *You are the only surviving wolf.*\n`;
        t += `Hunt alone tonight.\n`;
      } else if (teammates.length === 1) {
        const tm = teammates[0];
        t += `👥 *You and Player ${tm.num} (${tm.name}) are werewolves.*\n\n`;
        t += `  🐺 Player ${tm.num} — *${tm.name}*  (${ROLES[tm.role]?.name})\n`;
      } else {
        t += `👥 *You and ${teammates.length} others are werewolves:*\n\n`;
        teammates.forEach(tm => {
          t += `  🐺 Player ${tm.num} — *${tm.name}*  (${ROLES[tm.role]?.name})\n`;
        });
      }

      t += `\n${DIV}\n`;
      t += `_Only you and your pack see this message._\n`;
      t += `_Other players do NOT know who the wolves are._`;

      let wSent = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.sock.sendMessage(wolf.jid, { text: t });
          wSent = true;
          break;
        } catch (_) { await delay(attempt * 600); }
      }
      await delay(600);
    }
  }

  async sendNightDMs() {
    // First: send wolf pack reveal to all alive wolves
    await this.sendWolfPackReveal();
    await delay(500); // pause between wolf reveals and individual night DMs

    this.nightDmFailedJids = [];
    for (const jid of this.joinOrder) {
      const p = this.players.get(jid);
      if (!p.alive) continue;
      if (p.blocked) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await this.sock.sendMessage(jid, { text: `🔇 *You are silenced tonight!* Your ability is blocked.` });
            break;
          } catch (_) { await delay(attempt * 600); }
        }
        await delay(600);
        continue;
      }
      const dmText = this.buildNightDM(jid);
      if (!dmText) continue;
      let sent = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.sock.sendMessage(jid, { text: dmText });
          sent = true;
          break;
        } catch (_) { await delay(attempt * 600); }
      }
      if (!sent) this.nightDmFailedJids.push(jid);
      await delay(700); // safe gap for 10+ players
    }
  }

  // ── Night input handler ──────────────────────────────────────
  handleNightInput(jid, text) {
    const p=this.players.get(jid);
    if (!p||!p.alive||this.phase!==PHASE.NIGHT) return null;
    if (p.blocked) return `🔇 You are silenced tonight – your ability is blocked.`;
    const role=ROLES[p.role];
    const raw=text.trim().toLowerCase();
    const num=parseInt(raw);
    const getT=n=>this.getByNum(n);

    if (role.team==='werewolf') {
      const t=getT(num);
      if (!t||!t.alive||ROLES[t.role]?.team==='werewolf') return `❌ Invalid target. Choose a living non-wolf number.`;
      this.nightActions.wolfKillConfirm=t.jid;
      this.nightActions.wolfVoters.add(jid);
      const packSz=this.aliveWolves.length;
      const vtrs=this.nightActions.wolfVoters.size;
      const consensus=vtrs>=packSz?`\n✅ *All wolves agreed – ${t.name} is the target!*`:`\n⏳ ${vtrs}/${packSz} wolves voted.`;
      return `🐺 You voted for *${t.name}*.${consensus}`;
    }

    switch(role.nightAction) {
      case 'investigate': {
        const t=getT(num); if (!t||!t.alive) return `❌ Invalid number.`;
        this.nightActions.seerTarget=t.jid;
        return ROLES[t.role]?.team==='werewolf'
          ? `🔮 Vision: *${t.name}* is 🐺 *a WEREWOLF!*`
          : `🔮 Vision: *${t.name}* is ✅ *NOT a werewolf.*`;
      }
      case 'protect': {
        let target;
        if (raw==='0'||raw==='me'||raw==='myself') {
          if (this.doctorSelfUsed) return `❌ Self-protect already used.`;
          target=p; this.doctorSelfUsed=true;
        } else { target=getT(num); }
        if (!target||!target.alive) return `❌ Invalid target.`;
        this.nightActions.doctorTarget=target.jid;
        return `🩺 Protecting *${target.name}* tonight.`;
      }
      case 'guard': {
        const t=getT(num); if (!t||!t.alive) return `❌ Invalid target.`;
        this.nightActions.guardTarget=t.jid;
        return `🛡️ You stand guard over *${t.name}*.`;
      }
      case 'sk_kill': {
        const t=getT(num); if (!t||!t.alive) return `❌ Invalid target.`;
        this.nightActions.skTarget=t.jid;
        return `🔪 Target locked: *${t.name}*.`;
      }
      case 'douse': {
        if (raw==='ignite') {
          if (!this.nightActions.douseTargets.size) return `⚠️ You haven't doused anyone yet!`;
          this.nightActions.ignite=true;
          return `🔥 You will *ignite* tonight!`;
        }
        const t=getT(num); if (!t||!t.alive) return `❌ Invalid target.`;
        this.nightActions.douseTargets.add(t.jid); t.doused=true;
        return `🛢️ *${t.name}* has been doused.`;
      }
      case 'block': {
        const t=getT(num); if (!t||!t.alive) return `❌ Invalid target.`;
        this.nightActions.blockTarget=t.jid;
        return `🔇 You will silence *${t.name}*.`;
      }
      case 'witch': {
        const ws=this.witchState.get(jid); if (!ws) return null;
        if (raw==='skip') return `🧙 You skip tonight.`;
        const sm=raw.match(/^save\s+(\d+)$/);
        const pm=raw.match(/^poison\s+(\d+)$/);
        if (sm) {
          if (ws.usedSave) return `❌ Save potion already used.`;
          const t=getT(parseInt(sm[1])); if (!t) return `❌ Invalid number.`;
          this.nightActions.witchSaveTarget=t.jid; ws.usedSave=true;
          return `✨ Save potion aimed at *${t.name}*.`;
        }
        if (pm) {
          if (ws.usedKill) return `❌ Kill potion already used.`;
          const t=getT(parseInt(pm[1])); if (!t||!t.alive) return `❌ Invalid target.`;
          this.nightActions.witchKillTarget=t.jid; ws.usedKill=true;
          return `☠️ Kill potion aimed at *${t.name}*.`;
        }
        return `❌ Use: *save [n]*, *poison [n]*, or *skip*.`;
      }
      default: return null;
    }
  }

  // ── Resolve night ────────────────────────────────────────────
  resolveNight() {
    const deaths=[];
    const A=this.nightActions;
    const storm=this.activeEvent?.id==='storm';
    let savedByWitch=null;

    if (!storm && A.blockTarget) {
      const bp=this.players.get(A.blockTarget); if (bp) bp.blocked=true;
    }

    if (!storm && A.wolfKillConfirm) {
      const wolfTargets=[A.wolfKillConfirm];
      if (this.activeEvent?.id==='blood_moon'||this.cubRevengeActive) {
        const extras=this.alivePlayers.filter(p=>!wolfTargets.includes(p.jid)&&ROLES[p.role]?.team!=='werewolf');
        if (extras.length) wolfTargets.push(extras[Math.floor(Math.random()*extras.length)].jid);
      }
      this.cubRevengeActive=false;
      const isAlpha=this.aliveWolves.some(w=>w.role==='ALPHA_WEREWOLF');
      for (const tjid of wolfTargets) {
        const tgt=this.players.get(tjid); if (!tgt||!tgt.alive) continue;
        if (tjid===A.witchSaveTarget) { savedByWitch=tgt.name; continue; }
        if (tjid===A.doctorTarget&&!isAlpha) { /* saved */ }
        else if (tjid===A.guardTarget&&!isAlpha) {
          const bg=[...this.players.values()].find(q=>q.alive&&q.role==='BODYGUARD');
          if (bg){bg.alive=false;deaths.push({jid:bg.jid,name:bg.name,role:bg.role,num:bg.num,reason:'guarded'});}
        } else {
          tgt.alive=false;
          deaths.push({jid:tgt.jid,name:tgt.name,role:tgt.role,num:tgt.num,reason:'wolf'});
        }
      }
    }

    if (!storm&&A.skTarget) {
      const t=this.players.get(A.skTarget);
      if (t&&t.alive&&A.skTarget!==A.guardTarget){t.alive=false;deaths.push({jid:t.jid,name:t.name,role:t.role,num:t.num,reason:'sk'});}
    }

    if (!storm&&A.ignite) {
      for (const djid of A.douseTargets) {
        const dp=this.players.get(djid);
        if (dp&&dp.alive&&!deaths.find(d=>d.jid===djid)){dp.alive=false;deaths.push({jid:dp.jid,name:dp.name,role:dp.role,num:dp.num,reason:'arson'});}
      }
    }

    if (!storm&&A.witchKillTarget) {
      const t=this.players.get(A.witchKillTarget);
      if (t&&t.alive&&!deaths.find(d=>d.jid===t.jid)){t.alive=false;deaths.push({jid:t.jid,name:t.name,role:t.role,num:t.num,reason:'witch_kill'});}
    }

    // Berserker side effect
    deaths.filter(d=>ROLES[d.role]?.berserker).forEach(()=>{
      const vils=this.alivePlayers.filter(p=>ROLES[p.role]?.team==='village');
      if (vils.length){
        const v=vils[Math.floor(Math.random()*vils.length)];
        if (!deaths.find(d=>d.jid===v.jid)){v.alive=false;deaths.push({jid:v.jid,name:v.name,role:v.role,num:v.num,reason:'berserker'});}
      }
    });

    // Wolf Cub revenge flag
    if (deaths.find(d=>ROLES[d.role]?.cubRevenge)) this.cubRevengeActive=true;

    // Resurrection
    let resurrected=null;
    if (this.activeEvent?.id==='resurrection') {
      const dl=[...this.dead.values()];
      if (dl.length){
        const chosen=dl[Math.floor(Math.random()*dl.length)];
        const pp=this.players.get(chosen.jid);
        if (pp){pp.alive=true;this.dead.delete(chosen.jid);resurrected=chosen;}
      }
    }

    for (const d of deaths) this.dead.set(d.jid,{jid:d.jid,name:d.name,role:d.role,num:d.num});
    for (const p of this.players.values()) p.blocked=false;
    this._resetNA();
    return {deaths,resurrected,savedByWitch};
  }

  // ── Morning report ───────────────────────────────────────────
  buildMorningReport(deaths, resurrected, savedByWitch) {
    const RR={
      wolf:'🐺 Hunted by the werewolves',
      sk:'🔪 Murdered by the Serial Killer',
      arson:'🔥 Burned by the Arsonist',
      guarded:'🛡️ Gave their life protecting another',
      berserker:'💢 Dragged down by the Berserker Wolf',
      witch_kill:'☠️ Poisoned by the Witch'
    };
    let t=`\n☀️ *MORNING — Day ${this.dayNum}*\n${DIV}\n\n`;
    if (this.activeEvent) t+=`🎲 *Event: ${this.activeEvent.name}*\n_${this.activeEvent.description}_\n\n`;
    if (!deaths.length&&!resurrected) { t+=`😌 *Peaceful Night.* No one was harmed.\n`; }
    else {
      for (const d of deaths) {
        const role=ROLES[d.role];
        t+=`💀 *${d.name}*  (Player ${d.num}) is dead!\n`;
        t+=`   ↳ ${RR[d.reason]||'Died mysteriously'}\n`;
        t+=`   ↳ Role: ${role?.emoji} *${role?.name}*\n\n`;
      }
    }
    if (savedByWitch) t+=`🧙 Witch's potion saved *${savedByWitch}* from death!\n\n`;
    if (resurrected){const rr=ROLES[resurrected.role];t+=`✨ *${resurrected.name}* has been resurrected!\n   Role: ${rr?.emoji} ${rr?.name}\n\n`;}
    t+=`${DIV}\n👥 *Survivors  (${this.aliveCount}):*\n`;
    t+=this.alivePlayers.map(p=>`  ${p.num}. ${p.name}`).join('\n');
    return t;
  }

  // ── Day vote ─────────────────────────────────────────────────
  registerVote(voterJid, targetNum) {
    const voter=this.players.get(voterJid);
    if (!voter||!voter.alive)      return `❌ Dead players cannot vote.`;
    if (this.phase!==PHASE.VOTING) return `❌ Voting is not active right now.`;
    if (this.voteMap.has(voterJid)) return `❌ You already voted!`;

    // Resolve target: accepts player number (int) OR player JID (string)
    let target = null;
    if (typeof targetNum === 'string' && targetNum.includes('@')) {
      // Direct JID passed (from @mention resolution)
      target = this.players.get(targetNum);
      if (!target) {
        // Try matching by phone number prefix
        const phone = targetNum.split('@')[0];
        target = [...this.players.values()].find(p => p.jid.split('@')[0] === phone);
      }
    } else {
      target = this.getByNum(parseInt(targetNum));
    }

    if (!target||!target.alive)    return `❌ No living player with that number.`;
    if (target.jid===voterJid)     return `❌ You cannot vote for yourself.`;
    const weight=ROLES[voter.role]?.doubleVote?2:1;
    this.voteMap.set(voterJid,target.jid);
    this.votes.set(target.jid,(this.votes.get(target.jid)||0)+weight);
    const mn=weight===2?` *(Mayor – counts double!)*`:'';
    return `✅ Vote cast for *${target.name}* (Player ${target.num})${mn}.`;
  }

  skipVote(voterJid) {
    const voter=this.players.get(voterJid);
    if (!voter||!voter.alive)      return `❌ Dead players cannot vote.`;
    if (this.phase!==PHASE.VOTING) return `❌ Voting is not active.`;
    if (this.voteMap.has(voterJid)) return `❌ You already voted.`;
    this.voteMap.set(voterJid,'SKIP');
    return `✅ You skip this vote.`;
  }

  resolveVote() {
    let topJid=null,topCnt=0,tied=false;
    for (const [jid,cnt] of this.votes.entries()) {
      if (cnt>topCnt){topCnt=cnt;topJid=jid;tied=false;}
      else if(cnt===topCnt){tied=true;}
    }
    if (tied||!topJid||topCnt===0) return null;
    const p=this.players.get(topJid); if (!p) return null;
    p.alive=false;
    this.dead.set(topJid,{jid:topJid,name:p.name,role:p.role,num:p.num});
    return p;
  }

  buildVoteReport() {
    let t=`🗳️ *VOTE TALLY*\n${DIV}\n`;
    if (!this.votes.size){t+=`  No votes were cast.\n`;return t;}
    [...this.votes.entries()].sort((a,b)=>b[1]-a[1]).forEach(([jid,cnt])=>{
      const pp=this.players.get(jid);
      if (pp) t+=`  ${pp.name}: ${cnt} vote${cnt!==1?'s':''}\n`;
    });
    return t;
  }

  // ── Win conditions ───────────────────────────────────────────
  checkWin() {
    const alive=this.alivePlayers;
    const wolves=alive.filter(p=>ROLES[p.role]?.team==='werewolf');
    const village=alive.filter(p=>ROLES[p.role]?.team==='village');
    const sk=alive.find(p=>p.role==='SERIAL_KILLER');
    const arson=alive.find(p=>p.role==='ARSONIST');
    if (!wolves.length&&!sk&&!arson) return {winner:'village',message:`🎉 *VILLAGE WINS!*\nAll threats eliminated. The town is safe!`};
    if (wolves.length>=village.length) return {winner:'werewolf',message:`🐺 *WEREWOLVES WIN!*\nThe wolves have taken over!`};
    if (sk&&alive.length===1) return {winner:'sk',message:`🔪 *SERIAL KILLER WINS!*\nEveryone else is dead…`};
    if (arson&&alive.length===1) return {winner:'arsonist',message:`🔥 *ARSONIST WINS!* The world burns!`};
    return null;
  }
  jesterWin(name)      { return {winner:'jester',      message:`🃏 *JESTER WINS!*\n*${name}* tricked the village into lynching them!`}; }
  executionerWin(name) { return {winner:'executioner', message:`⚔️ *EXECUTIONER WINS!*\n*${name}* successfully had their target eliminated!`}; }

  // ── Death shot prompt ────────────────────────────────────────
  buildDeathShotDM(role) {
    const label=role==='HUNTER'?'🏹 Hunter':'🐺💢 Berserker Wolf';
    let t=`💀 *You have been killed…*\n\n${label} – *Final Shot!*\n`;
    t+=`As your last act, take ONE player with you.\n\n`;
    this.alivePlayers.forEach(p=>{t+=`  ${p.num}. ${p.name}\n`;});
    t+=`\n_Reply with a number within 30 seconds, or *skip*._`;
    return t;
  }

  // ── Lobby text ───────────────────────────────────────────────
  lobbyText() {
    const list=this.joinOrder.length
      ? this.joinOrder.map((jid,i)=>`  ${i+1}. ${this.players.get(jid).name}`).join('\n')
      : '  (empty)';
    return `🐺 *WEREWOLF LOBBY*\n${DIV}\nPlayers  (${this.players.size}):\n${list}\n\n_Min 4 players required._\nAdmin: *.ww start* to begin`;
  }

  // ── Stats ────────────────────────────────────────────────────
  finalizeStats(winnerTeam) {
    for (const [jid,p] of this.players.entries()) {
      const st=ensureStat(jid,this.stats);
      const rt=ROLES[p.role]?.team;
      st.played++; st.xp+=10;
      if (!st.roleHistory[p.role]) st.roleHistory[p.role]=0;
      st.roleHistory[p.role]++;
      const won=(rt==='village'&&winnerTeam==='village')||(rt==='werewolf'&&winnerTeam==='werewolf')
        ||(p.role==='JESTER'&&winnerTeam==='jester')||(p.role==='EXECUTIONER'&&winnerTeam==='executioner')
        ||(p.role==='SERIAL_KILLER'&&winnerTeam==='sk')||(p.role==='ARSONIST'&&winnerTeam==='arsonist')
        ||(p.role==='SURVIVOR'&&p.alive);
      if (won){st.wins++;st.xp+=25;st.winStreak=(st.winStreak||0)+1;if(st.winStreak>(st.bestStreak||0))st.bestStreak=st.winStreak;}
      else{st.losses=(st.losses||0)+1;st.winStreak=0;}
    }
    saveStats(this.stats);
  }

  getStatsText(jid) {
    const st=ensureStat(jid,this.stats);
    const pct=st.played>0?Math.round((st.wins/st.played)*100):0;
    const top=Object.entries(st.roleHistory||{}).sort((a,b)=>b[1]-a[1])[0];
    const fav=top?`${ROLES[top[0]]?.emoji} ${ROLES[top[0]]?.name}`:'N/A';
    const rank=this._rank(st.xp);
    return `📊 *Your Werewolf Stats*\n${DIV}\n`
      +`${rank.emoji} Rank: *${rank.name}*\n`
      +`🎮 Played: *${st.played}*  |  🏆 Wins: *${st.wins}*  |  Losses: *${st.losses||0}*\n`
      +`📈 Win Rate: *${pct}%*\n`
      +`🔥 Streak: *${st.winStreak||0}*  (Best: ${st.bestStreak||0})\n`
      +`⭐ XP: *${st.xp}*\n`
      +`🎭 Favourite Role: ${fav}\n`;
  }

  _rank(xp) {
    if (xp>=1000) return {emoji:'👑',name:'Grand Elder'};
    if (xp>=500)  return {emoji:'🏅',name:'Wolf Veteran'};
    if (xp>=250)  return {emoji:'🥈',name:'Townsperson'};
    if (xp>=100)  return {emoji:'🥉',name:'Newcomer'};
    return               {emoji:'🌱',name:'Rookie'};
  }

  static buildLeaderboard() {
    const stats=loadStats();
    const e=Object.entries(stats).map(([jid,s])=>({jid,wins:s.wins||0,xp:s.xp||0,played:s.played||0}))
      .sort((a,b)=>b.xp-a.xp||b.wins-a.wins).slice(0,10);
    if (!e.length) return `📊 No stats yet. Play a game first!`;
    const medals=['🥇','🥈','🥉'];
    let t=`🏆 *WEREWOLF LEADERBOARD  (Top 10)*\n${DIV}\n`;
    e.forEach((entry,i)=>{
      const num=entry.jid.split('@')[0];
      t+=`${medals[i]||`${i+1}.`}  +${num}  –  ⭐${entry.xp} XP  |  🏆${entry.wins}W/${entry.played}G\n`;
    });
    return t;
  }

  rollRandomEvent() {
    for (const ev of RANDOM_EVENTS) { if (Math.random()<ev.probability){this.activeEvent=ev;return ev;} }
    this.activeEvent=null; return null;
  }

  clearTimer() { if (this.timer){clearTimeout(this.timer);this.timer=null;} }
}

module.exports = { WerewolfGame, ROLES, PHASE, BALANCED_ROLES, RANDOM_EVENTS };
