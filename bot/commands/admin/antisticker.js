'use strict';

/**
 * Antisticker
 *
 * Commands:
 *   .antisticker on
 *   .antisticker off
 *   .antisticker set [kick | warn | delete]
 *   .antisticker limit [number]        ← set/view per-group warn limit for this feature
 *   .antisticker warnings @user
 *   .antisticker warn reset @user
 *   .antisticker status
 *
 * NOTE: ".antisticker spam ..." is a completely separate spam-detection system.
 * Those sub-commands are delegated to antistickerspam.js.
 */

const database = require('../../database');
const antistickerSpam = require('./antistickerspam');

module.exports = {
  name: 'antisticker',
  aliases: ['antis'],
  category: 'admin',
  description: 'Antisticker — on/off/set/limit/warnings/status',
  usage: '.antisticker on | off | set [kick|warn|delete] | limit [n] | warnings @user | warn reset @user | status',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;
      const settings = database.getGroupSettings(from);
      const opt = (args[0] || '').toLowerCase();
      const sub = (args[1] || '').toLowerCase();

      // ── DELEGATE: ".antisticker spam ..." → separate spam system ──────────
      if (opt === 'spam') {
        return antistickerSpam.executeSpam(sock, msg, args, extra);
      }
      if (!opt || opt === 'status') {
        const state    = settings.antisticker ? '✅ ON' : '❌ OFF';
        const mode     = settings.antistickerAction || 'warn';
        const maxWarns = database.getAntiWarnLimit(from, 'antisticker');
        return reply(
          '_*Antisticker Status*_\n\n' +
          '_*System    :*_ _*' + state + '*_\n' +
          '_*Mode      :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit:*_ _*' + maxWarns + ' warnings before kick*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antisticker on | off | status*_\n' +
          '  _*.antisticker set kick | warn | delete*_\n' +
          '  _*.antisticker limit <number>*_\n' +
          '  _*.antisticker warnings @user*_\n' +
          '  _*.antisticker warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antisticker: true,
          antistickerAction: settings.antistickerAction || 'warn',
        });
        return reply('_*Antisticker has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antisticker: false });
        return reply('_*Antisticker has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antisticker set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antistickerAction: sub });
        const responses = {
          kick:   '_*Antisticker action set to Kick 🥵*_',
          delete: '_*Antisticker action set to Delete 😳*_',
          warn:   '_*Antisticker action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antisticker');

        if (!sub) {
          return reply(
            '_*⚠️ Antisticker — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antisticker limit <number>*_\n' +
            '_*Example   :*_ _*.antisticker limit 2*_'
          );
        }

        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }

        database.setAntiWarnLimit(from, 'antisticker', newLimit);
        return reply(
          '_*✅ Antisticker Warn Limit Updated*_\n\n' +
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
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antisticker warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antisticker');
        const warnData  = database.getAntiWarnings(from, target, 'antisticker');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ Antisticker — Warning Check*_\n\n' +
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
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antisticker warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antisticker');
        database.clearAntiWarnings(from, target, 'antisticker');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            "_*" + userTag + "'s Antisticker warnings have been reset to 0/" + maxWarns + ".*_",
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antisticker on | off | status*_\n' +
        '  _*.antisticker set kick | warn | delete*_\n' +
        '  _*.antisticker limit <number>*_\n' +
        '  _*.antisticker warnings @user*_\n' +
        '  _*.antisticker warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
