/**
 * Werewolf Game Command  v3.0 — FULLY MENTION-AWARE
 * All group messages tag players using WhatsApp @mentions.
 */
'use strict';

const { WerewolfGame, ROLES, PHASE } = require('../../utils/werewolf/WerewolfGame');

const activeGames = new Map();
const dmRouting   = new Map();

const T = { NIGHT:60_000, DISCUSSION:90_000, VOTING:60_000, DEATH_SHOT:30_000, POST_ROLE:4_000 };

// ── send with mentions ────────────────────────────────────────
async function sendM(sock, groupId, text, mentions=[]) {
  try { await sock.sendMessage(groupId, mentions.length ? {text,mentions} : {text}); } catch(_){}
}
async function dm(sock, jid, text) {
  try { await sock.sendMessage(jid, {text}); } catch(_){}
}
function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
function tag(jid){ return `@${jid.split('@')[0]}`; }

function getSenderName(msg, extra) {
  try {
    return extra?.groupMetadata?.participants?.find(p=>p.id===extra.sender)?.notify
      || extra.sender.split('@')[0];
  } catch(_){ return extra.sender.split('@')[0]; }
}

async function notifySpectators(sock, game, text) {
  for (const [jid] of game.dead) {
    try { await sock.sendMessage(jid, {text:`👁️ *[Spectator]* ${text}`}); await delay(150); } catch(_){}
  }
}

// ── lobby helpers ─────────────────────────────────────────────
async function sendLobby(sock, game) {
  const mentions = game.joinOrder.slice();
  const lines = game.joinOrder.map((jid,i) => `  ${i+1}. ${tag(jid)} *(${game.players.get(jid).name})*`);
  const text =
    `🐺 *WEREWOLF LOBBY*\n━━━━━━━━━━━━━━━━━━━━\n` +
    `👥 Players  (${game.players.size} joined):\n`+lines.join('\n')+
    `\n\n_Minimum 4 players required._\n`+
    `Type *.ww join* to enter  |  Admin: *.ww start* to begin`;
  await sendM(sock, game.groupId, text, mentions);
}

async function sendJoinAnnouncement(sock, game, jid) {
  const p = game.getByJid(jid);
  await sendM(sock, game.groupId,
    `✅ ${tag(jid)} *(${p.name})* joined the game!  →  Player *#${p.num}*\n`+
    `👥 ${game.players.size} player${game.players.size!==1?'s':''} in lobby`, [jid]);
}

async function sendLeaveAnnouncement(sock, game, jid, name) {
  await sendM(sock, game.groupId,
    `🚪 ${tag(jid)} *(${name})* left the lobby.\n`+
    `👥 ${game.players.size} player${game.players.size!==1?'s':''} remaining`, [jid]);
}

// ── NIGHT ─────────────────────────────────────────────────────
async function startNightPhase(sock, game) {
  game.phase = PHASE.NIGHT;
  game.night++;
  game.clearTimer();
  const event = game.rollRandomEvent();
  const aliveJids  = game.alivePlayers.map(p=>p.jid);
  const aliveLines = [...game.alivePlayers].sort((a,b)=>a.num-b.num)
    .map(p=>`  ${p.num}. ${tag(p.jid)} *(${p.name})*`).join('\n');
  let text = `\n🌙 *NIGHT ${game.night} BEGINS*\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `The village trembles in the dark… 😴\n\n`;
  if (event) text += `🎲 *Random Event:* ${event.name}\n_${event.description}_\n\n`;
  text += `🌑 *Surviving players:*\n${aliveLines}\n\n`;
  text += `Special roles — check your *private messages* for your night action!\n`;
  text += `_You have ${T.NIGHT/1000} seconds._`;
  await sendM(sock, game.groupId, text, aliveJids);
  await notifySpectators(sock, game, `Night ${game.night} has begun.`);
  await game.sendNightDMs();

  // Notify group about any players whose night DMs failed
  if (game.nightDmFailedJids && game.nightDmFailedJids.length > 0) {
    const failedTags = game.nightDmFailedJids.map(j => tag(j));
    await sendM(sock, game.groupId,
      `⚠️ *Could not send night DM to:* ${failedTags.join(', ')}\n` +
      `Type *.ww redm* to request your night action again.`,
      game.nightDmFailedJids
    );
  }

  game.timer = setTimeout(()=>resolveNightAndProceed(sock,game), T.NIGHT);
}

// ── MORNING ───────────────────────────────────────────────────
async function resolveNightAndProceed(sock, game) {
  game.clearTimer();
  game.dayNum++;
  game.phase = PHASE.MORNING;
  const {deaths,resurrected,savedByWitch} = game.resolveNight();
  const REASONS = {
    wolf:'🐺 Hunted by the werewolves', sk:'🔪 Murdered by the Serial Killer',
    arson:'🔥 Burned by the Arsonist', guarded:'🛡️ Died guarding another',
    berserker:'💢 Dragged down by the Berserker Wolf', witch_kill:'☠️ Poisoned by the Witch'
  };
  const deadJids  = deaths.map(d=>d.jid);
  const aliveJids = game.alivePlayers.map(p=>p.jid);
  const mentions  = [...new Set([...deadJids,...aliveJids])];

  let report = `\n☀️ *MORNING — Day ${game.dayNum}*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
  if (game.activeEvent) report += `🎲 *Event: ${game.activeEvent.name}*\n_${game.activeEvent.description}_\n\n`;
  if (!deaths.length&&!resurrected) {
    report += `😌 *Peaceful Night.* No one was harmed.\n`;
  } else {
    for (const d of deaths) {
      const role=ROLES[d.role];
      report += `💀 ${tag(d.jid)} *(${d.name})* — Player ${d.num} is dead!\n`;
      report += `   ↳ ${REASONS[d.reason]||'Died mysteriously'}\n`;
      report += `   ↳ Role: ${role?.emoji} *${role?.name}*\n\n`;
    }
  }
  if (savedByWitch) report += `🧙 Witch's potion saved *${savedByWitch}*!\n\n`;
  if (resurrected) {
    const rr=ROLES[resurrected.role];
    report += `✨ ${tag(resurrected.jid)} *(${resurrected.name})* resurrected! Role: ${rr?.emoji} ${rr?.name}\n\n`;
    mentions.push(resurrected.jid);
  }
  report += `━━━━━━━━━━━━━━━━━━━━\n👥 *Survivors (${game.aliveCount}):*\n`;
  report += [...game.alivePlayers].sort((a,b)=>a.num-b.num)
    .map(p=>`  ${p.num}. ${tag(p.jid)} *(${p.name})*`).join('\n');
  await sendM(sock, game.groupId, report, [...new Set(mentions)]);
  await notifySpectators(sock, game, `Morning report — Day ${game.dayNum}.`);
  for (const d of deaths) {
    await dm(sock, d.jid, `💀 *You died during the night.*\nYou are now a spectator.\nYour role will be revealed at the end.`);
    dmRouting.delete(d.jid);
  }
  const win = game.checkWin();
  if (win) return endGame(sock, game, win);
  const deathShooters = deaths.filter(d=>ROLES[d.role]?.deathAbility&&!ROLES[d.role]?.berserker);
  if (deathShooters.length) return handleDeathShots(sock, game, deathShooters, ()=>proceedToDiscussion(sock,game));
  await proceedToDiscussion(sock, game);
}

// ── DEATH SHOTS ───────────────────────────────────────────────
async function handleDeathShots(sock, game, shooters, afterCallback) {
  game.phase = PHASE.DEATH_SHOT;
  game.pendingDeathShots = [...shooters];
  for (const s of shooters) {
    const rn=ROLES[s.role]?.name||s.role;
    await sendM(sock, game.groupId,
      `💥 ${tag(s.jid)} *(${s.name})* [${rn}] has a *final action* before they go!`, [s.jid]);
    await dm(sock, s.jid, game.buildDeathShotDM(s.role));
    dmRouting.set(s.jid, game.groupId);
  }
  game.timer = setTimeout(async()=>{
    game.pendingDeathShots=[];
    for (const s of shooters) dmRouting.delete(s.jid);
    const win=game.checkWin(); if (win) return endGame(sock,game,win);
    await afterCallback();
  }, T.DEATH_SHOT);
}

// ── DISCUSSION ────────────────────────────────────────────────
async function proceedToDiscussion(sock, game) {
  game.clearTimer();
  game.pendingDeathShots=[];
  game.phase = PHASE.DISCUSSION;
  const win=game.checkWin(); if (win) return endGame(sock,game,win);
  if (game.activeEvent?.id==='silent_town') {
    await sendM(sock, game.groupId, `🤐 *Silent Town!* Discussion skipped — voting begins immediately!`);
    return startVoting(sock, game);
  }
  const sorted   = [...game.alivePlayers].sort((a,b)=>a.num-b.num);
  const mentions  = sorted.map(p=>p.jid);
  const lines     = sorted.map(p=>`  ${p.num}. ${tag(p.jid)} *(${p.name})*`).join('\n');
  let text = `\n💬 *DISCUSSION — Day ${game.dayNum}*\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Debate who the wolves are! Share clues, bluff, accuse.\n`;
  text += `_${T.DISCUSSION/1000} seconds to discuss._\n\n`;
  text += `👥 *Alive Players (join order):*\n${lines}\n\n`;
  text += `_Voting starts automatically when time is up._`;
  await sendM(sock, game.groupId, text, mentions);
  game.timer = setTimeout(()=>startVoting(sock,game), T.DISCUSSION);
}

// ── VOTING ────────────────────────────────────────────────────
async function startVoting(sock, game) {
  game.clearTimer();
  game.phase=PHASE.VOTING; game.votes=new Map(); game.voteMap=new Map();
  const sorted   = [...game.alivePlayers].sort((a,b)=>a.num-b.num);
  const mentions  = sorted.map(p=>p.jid);
  const lines     = sorted.map(p=>`  ${p.num}. ${tag(p.jid)} *(${p.name})*`).join('\n');
  let text = `\n🗳️ *VOTE — Day ${game.dayNum}*\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `Choose who to eliminate!\n\n`;
  text += `📋 *.ww vote [number]* to vote  |  *.ww skip* to abstain\n\n`;
  text += `👥 *Candidates (join order):*\n${lines}\n\n`;
  text += `_${T.VOTING/1000} seconds to vote._`;
  await sendM(sock, game.groupId, text, mentions);
  game.timer = setTimeout(()=>resolveVoteAndProceed(sock,game), T.VOTING);
}

// ── VOTE RESOLVE ──────────────────────────────────────────────
async function resolveVoteAndProceed(sock, game) {
  game.clearTimer();
  // tally with mentions
  const tallMentions=[];
  let tallyText=`🗳️ *VOTE TALLY*\n━━━━━━━━━━━━━━━━━━━━\n`;
  if (!game.votes.size) { tallyText+=`  No votes were cast.\n`; }
  else {
    [...game.votes.entries()].sort((a,b)=>b[1]-a[1]).forEach(([jid,cnt])=>{
      const pp=game.players.get(jid);
      if(pp){ tallyText+=`  ${tag(jid)} *(${pp.name})*: ${cnt} vote${cnt!==1?'s':''}\n`; tallMentions.push(jid); }
    });
  }
  await sendM(sock, game.groupId, tallyText, tallMentions);

  const executed = game.resolveVote();
  if (!executed) {
    await sendM(sock, game.groupId, `⚖️ *It's a tie!* No one was eliminated.\n_The night returns…_`);
    await delay(2000); return startNightPhase(sock, game);
  }

  const role=ROLES[executed.role];
  let execText=`\n⚔️ *ELIMINATED!*\n━━━━━━━━━━━━━━━━━━━━\n`;
  execText+=`${tag(executed.jid)} *(${executed.name})* — Player ${executed.num} voted out!\n`;
  execText+=`Role revealed: ${role?.emoji} *${role?.name}*\n`;

  // Jester win
  if (executed.role==='JESTER') {
    await sendM(sock, game.groupId, execText, [executed.jid]);
    await dm(sock, executed.jid, `🃏 *YOU WIN!* You tricked the village!`);
    return endGame(sock, game, game.jesterWin(executed.name));
  }
  // Executioner win
  for (const [execJid,targetJid] of game.executionerTargets.entries()) {
    if (targetJid===executed.jid) {
      const ep=game.getByJid(execJid);
      if (ep&&ep.alive) {
        await sendM(sock, game.groupId, execText, [executed.jid]);
        await dm(sock, execJid, `⚔️ *YOU WIN!* Your target was eliminated!`);
        return endGame(sock, game, game.executionerWin(ep.name));
      }
    }
  }
  // Hunter/Berserker on lynch
  if (ROLES[executed.role]?.deathAbility&&!ROLES[executed.role]?.berserker) {
    await sendM(sock, game.groupId, execText, [executed.jid]);
    dmRouting.delete(executed.jid);
    return handleDeathShots(sock, game, [executed], async()=>{
      const w=game.checkWin(); if(w) return endGame(sock,game,w);
      await startNightPhase(sock,game);
    });
  }

  await sendM(sock, game.groupId, execText, [executed.jid]);
  await dm(sock, executed.jid, `⚔️ The village voted you out. You are a spectator now.`);
  dmRouting.delete(executed.jid);
  await notifySpectators(sock, game, `${executed.name} eliminated — Role: ${role?.name}`);
  const win=game.checkWin(); if(win) return endGame(sock,game,win);
  await delay(2000); await startNightPhase(sock,game);
}

// ── GAME OVER ─────────────────────────────────────────────────
async function endGame(sock, game, win) {
  game.clearTimer();
  game.phase=PHASE.ENDED;
  const allJids=[...game.players.keys()];
  const sorted=[...game.players.values()].sort((a,b)=>a.num-b.num);
  let text=`\n🏁 *GAME OVER*\n━━━━━━━━━━━━━━━━━━━━\n\n${win.message}\n\n`;
  text+=`📜 *Full Role Reveal (join order):*\n`;
  for (const p of sorted) {
    const role=ROLES[p.role]; const alive=p.alive?'✅':'💀';
    text+=`  ${alive} ${p.num}. ${tag(p.jid)} *(${p.name})*  —  ${role?.emoji} ${role?.name}\n`;
  }
  text+=`\n_Thanks for playing! Start again with .ww join_`;
  await sendM(sock, game.groupId, text, allJids);
  for (const [jid,p] of game.players.entries()) {
    const rt=ROLES[p.role]?.team;
    const won=(rt==='village'&&win.winner==='village')||(rt==='werewolf'&&win.winner==='werewolf')
      ||(p.role==='JESTER'&&win.winner==='jester')||(p.role==='EXECUTIONER'&&win.winner==='executioner')
      ||(p.role==='SERIAL_KILLER'&&win.winner==='sk')||(p.role==='ARSONIST'&&win.winner==='arsonist')
      ||(p.role==='SURVIVOR'&&p.alive);
    const out=won?`🏆 *You WIN!* +35 XP`:`💔 *You lost.* +10 XP`;
    try { await sock.sendMessage(jid,{text:`${out}\n${win.message}`}); await delay(200); } catch(_){}
  }
  game.finalizeStats(win.winner);
  for (const jid of game.players.keys()) dmRouting.delete(jid);
  activeGames.delete(game.groupId);
}

// ── DM HANDLER ────────────────────────────────────────────────
async function handleWerewolfDM(sock, msg, senderJid, text) {
  const groupId=dmRouting.get(senderJid); if (!groupId) return false;
  const game=activeGames.get(groupId); if (!game) { dmRouting.delete(senderJid); return false; }
  const dsIdx=game.pendingDeathShots.findIndex(s=>s.jid===senderJid);
  if (dsIdx!==-1&&game.phase===PHASE.DEATH_SHOT) {
    const shooter=game.pendingDeathShots[dsIdx]; game.pendingDeathShots.splice(dsIdx,1);
    const raw=text.trim().toLowerCase();
    if (raw!=='skip') {
      const t=game.getByNum(parseInt(raw));
      if (t&&t.alive) {
        t.alive=false; game.dead.set(t.jid,{jid:t.jid,name:t.name,role:t.role,num:t.num});
        const rn=ROLES[shooter.role]?.name;
        await sendM(sock, groupId,
          `💥 ${tag(shooter.jid)} *(${shooter.name})* took ${tag(t.jid)} *(${t.name})* down!\n`+
          `Role: ${ROLES[t.role]?.emoji} ${ROLES[t.role]?.name}`, [shooter.jid,t.jid]);
        await dm(sock, t.jid, `💀 Taken out by the ${rn}. You are now a spectator.`);
        dmRouting.delete(t.jid);
      } else { await dm(sock, senderJid, `❌ Invalid number.`); }
    } else { await dm(sock, senderJid, `✅ You chose not to shoot.`); }
    dmRouting.delete(senderJid);
    if (!game.pendingDeathShots.length) {
      game.clearTimer();
      const win=game.checkWin(); if(win) return endGame(sock,game,win);
      if (game.phase===PHASE.DEATH_SHOT) await proceedToDiscussion(sock,game);
    }
    return true;
  }
  if (game.phase===PHASE.NIGHT) {
    const r=game.handleNightInput(senderJid,text);
    if (r) { await dm(sock,senderJid,r); return true; }
  }
  return false;
}

// ── LAUNCH ────────────────────────────────────────────────────
async function launchGame(sock, game, from) {
  game.assignRoles();
  const allJids = game.joinOrder.slice();
  const lines   = game.joinOrder.map((jid,i) => `  ${i+1}. ${tag(jid)} *(${game.players.get(jid).name})*`);

  // For 10+ players warn them upfront — WhatsApp requires an existing DM chat
  // with the bot for private messages to be delivered.
  let preDMNote = '';
  if (game.players.size >= 10) {
    preDMNote =
      `\n⚠️ *Large game detected (${game.players.size} players)!*\n` +
      `If you haven't chatted with the bot privately before, your role DM *may not arrive*.\n` +
      `Send the bot *any message* in private NOW, then wait for your role.\n\n`;
  }

  let text = `\n🐺 *WEREWOLF GAME STARTING!*\n━━━━━━━━━━━━━━━━━━━━\n`;
  text += `👥 *${game.players.size} Players (join order):*\n${lines.join('\n')}\n\n`;
  text += preDMNote;
  text += `📩 *Roles being sent to your private messages — check them NOW!*`;
  await sendM(sock, from, text, allJids);

  // Give players a moment to open a DM with the bot before we send role messages.
  // Scale the wait with player count so there's more time for larger games.
  const preSendWait = game.players.size >= 10 ? 5000 : 2000;
  await delay(preSendWait);

  await game.sendRoleDMs();

  // Report any role DM failures to the group
  if (game.dmFailedJids && game.dmFailedJids.length > 0) {
    const failedNames = game.dmFailedJids.map(j => {
      const p = game.players.get(j);
      return p ? `${tag(j)} *(${p.name})*` : tag(j);
    });
    await sendM(sock, from,
      `⚠️ *Role DM could not be delivered to ${game.dmFailedJids.length} player(s):*\n` +
      failedNames.join('\n') +
      `\n\n_These players need to send the bot a private message first, then an admin can use *.ww end* and restart the game._`,
      game.dmFailedJids
    );
  }

  // Scale post-role delay so night phase doesn't start before everyone has read their role.
  const postRoleDelay = game.players.size >= 10 ? 8000 : T.POST_ROLE;
  await delay(postRoleDelay);
  await startNightPhase(sock, game);
}

// ── EXPORT ────────────────────────────────────────────────────
module.exports = {
  name:'ww', aliases:['werewolf'], category:'games', groupOnly:true,
  description:'Play the Werewolf social-deduction game in your group!',
  usage:'.ww [join|start|vote|end|stats|roles|help|...]',
  handleWerewolfDM, activeGames, dmRouting,

  async execute(sock, msg, args, extra) {
    const {from,sender,reply}=extra;
    const sub=(args[0]||'').toLowerCase();

    if (!sub||sub==='help') return reply(
      `🐺 *WEREWOLF GAME*\n━━━━━━━━━━━━━━━━━━━━\n`+
      `*Lobby:*\n  *.ww join* *.ww leave* *.ww players*\n\n`+
      `*DM Issues:*\n  *.ww redm* — resend your role/night DM\n\n`+
      `*Admin:*\n  *.ww start* *.ww forcestart* *.ww pause*\n`+
      `  *.ww resume* *.ww skip* *.ww kick [n]* *.ww end*\n\n`+
      `*During Game:*\n  *.ww vote [n]* *.ww skip* *.ww status*\n\n`+
      `*Info:*\n  *.ww roles* *.ww role [name]* *.ww stats* *.ww top*`);

    if (sub==='join') {
      let game=activeGames.get(from);
      if (!game) { game=new WerewolfGame(from,sock); activeGames.set(from,game); }
      if (game.phase!==PHASE.LOBBY) return reply('⚠️ A game is already running!');
      const name=getSenderName(msg,extra);
      const result=game.addPlayer(sender,name);
      if (result==='already_joined') return reply('⚠️ You already joined!');
      dmRouting.set(sender,from);
      await sendJoinAnnouncement(sock,game,sender);
      await sendLobby(sock,game);
      return;
    }

    if (sub==='leave') {
      const game=activeGames.get(from);
      if (!game||game.phase!==PHASE.LOBBY) return reply('❌ No open lobby to leave.');
      const p=game.getByJid(sender); if (!p) return reply('❌ You are not in the lobby.');
      const name=p.name; game.removePlayer(sender); dmRouting.delete(sender);
      if (!game.players.size) {
        activeGames.delete(from);
        await sendM(sock,from,`🚪 ${tag(sender)} *(${name})* left. Lobby closed.`,[sender]); return;
      }
      await sendLeaveAnnouncement(sock,game,sender,name);
      await sendLobby(sock,game); return;
    }

    if (sub==='players') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active lobby.');
      await sendLobby(sock,game); return;
    }

    if (sub==='start') {
      const game=activeGames.get(from);
      if (!game) return reply('❌ No lobby. Use *.ww join* first.');
      if (game.phase!==PHASE.LOBBY) return reply('⚠️ Already in progress!');
      if (game.players.size<4) return reply(`❌ Need at least 4 players. Current: ${game.players.size}`);
      await launchGame(sock,game,from); return;
    }

    if (sub==='forcestart') {
      const game=activeGames.get(from);
      if (!game) return reply('❌ No lobby.'); if (game.phase!==PHASE.LOBBY) return reply('⚠️ Started.');
      if (game.players.size<2) return reply('❌ Need at least 2.');
      await launchGame(sock,game,from); return;
    }

    if (sub==='end') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active game.');
      game.clearTimer(); for (const jid of game.players.keys()) dmRouting.delete(jid);
      activeGames.delete(from); return sendM(sock,from,'🛑 *Game ended by admin.*');
    }

    if (sub==='pause') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active game.');
      game.clearTimer(); return sendM(sock,from,'⏸️ *Game paused.* Use *.ww resume* to continue.');
    }

    if (sub==='resume') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active game.');
      if (game.phase===PHASE.NIGHT) return startNightPhase(sock,game);
      if (game.phase===PHASE.DISCUSSION) return proceedToDiscussion(sock,game);
      if (game.phase===PHASE.VOTING) return startVoting(sock,game);
      return reply('⚠️ Cannot resume from this phase.');
    }

    if (sub==='skip') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active game.');
      if (game.phase===PHASE.VOTING) return reply(game.skipVote(sender));
      game.clearTimer();
      if (game.phase===PHASE.NIGHT) return resolveNightAndProceed(sock,game);
      if (game.phase===PHASE.DISCUSSION) return startVoting(sock,game);
      return reply('⚠️ Nothing to skip.');
    }

    if (sub==='kick') {
      const game=activeGames.get(from);
      if (!game||game.phase!==PHASE.LOBBY) return reply('❌ Can only kick during lobby.');
      const num=parseInt(args[1]); if (isNaN(num)) return reply('Usage: *.ww kick [n]*');
      const t=game.getByNum(num); if (!t) return reply('❌ Player not found.');
      game.removePlayer(t.jid); dmRouting.delete(t.jid);
      await sendM(sock,from,`🚫 ${tag(t.jid)} *(${t.name})* removed from lobby.`,[t.jid]);
      await sendLobby(sock,game); return;
    }

    if (sub==='vote') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active game.');
      if (game.phase!==PHASE.VOTING) return reply('❌ Voting is not active right now!');

      // Resolve vote target — accept all formats:
      //   .ww vote 3           → args[1] = '3'
      //   .ww vote @1234567890 → args[1] = '@1234567890'
      //   .ww vote (with WhatsApp @mention tag) → mentionedJid from context
      const rawArg = args[1] || '';

      // Extract mentioned JIDs from WhatsApp context (real @mentions)
      const mentionCtx = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
                      || msg.message?.contextInfo?.mentionedJid
                      || [];

      let voteTarget = null;

      if (mentionCtx.length > 0) {
        // WhatsApp proper @mention — use first mentioned JID
        voteTarget = mentionCtx[0];
      } else if (rawArg.startsWith('@')) {
        // Text like @1234567890 — strip @ and build JID
        const phone = rawArg.replace('@','').replace(/\D/g,'');
        voteTarget = phone + '@s.whatsapp.net';
      } else {
        // Plain number
        const num = parseInt(rawArg);
        if (isNaN(num)) {
          return reply(
            `❌ Please specify who to vote for.

` +
            `Usage:
` +
            `  *.ww vote [number]*  e.g. *.ww vote 3*
` +
            `  *.ww vote @player*   mention the player`
          );
        }
        voteTarget = num; // pass number directly
      }

      return reply(game.registerVote(sender, voteTarget));
    }

    if (sub==='status') {
      const game=activeGames.get(from); if (!game) return reply('❌ No active game.');
      const aliveJids=game.alivePlayers.map(p=>p.jid);
      let t=`🎮 *Game Status*\n━━━━━━━━━━━━━━━━━━━━\n`;
      t+=`Phase: *${game.phase.toUpperCase()}*  Night: ${game.night}  Day: ${game.dayNum}\n\n`;
      t+=`👥 *Alive (${game.aliveCount}):*\n`;
      [...game.alivePlayers].sort((a,b)=>a.num-b.num).forEach(p=>{t+=`  ${p.num}. ${tag(p.jid)} *(${p.name})*\n`;});
      if (game.dead.size) {
        t+=`\n💀 *Dead:*\n`;
        for (const d of [...game.dead.values()].sort((a,b)=>a.num-b.num)) {
          t+=`  ${d.num}. ${d.name}  –  ${ROLES[d.role]?.emoji} ${ROLES[d.role]?.name}\n`;
        }
      }
      await sendM(sock,from,t,aliveJids); return;
    }

    if (sub==='roles') {
      const teams={village:[],werewolf:[],neutral:[]};
      for (const [,r] of Object.entries(ROLES)) teams[r.team]?.push(`  ${r.emoji} *${r.name}*`);
      let t=`📜 *All Werewolf Roles*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      t+=`🏘️ *VILLAGE  (${teams.village.length})*\n${teams.village.join('\n')}\n\n`;
      t+=`🐺 *WEREWOLF  (${teams.werewolf.length})*\n${teams.werewolf.join('\n')}\n\n`;
      t+=`🎭 *NEUTRAL  (${teams.neutral.length})*\n${teams.neutral.join('\n')}\n\n`;
      t+=`_Use *.ww role [name]* for details._`;
      return reply(t);
    }

    if (sub==='role') {
      const query=args.slice(1).join(' ').toLowerCase().trim();
      if (!query) return reply('Usage: *.ww role [name]*');
      const found=Object.entries(ROLES).find(([k,r])=>r.name.toLowerCase()===query||k.toLowerCase()===query.replace(/ /g,'_'));
      if (!found) return reply(`❌ Role not found.`);
      const [,role]=found;
      const BN={village:'🏘️ VILLAGE',werewolf:'🐺 WEREWOLF',neutral:'🎭 NEUTRAL'};
      let t=`${role.emoji} *${role.name}*\n━━━━━━━━━━━━━━━━━━━━\n`;
      t+=`🏴 Team: *${BN[role.team]}*\n\n📋 *Ability:*\n${role.description}\n`;
      if (role.nightAction) t+=`\n🌙 Night action.\n`;
      if (role.deathAbility) t+=`💀 Death ability.\n`;
      if (role.doubleVote) t+=`🗳️ Double vote.\n`;
      if (role.winCondition) t+=`🎯 Special win condition.\n`;
      return reply(t);
    }

    if (sub==='redm') {
      const game=activeGames.get(from);
      if (!game || game.phase===PHASE.LOBBY || game.phase===PHASE.ENDED) {
        return reply('❌ No active game to resend your DM.');
      }
      const p = game.getByJid(sender);
      if (!p) return reply('❌ You are not in this game.');
      if (!p.alive) return reply('❌ You are dead — no DM needed.');

      if (game.phase === PHASE.NIGHT) {
        // Resend night action DM
        const dmText = game.buildNightDM(sender);
        if (!dmText) return reply('ℹ️ You have no night action.');
        try {
          await sock.sendMessage(sender, { text: dmText });
          return reply('✅ Night action DM resent — check your private messages.');
        } catch (_) {
          return reply('❌ Still unable to DM you. Please send *any message* to this bot in private chat first, then try again.');
        }
      } else {
        // Resend role DM
        try {
          await sock.sendMessage(sender, { text: game.buildRoleDM(sender) });
          return reply('✅ Role DM resent — check your private messages.');
        } catch (_) {
          return reply('❌ Still unable to DM you. Please send *any message* to this bot in private chat first, then try again.');
        }
      }
    }

    if (sub==='stats') {
      const game=activeGames.get(from)||new WerewolfGame(from,sock);
      return reply(game.getStatsText(sender));
    }

    if (sub==='top') return reply(WerewolfGame.buildLeaderboard());

    // ── Shorthand vote: during voting, ".ww 3" or ".ww @mention" works directly ──
    const game=activeGames.get(from);
    if (game && game.phase===PHASE.VOTING) {
      // Check if sub is a number → treat as vote
      const bareNum = parseInt(sub);
      if (!isNaN(bareNum) && bareNum > 0) {
        return reply(game.registerVote(sender, bareNum));
      }

      // Check if sub starts with @ → mention vote
      if (sub.startsWith('@')) {
        const mentionCtx = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid
                        || msg.message?.contextInfo?.mentionedJid
                        || [];
        if (mentionCtx.length > 0) {
          return reply(game.registerVote(sender, mentionCtx[0]));
        }
        const phone = sub.replace('@','').replace(/\D/g,'');
        if (phone) return reply(game.registerVote(sender, phone + '@s.whatsapp.net'));
      }
    }

    return reply(`❓ Unknown sub-command. Try *.ww help*`);
  }
};
