/**
 * Warn Command — Warn a user in a group.
 *
 * Subcommands:
 *   .warn @user [reason]       — Add a warning to a user
 *   .warn limit <number>       — Set the warn limit for THIS group (default 3)
 *   .warn limit                — Show current warn limit for this group
 */

'use strict';

const database = require('../../database');

module.exports = {
  name: 'warn',
  aliases: ['warning'],
  category: 'admin',
  description: 'Warn a user. Also lets admins set/view the warn limit for this group.',
  usage: '.warn @user [reason] | .warn limit [number]',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;

      // ── .warn limit [n] ───────────────────────────────────────────────────
      if ((args[0] || '').toLowerCase() === 'limit') {
        const current = database.getWarnLimit(from);

        if (!args[1]) {
          // Just show current limit
          return reply(
            `_*⚠️ Warn Limit — This Group*_\n\n` +
            `_*Current limit :*_ _*${current} warnings*_\n\n` +
            `_*To change:*_ _*.warn limit <number>*_\n` +
            `_*Example    :*_ _*.warn limit 5*_`
          );
        }

        const newLimit = parseInt(args[1], 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply(`_*❌ Invalid limit. Please enter a number between 1 and 20.*_`);
        }

        database.setWarnLimit(from, newLimit);
        return reply(
          `_*✅ Warn Limit Updated*_\n\n` +
          `_*New limit :*_ _*${newLimit} warnings before kick*_\n` +
          `_*Scope     :*_ _*This group only*_`
        );
      }

      // ── .warn @user [reason] ─────────────────────────────────────────────
      let target;
      const ctx       = msg.message?.extendedTextMessage?.contextInfo;
      const mentioned = ctx?.mentionedJid || [];

      if (mentioned.length > 0) {
        target = mentioned[0];
      } else if (ctx?.participant && ctx.stanzaId && ctx.quotedMessage) {
        target = ctx.participant;
      } else {
        return reply(
          `_*❌ Please mention or reply to the user to warn!*_\n\n` +
          `_*Usage: .warn @user [reason]*_`
        );
      }

      const reason = args.slice(mentioned.length > 0 ? 1 : 0).join(' ') || 'No reason specified';

      // Cannot warn admins
      const isAdmin = extra.groupMetadata.participants.find(
        p => (p.id === target || p.lid === target) &&
             (p.admin === 'admin' || p.admin === 'superadmin')
      );
      if (isAdmin) {
        return reply(`_*❌ Cannot warn an admin!*_`);
      }

      const maxWarns  = database.getWarnLimit(from);
      const warnData  = database.addWarning(from, target, reason);
      const warnCount = warnData.count;
      const remaining = maxWarns - warnCount;
      const userTag   = `@${target.split('@')[0]}`;

      let text = `_*⚠️ USER WARNING*_\n\n`;
      text += `_*👤 User     :*_ _*${userTag}*_\n`;
      text += `_*📝 Reason   :*_ _*${reason}*_\n`;
      text += `_*⚠️ Warnings :*_ _*${warnCount}/${maxWarns}*_\n\n`;

      if (warnCount >= maxWarns) {
        text += `_*❌ User has reached the warning limit and will be removed!*_`;

        await sock.sendMessage(from, { text, mentions: [target] }, { quoted: msg });

        if (extra.isBotAdmin) {
          await sock.groupParticipantsUpdate(from, [target], 'remove');
          database.clearWarnings(from, target);
        }
      } else {
        text += `_*📊 Remaining : ${remaining} warning${remaining === 1 ? '' : 's'} before kick*_`;
        await sock.sendMessage(from, { text, mentions: [target] }, { quoted: msg });
      }

    } catch (error) {
      await extra.reply(`_*❌ Error: ${error.message}*_`);
    }
  },
};
