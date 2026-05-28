'use strict';

/**
 * Antiviewonce
 *
 * Commands:
 *   .antiviewonce on
 *   .antiviewonce off
 *   .antiviewonce set [kick | warn | delete]
 *   .antiviewonce limit [number]        ← set/view per-group warn limit for this feature
 *   .antiviewonce warnings @user
 *   .antiviewonce warn reset @user
 *   .antiviewonce status
 */

const database = require('../../database');

module.exports = {
  name: 'antiviewonce',
  aliases: ['avo'],
  category: 'admin',
  description: 'Antiviewonce — on/off/set/limit/warnings/status',
  usage: '.antiviewonce on | off | set [kick|warn|delete] | limit [n] | warnings @user | warn reset @user | status',
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
        const state    = settings.antiviewonce ? '✅ ON' : '❌ OFF';
        const mode     = settings.antiviewonceAction || 'warn';
        const maxWarns = database.getAntiWarnLimit(from, 'antiviewonce');
        return reply(
          '_*Antiviewonce Status*_\n\n' +
          '_*System    :*_ _*' + state + '*_\n' +
          '_*Mode      :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit:*_ _*' + maxWarns + ' warnings before kick*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antiviewonce on | off | status*_\n' +
          '  _*.antiviewonce set kick | warn | delete*_\n' +
          '  _*.antiviewonce limit <number>*_\n' +
          '  _*.antiviewonce warnings @user*_\n' +
          '  _*.antiviewonce warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antiviewonce: true,
          antiviewonceAction: settings.antiviewonceAction || 'warn',
        });
        return reply('_*Antiviewonce has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antiviewonce: false });
        return reply('_*Antiviewonce has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antiviewonce set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antiviewonceAction: sub });
        const responses = {
          kick:   '_*Antiviewonce action set to Kick 🥵*_',
          delete: '_*Antiviewonce action set to Delete 😳*_',
          warn:   '_*Antiviewonce action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antiviewonce');

        if (!sub) {
          return reply(
            '_*⚠️ Antiviewonce — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antiviewonce limit <number>*_\n' +
            '_*Example   :*_ _*.antiviewonce limit 2*_'
          );
        }

        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }

        database.setAntiWarnLimit(from, 'antiviewonce', newLimit);
        return reply(
          '_*✅ Antiviewonce Warn Limit Updated*_\n\n' +
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
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antiviewonce warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antiviewonce');
        const warnData  = database.getAntiWarnings(from, target, 'antiviewonce');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ Antiviewonce — Warning Check*_\n\n' +
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
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antiviewonce warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antiviewonce');
        database.clearAntiWarnings(from, target, 'antiviewonce');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            "_*" + userTag + "'s Antiviewonce warnings have been reset to 0/" + maxWarns + ".*_",
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antiviewonce on | off | status*_\n' +
        '  _*.antiviewonce set kick | warn | delete*_\n' +
        '  _*.antiviewonce limit <number>*_\n' +
        '  _*.antiviewonce warnings @user*_\n' +
        '  _*.antiviewonce warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
