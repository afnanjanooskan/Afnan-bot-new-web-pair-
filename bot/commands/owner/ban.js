/**
 * Ban / Unban System — Owner Only
 *
 * Usage:
 *   .ban user          → reply to or mention a user to ban them
 *   .ban number 94771234567
 *   .unban user        → reply to or mention a user to unban them
 *   .unban number 94771234567
 *
 * Rules:
 *  - Owner only (ownerOnly: true)
 *  - Owner is ALWAYS bypassed from the ban check in handler.js
 *  - Banned users cannot use ANY bot command in groups OR DMs
 *  - Bans survive bot restarts (stored in database/banned.json)
 */

const database = require('../../database');

// ── Resolve target JID from reply / mention / raw number ─────────────────────
function resolveTarget(msg, args) {
  // 1. Quoted (replied-to) message sender
  const quoted =
    msg.message?.extendedTextMessage?.contextInfo?.participant ||
    msg.message?.extendedTextMessage?.contextInfo?.remoteJid   ||
    msg.message?.imageMessage?.contextInfo?.participant         ||
    msg.message?.videoMessage?.contextInfo?.participant;

  if (quoted) return quoted;

  // 2. First @mention in the message
  const mentions =
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    msg.message?.contextInfo?.mentionedJid;

  if (mentions && mentions.length > 0) return mentions[0];

  // 3. Inline number after subcommand (e.g. ".ban number 94771234567")
  const sub = (args[0] || '').toLowerCase();
  if (sub === 'number' && args[1]) {
    const clean = args[1].replace(/[^0-9]/g, '');
    if (clean.length >= 7) return `${clean}@s.whatsapp.net`;
  }

  return null;
}

module.exports = {
  name: 'ban',
  aliases: ['unban'],
  category: 'owner',
  description: 'Ban or unban a user from using the bot',
  usage: '.ban user | .ban number <num> | .unban user | .unban number <num>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;

    // Determine action from the command name that triggered execution
    const rawBody  = extra.rawBody || '';
    const cmdUsed  = rawBody.trim().split(/\s+/)[0].replace(/^\./, '').toLowerCase();
    const isBanCmd = cmdUsed === 'ban';

    const target = resolveTarget(msg, args);

    if (!target) {
      return reply(
        isBanCmd
          ? '❌ Please reply to a message, mention a user, or use:\n*.ban number <phone>*'
          : '❌ Please reply to a message, mention a user, or use:\n*.unban number <phone>*'
      );
    }

    const number    = target.split('@')[0].replace(/[^0-9]/g, '');
    const displayId = `+${number}`;

    if (isBanCmd) {
      // ── BAN ────────────────────────────────────────────────────────────────
      const ok = database.banNumber(number);
      if (!ok) {
        return reply(`⚠️ *${displayId}* is already banned.`);
      }
      return reply(
        `✅ *${displayId}* has been banned from using this bot.\n\n` +
        `They cannot use any commands in groups or DMs.\n` +
        `Use *.unban number ${number}* to remove the ban.`
      );
    } else {
      // ── UNBAN ──────────────────────────────────────────────────────────────
      const ok = database.unbanNumber(number);
      if (!ok) {
        return reply(`⚠️ *${displayId}* is not in the ban list.`);
      }
      return reply(`✅ *${displayId}* has been unbanned and can now use the bot again.`);
    }
  }
};
