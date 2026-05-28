'use strict';

/**
 * AntiSticker Spam
 *
 * Commands:
 *   .antisticker spam on
 *   .antisticker spam off
 *   .antisticker spam status
 *   .antisticker spam set [kick | warn | delete]
 *   .antisticker spam limit [number]
 *   .antisticker spam count [number]
 *   .antisticker spam timegap [seconds]
 *   .antisticker spam warnings @user
 *   .antisticker spam warn reset @user
 */

const database = require('../../database');

module.exports = {
  name: 'antistickerspam',
  aliases: ['asm'],
  category: 'admin',
  description: 'AntiSticker Spam — detect and act on sticker spam in groups',
  usage: '.antisticker spam on | off | status | set [kick|warn|delete] | limit [n] | count [n] | timegap [s] | warnings @user | warn reset @user',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;
      const settings = database.getGroupSettings(from);

      // Must always have "spam" as first arg
      const sub0 = (args[0] || '').toLowerCase();
      if (sub0 !== 'spam') {
        return reply(
          '_*❌ Invalid usage.*_\n\n' +
          '_*Usage:*_\n' +
          '  _*.antisticker spam on | off | status*_\n' +
          '  _*.antisticker spam set kick | warn | delete*_\n' +
          '  _*.antisticker spam limit <number>*_\n' +
          '  _*.antisticker spam count <number>*_\n' +
          '  _*.antisticker spam timegap <seconds>*_\n' +
          '  _*.antisticker spam warnings @user*_\n' +
          '  _*.antisticker spam warn reset @user*_'
        );
      }

      const opt = (args[1] || '').toLowerCase();
      const sub = (args[2] || '').toLowerCase();

      // ── STATUS ────────────────────────────────────────────────────────────
      if (!opt || opt === 'status') {
        const state      = settings.antistickerSpam ? '✅ ON' : '❌ OFF';
        const mode       = settings.antistickerSpamAction || 'delete';
        const maxWarns   = database.getAntiWarnLimit(from, 'antistickerSpam');
        const spamCount  = settings.antistickerSpamCount  ?? 6;
        const timeGap    = settings.antistickerSpamTimegap ?? 3;
        return reply(
          '_*AntiSticker Spam Status*_\n\n' +
          '_*System     :*_ _*' + state + '*_\n' +
          '_*Mode       :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit :*_ _*' + maxWarns + ' warnings before kick*_\n' +
          '_*Spam Count :*_ _*' + spamCount + ' stickers*_\n' +
          '_*Time Gap   :*_ _*' + timeGap + ' seconds*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antisticker spam on | off | status*_\n' +
          '  _*.antisticker spam set kick | warn | delete*_\n' +
          '  _*.antisticker spam limit <number>*_\n' +
          '  _*.antisticker spam count <number>*_\n' +
          '  _*.antisticker spam timegap <seconds>*_\n' +
          '  _*.antisticker spam warnings @user*_\n' +
          '  _*.antisticker spam warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antistickerSpam: true,
          antistickerSpamAction: settings.antistickerSpamAction || 'delete',
        });
        return reply('_*AntiSticker Spam has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antistickerSpam: false });
        return reply('_*AntiSticker Spam has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antisticker spam set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antistickerSpamAction: sub });
        const responses = {
          kick:   '_*AntiSticker Spam action set to Kick 🥵*_',
          delete: '_*AntiSticker Spam action set to Delete 😳*_',
          warn:   '_*AntiSticker Spam action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antistickerSpam');
        if (!sub) {
          return reply(
            '_*⚠️ AntiSticker Spam — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antisticker spam limit <number>*_\n' +
            '_*Example   :*_ _*.antisticker spam limit 3*_'
          );
        }
        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }
        database.setAntiWarnLimit(from, 'antistickerSpam', newLimit);
        return reply(
          '_*✅ AntiSticker Spam Warn Limit Updated*_\n\n' +
          '_*New limit :*_ _*' + newLimit + ' warnings before kick*_\n' +
          '_*Scope     :*_ _*This group only*_'
        );
      }

      // ── COUNT [n] ─────────────────────────────────────────────────────────
      if (opt === 'count') {
        const current = settings.antistickerSpamCount ?? 6;
        if (!sub) {
          return reply(
            '_*⚠️ AntiSticker Spam — Spam Count*_\n\n' +
            '_*Current count :*_ _*' + current + ' stickers*_\n' +
            '_*Meaning       :*_ _*If a user sends ' + current + ' stickers within the time gap, action is taken.*_\n\n' +
            '_*To change:*_ _*.antisticker spam count <number>*_\n' +
            '_*Example   :*_ _*.antisticker spam count 6*_'
          );
        }
        const newCount = parseInt(sub, 10);
        if (isNaN(newCount) || newCount < 2 || newCount > 50) {
          return reply('_*❌ Invalid count. Enter a number between 2 and 50.*_');
        }
        database.updateGroupSettings(from, { antistickerSpamCount: newCount });
        return reply(
          '_*✅ AntiSticker Spam Count Updated*_\n\n' +
          '_*New count :*_ _*' + newCount + ' stickers*_\n' +
          '_*Meaning   :*_ _*Action will be taken after ' + newCount + ' stickers within the time gap.*_'
        );
      }

      // ── TIMEGAP [seconds] ─────────────────────────────────────────────────
      if (opt === 'timegap') {
        const current = settings.antistickerSpamTimegap ?? 3;
        if (!sub) {
          return reply(
            '_*⚠️ AntiSticker Spam — Time Gap*_\n\n' +
            '_*Current gap :*_ _*' + current + ' seconds*_\n' +
            '_*Meaning     :*_ _*User must wait ' + current + 's before sending another sticker. Sending faster counts as spam.*_\n\n' +
            '_*To change:*_ _*.antisticker spam timegap <seconds>*_\n' +
            '_*Example   :*_ _*.antisticker spam timegap 3*_'
          );
        }
        const newGap = parseInt(sub, 10);
        if (isNaN(newGap) || newGap < 1 || newGap > 60) {
          return reply('_*❌ Invalid time gap. Enter a number between 1 and 60 seconds.*_');
        }
        database.updateGroupSettings(from, { antistickerSpamTimegap: newGap });
        return reply(
          '_*✅ AntiSticker Spam Time Gap Updated*_\n\n' +
          '_*New gap :*_ _*' + newGap + ' seconds*_\n' +
          '_*Meaning :*_ _*Users must wait ' + newGap + 's between stickers or spam counter increases.*_'
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
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antisticker spam warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antistickerSpam');
        const warnData  = database.getAntiWarnings(from, target, 'antistickerSpam');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ AntiSticker Spam — Warning Check*_\n\n' +
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
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antisticker spam warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antistickerSpam');
        database.clearAntiWarnings(from, target, 'antistickerSpam');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            '_*' + userTag + "'s AntiSticker Spam warnings have been reset to 0/" + maxWarns + '.*_',
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antisticker spam on | off | status*_\n' +
        '  _*.antisticker spam set kick | warn | delete*_\n' +
        '  _*.antisticker spam limit <number>*_\n' +
        '  _*.antisticker spam count <number>*_\n' +
        '  _*.antisticker spam timegap <seconds>*_\n' +
        '  _*.antisticker spam warnings @user*_\n' +
        '  _*.antisticker spam warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};

// ── Exported helper so antisticker.js can delegate ".antisticker spam ..." here ──
module.exports.executeSpam = module.exports.execute;
