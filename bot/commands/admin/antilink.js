'use strict';

/**
 * Antilink
 *
 * Commands:
 *   .antilink on
 *   .antilink off
 *   .antilink set [kick | warn | delete]
 *   .antilink limit [number]        ← set/view per-group warn limit for this feature
 *   .antilink warnings @user
 *   .antilink warn reset @user
 *   .antilink status
 */

const database = require('../../database');

module.exports = {
  name: 'antilink',
  aliases: ['al'],
  category: 'admin',
  description: 'Antilink — on/off/set/limit/warnings/status',
  usage: '.antilink on | off | set [kick|warn|delete] | limit [n] | warnings @user | warn reset @user | status',
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
        const state    = settings.antilink ? '✅ ON' : '❌ OFF';
        const mode     = settings.antilinkAction || 'warn';
        const maxWarns = database.getAntiWarnLimit(from, 'antilink');
        return reply(
          '_*Antilink Status*_\n\n' +
          '_*System    :*_ _*' + state + '*_\n' +
          '_*Mode      :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit:*_ _*' + maxWarns + ' warnings before kick*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antilink on | off | status*_\n' +
          '  _*.antilink set kick | warn | delete*_\n' +
          '  _*.antilink limit <number>*_\n' +
          '  _*.antilink warnings @user*_\n' +
          '  _*.antilink warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antilink: true,
          antilinkAction: settings.antilinkAction || 'warn',
        });
        return reply('_*Antilink has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antilink: false });
        return reply('_*Antilink has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antilink set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antilinkAction: sub });
        const responses = {
          kick:   '_*Antilink action set to Kick 🥵*_',
          delete: '_*Antilink action set to Delete 😳*_',
          warn:   '_*Antilink action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antilink');

        if (!sub) {
          return reply(
            '_*⚠️ Antilink — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antilink limit <number>*_\n' +
            '_*Example   :*_ _*.antilink limit 2*_'
          );
        }

        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }

        database.setAntiWarnLimit(from, 'antilink', newLimit);
        return reply(
          '_*✅ Antilink Warn Limit Updated*_\n\n' +
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
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antilink warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antilink');
        const warnData  = database.getAntiWarnings(from, target, 'antilink');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ Antilink — Warning Check*_\n\n' +
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
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antilink warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antilink');
        database.clearAntiWarnings(from, target, 'antilink');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            "_*" + userTag + "'s Antilink warnings have been reset to 0/" + maxWarns + ".*_",
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antilink on | off | status*_\n' +
        '  _*.antilink set kick | warn | delete*_\n' +
        '  _*.antilink limit <number>*_\n' +
        '  _*.antilink warnings @user*_\n' +
        '  _*.antilink warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
