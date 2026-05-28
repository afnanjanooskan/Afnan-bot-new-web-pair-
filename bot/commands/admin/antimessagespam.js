'use strict';

/**
 * AntiMessage Spam
 *
 * Commands:
 *   .antimessage spam on
 *   .antimessage spam off
 *   .antimessage spam status
 *   .antimessage spam set [kick | warn | delete]
 *   .antimessage spam limit [number]
 *   .antimessage spam count [number]
 *   .antimessage spam timegap [seconds]
 *   .antimessage spam warnings @user
 *   .antimessage spam warn reset @user
 */

const database = require('../../database');

module.exports = {
  name: 'antimessage',
  aliases: ['amsg', 'antims'],
  category: 'admin',
  description: 'AntiMessage Spam — detect and act on message spam in groups',
  usage: '.antimessage spam on | off | status | set [kick|warn|delete] | limit [n] | count [n] | timegap [s] | warnings @user | warn reset @user',
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
          '  _*.antimessage spam on | off | status*_\n' +
          '  _*.antimessage spam set kick | warn | delete*_\n' +
          '  _*.antimessage spam limit <number>*_\n' +
          '  _*.antimessage spam count <number>*_\n' +
          '  _*.antimessage spam timegap <seconds>*_\n' +
          '  _*.antimessage spam warnings @user*_\n' +
          '  _*.antimessage spam warn reset @user*_'
        );
      }

      const opt = (args[1] || '').toLowerCase();
      const sub = (args[2] || '').toLowerCase();

      // ── STATUS ────────────────────────────────────────────────────────────
      if (!opt || opt === 'status') {
        const state     = settings.antimessageSpam ? '✅ ON' : '❌ OFF';
        const mode      = settings.antimessageSpamAction || 'delete';
        const maxWarns  = database.getAntiWarnLimit(from, 'antimessageSpam');
        const spamCount = settings.antimessageSpamCount  ?? 6;
        const timeGap   = settings.antimessageSpamTimegap ?? 3;
        return reply(
          '_*AntiMessage Spam Status*_\n\n' +
          '_*System     :*_ _*' + state + '*_\n' +
          '_*Mode       :*_ _*' + mode.charAt(0).toUpperCase() + mode.slice(1) + '*_\n' +
          '_*Warn Limit :*_ _*' + maxWarns + ' warnings before kick*_\n' +
          '_*Spam Count :*_ _*' + spamCount + ' messages*_\n' +
          '_*Time Gap   :*_ _*' + timeGap + ' seconds*_\n\n' +
          '_*Commands:*_\n' +
          '  _*.antimessage spam on | off | status*_\n' +
          '  _*.antimessage spam set kick | warn | delete*_\n' +
          '  _*.antimessage spam limit <number>*_\n' +
          '  _*.antimessage spam count <number>*_\n' +
          '  _*.antimessage spam timegap <seconds>*_\n' +
          '  _*.antimessage spam warnings @user*_\n' +
          '  _*.antimessage spam warn reset @user*_'
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, {
          antimessageSpam: true,
          antimessageSpamAction: settings.antimessageSpamAction || 'delete',
        });
        return reply('_*AntiMessage Spam has been successfully enabled ⚠️*_');
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { antimessageSpam: false });
        return reply('_*AntiMessage Spam has been successfully disabled 🥲*_');
      }

      // ── SET [kick | warn | delete] ────────────────────────────────────────
      if (opt === 'set') {
        const validModes = ['kick', 'warn', 'delete'];
        if (!sub || !validModes.includes(sub)) {
          return reply('_*❌ Please specify a valid mode.*_\n\n_*Usage: .antimessage spam set kick | warn | delete*_');
        }
        database.updateGroupSettings(from, { antimessageSpamAction: sub });
        const responses = {
          kick:   '_*AntiMessage Spam action set to Kick 🥵*_',
          delete: '_*AntiMessage Spam action set to Delete 😳*_',
          warn:   '_*AntiMessage Spam action set to Warn ⚡*_',
        };
        return reply(responses[sub]);
      }

      // ── LIMIT [n] ─────────────────────────────────────────────────────────
      if (opt === 'limit') {
        const current = database.getAntiWarnLimit(from, 'antimessageSpam');
        if (!sub) {
          return reply(
            '_*⚠️ AntiMessage Spam — Warn Limit*_\n\n' +
            '_*Current limit :*_ _*' + current + ' warnings before kick*_\n\n' +
            '_*To change:*_ _*.antimessage spam limit <number>*_\n' +
            '_*Example   :*_ _*.antimessage spam limit 3*_'
          );
        }
        const newLimit = parseInt(sub, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply('_*❌ Invalid limit. Enter a number between 1 and 20.*_');
        }
        database.setAntiWarnLimit(from, 'antimessageSpam', newLimit);
        return reply(
          '_*✅ AntiMessage Spam Warn Limit Updated*_\n\n' +
          '_*New limit :*_ _*' + newLimit + ' warnings before kick*_\n' +
          '_*Scope     :*_ _*This group only*_'
        );
      }

      // ── COUNT [n] ─────────────────────────────────────────────────────────
      if (opt === 'count') {
        const current = settings.antimessageSpamCount ?? 6;
        if (!sub) {
          return reply(
            '_*⚠️ AntiMessage Spam — Spam Count*_\n\n' +
            '_*Current count :*_ _*' + current + ' messages*_\n' +
            '_*Meaning       :*_ _*If a user sends ' + current + ' messages within the time gap, action is taken.*_\n\n' +
            '_*To change:*_ _*.antimessage spam count <number>*_\n' +
            '_*Example   :*_ _*.antimessage spam count 6*_'
          );
        }
        const newCount = parseInt(sub, 10);
        if (isNaN(newCount) || newCount < 2 || newCount > 50) {
          return reply('_*❌ Invalid count. Enter a number between 2 and 50.*_');
        }
        database.updateGroupSettings(from, { antimessageSpamCount: newCount });
        return reply(
          '_*✅ AntiMessage Spam Count Updated*_\n\n' +
          '_*New count :*_ _*' + newCount + ' messages*_\n' +
          '_*Meaning   :*_ _*Action will be taken after ' + newCount + ' messages within the time gap.*_'
        );
      }

      // ── TIMEGAP [seconds] ─────────────────────────────────────────────────
      if (opt === 'timegap') {
        const current = settings.antimessageSpamTimegap ?? 3;
        if (!sub) {
          return reply(
            '_*⚠️ AntiMessage Spam — Time Gap*_\n\n' +
            '_*Current gap :*_ _*' + current + ' seconds*_\n' +
            '_*Meaning     :*_ _*User must wait ' + current + 's before sending another message. Sending faster counts as spam.*_\n\n' +
            '_*To change:*_ _*.antimessage spam timegap <seconds>*_\n' +
            '_*Example   :*_ _*.antimessage spam timegap 3*_'
          );
        }
        const newGap = parseInt(sub, 10);
        if (isNaN(newGap) || newGap < 1 || newGap > 60) {
          return reply('_*❌ Invalid time gap. Enter a number between 1 and 60 seconds.*_');
        }
        database.updateGroupSettings(from, { antimessageSpamTimegap: newGap });
        return reply(
          '_*✅ AntiMessage Spam Time Gap Updated*_\n\n' +
          '_*New gap :*_ _*' + newGap + ' seconds*_\n' +
          '_*Meaning :*_ _*Users must wait ' + newGap + 's between messages or spam counter increases.*_'
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
          return reply('_*❌ Please mention a user to check their warnings.*_\n\n_*Usage: .antimessage spam warnings @user*_');
        }

        const maxWarns  = database.getAntiWarnLimit(from, 'antimessageSpam');
        const warnData  = database.getAntiWarnings(from, target, 'antimessageSpam');
        const count     = warnData.count || 0;
        const remaining = maxWarns - count;
        const userTag   = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*⚠️ AntiMessage Spam — Warning Check*_\n\n' +
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
          return reply('_*❌ Please mention a user to reset their warnings.*_\n\n_*Usage: .antimessage spam warn reset @user*_');
        }

        const maxWarns = database.getAntiWarnLimit(from, 'antimessageSpam');
        database.clearAntiWarnings(from, target, 'antimessageSpam');
        const userTag = '@' + target.split('@')[0];

        return sock.sendMessage(from, {
          text:
            '_*✅ Warnings Reset*_\n\n' +
            '_*' + userTag + "'s AntiMessage Spam warnings have been reset to 0/" + maxWarns + '.*_',
          mentions: [target],
        }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antimessage spam on | off | status*_\n' +
        '  _*.antimessage spam set kick | warn | delete*_\n' +
        '  _*.antimessage spam limit <number>*_\n' +
        '  _*.antimessage spam count <number>*_\n' +
        '  _*.antimessage spam timegap <seconds>*_\n' +
        '  _*.antimessage spam warnings @user*_\n' +
        '  _*.antimessage spam warn reset @user*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
