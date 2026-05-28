'use strict';

/**
 * Antichannel
 *
 * Commands:
 *   .antichannel on
 *   .antichannel off
 *   .antichannel set [kick | warn | delete]
 *   .antichannel limit [number]        ← set/view per-group warn limit for this feature
 *   .antichannel warnings @user
 *   .antichannel warn reset @user
 *   .antichannel status
 */

const database = require('../../database');

module.exports = {
  name: 'antichannel',
  aliases: ['antich'],
  category: 'admin',
  description: 'Antichannel — on/off/set/limit/warnings/status',
  usage: '.antichannel on | off | set [kick|warn|delete] | limit [n] | warnings @user | warn reset @user | status',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;
      const settings = database.getGroupSettings(from);
      const opt = (args[0] || '').toLowerCase();
      const sub = (args[1] || '').toLowerCase();

      // ── STATUS ────────────────────────────────────────────────────────────
      if (!opt || opt === 'status') {
        const state    = settings.antichannel ? '✅ ON' : '❌ OFF';
        const mode     = settings.antichannelAction || 'warn';
        const maxWarns = database.getAntiWarnLimit(from, 'antichannel');
        return reply(
          '_*Antichannel Status*_\n\n' +
          '_*System    :*_ _*' + state + '*_\n' +
          '_*Mode      :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit:*_ _*' + maxWarns + ' warnings before kick*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antichannel on | off | status*_\n' +
          '  _*.antichannel set kick | warn | delete*_\n' +
          '  _*.antichannel limit <number>*_\n' +
          '  _*.antichannel warnings @user*_\n' +
          '  _*.antichannel warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antichannel: true,
          antichannelAction: settings.antichannelAction || 'warn',
        });
        return reply('_*Antichannel has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antichannel: false });
        return reply('_*Antichannel has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antichannel set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antichannelAction: sub });
        const responses = {
          kick:   '_*Antichannel action set to Kick 🥵*_',
          delete: '_*Antichannel action set to Delete 😳*_',
          warn:   '_*Antichannel action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antichannel');

        if (!sub) {
          return reply(
            '_*⚠️ Antichannel — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antichannel limit <number>*_\n' +
            '_*Example   :*_ _*.antichannel limit 2*_'
          );
        }

        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }

        database.setAntiWarnLimit(from, 'antichannel', newLimit);
        return reply(
          '_*✅ Antichannel Warn Limit Updated*_\n\n' +
          '_*New limit :*_ _*' + newLimit + ' warnings before kick*_\n' +
          '_*Scope     :*_ _*This group only*_'
        );
      }

      // ── WARNINGS @user ────────────────────────────────────────────────────
      if (opt === 'warnings') {
        const mentioned = (
          msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
          msg.message?.contextInfo?.mentionedJid || []
        );
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
        const target = mentioned[0] || quoted;

        if (!target) {
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antichannel warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antichannel');
        const warnData  = database.getAntiWarnings(from, target, 'antichannel');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ Antichannel — Warning Check*_\n\n' +
            '_*👤 User      :*_ _*' + userTag + '*_\n' +
            '_*⚠️ Warnings  :*_ _*' + count + '/' + maxWarns + '*_\n' +
            (count < maxWarns
              ? '_*📊 Remaining : ' + remaining + ' warning' + (remaining === 1 ? '' : 's') + ' before kick*_'
              : '_*🚫 This user will be kicked on next offence!*_'),
          mentions: [target],
        }, { quoted: msg });
      }

      // ── WARN RESET @user ──────────────────────────────────────────────────
      if (opt === 'warn' && sub === 'reset') {
        const mentioned = (
          msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
          msg.message?.contextInfo?.mentionedJid || []
        );
        const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
        const target = mentioned[0] || quoted;

        if (!target) {
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antichannel warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antichannel');
        database.clearAntiWarnings(from, target, 'antichannel');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            "_*" + userTag + "'s Antichannel warnings have been reset to 0/" + maxWarns + ".*_",
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antichannel on | off | status*_\n' +
        '  _*.antichannel set kick | warn | delete*_\n' +
        '  _*.antichannel limit <number>*_\n' +
        '  _*.antichannel warnings @user*_\n' +
        '  _*.antichannel warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
