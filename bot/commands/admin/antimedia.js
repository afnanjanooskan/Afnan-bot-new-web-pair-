'use strict';

/**
 * Antimedia
 *
 * Commands:
 *   .antimedia on
 *   .antimedia off
 *   .antimedia set [kick | warn | delete]
 *   .antimedia limit [number]        ← set/view per-group warn limit for this feature
 *   .antimedia warnings @user
 *   .antimedia warn reset @user
 *   .antimedia status
 */

const database = require('../../database');

module.exports = {
  name: 'antimedia',
  aliases: ['amedia'],
  category: 'admin',
  description: 'Antimedia — on/off/set/limit/warnings/status',
  usage: '.antimedia on | off | set [kick|warn|delete] | limit [n] | warnings @user | warn reset @user | status',
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
        const state    = settings.antimedia ? '✅ ON' : '❌ OFF';
        const mode     = settings.antimediaAction || 'kick';
        const maxWarns = database.getAntiWarnLimit(from, 'antimedia');
        return reply(
          '_*Antimedia Status*_\n\n' +
          '_*System    :*_ _*' + state + '*_\n' +
          '_*Mode      :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit:*_ _*' + maxWarns + ' warnings before kick*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antimedia on | off | status*_\n' +
          '  _*.antimedia set kick | warn | delete*_\n' +
          '  _*.antimedia limit <number>*_\n' +
          '  _*.antimedia warnings @user*_\n' +
          '  _*.antimedia warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antimedia: true,
          antimediaAction: settings.antimediaAction || 'kick',
        });
        return reply('_*Antimedia has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antimedia: false });
        return reply('_*Antimedia has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antimedia set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antimediaAction: sub });
        const responses = {
          kick:   '_*Antimedia action set to Kick 🥵*_',
          delete: '_*Antimedia action set to Delete 😳*_',
          warn:   '_*Antimedia action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antimedia');

        if (!sub) {
          return reply(
            '_*⚠️ Antimedia — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antimedia limit <number>*_\n' +
            '_*Example   :*_ _*.antimedia limit 2*_'
          );
        }

        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }

        database.setAntiWarnLimit(from, 'antimedia', newLimit);
        return reply(
          '_*✅ Antimedia Warn Limit Updated*_\n\n' +
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
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antimedia warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antimedia');
        const warnData  = database.getAntiWarnings(from, target, 'antimedia');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ Antimedia — Warning Check*_\n\n' +
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
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antimedia warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antimedia');
        database.clearAntiWarnings(from, target, 'antimedia');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            "_*" + userTag + "'s Antimedia warnings have been reset to 0/" + maxWarns + ".*_",
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antimedia on | off | status*_\n' +
        '  _*.antimedia set kick | warn | delete*_\n' +
        '  _*.antimedia limit <number>*_\n' +
        '  _*.antimedia warnings @user*_\n' +
        '  _*.antimedia warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
