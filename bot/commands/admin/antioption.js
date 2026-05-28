'use strict';

/**
 * .antioption — Bulk shortcut to control multiple anti features at once.
 *
 * Number mapping (matches the Admin Commands menu):
 *   1 = .antibot
 *   2 = .antichannel
 *   3 = .antilink
 *   4 = .antimedia
 *   5 = .antimessage spam
 *   6 = .antistatus
 *   7 = .antisticker
 *   8 = .antisticker spam
 *   9 = .antiviewonce
 *
 * Usage:
 *   .antioption on      <digits>          e.g. .antioption on 1234
 *   .antioption off     <digits>          e.g. .antioption off 79
 *   .antioption set     warn/kick/delete <digits>
 *   .antioption limit   <n> <digits>
 *   .antioption warnings      <digits> @user
 *   .antioption warn reset    <digits> @user
 *   .antioption status        <digits>
 *
 * All existing individual commands (e.g. .antibot, .antilink …) remain
 * completely unchanged — this is an extra shortcut layer only.
 */

const database = require('../../database');

// ── Feature map ───────────────────────────────────────────────────────────────
// Each entry defines:
//   label        human-readable name shown in replies
//   enableKey    the boolean key in groupSettings  (e.g. settings.antibot)
//   actionKey    the mode key in groupSettings      (e.g. settings.antibotAction)
//   defaultAction  fallback mode when the key is unset
//   featureType  key passed to getAntiWarnLimit / getAntiWarnings etc.
//   supportsWarnLimit  whether .antioption limit works for this feature
//                       (spam-only features use spamCount, not warnLimit)
//   supportsWarnings   whether .antioption warnings works for this feature

const FEATURE_MAP = {
  1: {
    label:              'Antibot',
    enableKey:          'antibot',
    actionKey:          'antibotAction',
    defaultAction:      'kick',
    featureType:        'antibot',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
  2: {
    label:              'Antichannel',
    enableKey:          'antichannel',
    actionKey:          'antichannelAction',
    defaultAction:      'warn',
    featureType:        'antichannel',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
  3: {
    label:              'Antilink',
    enableKey:          'antilink',
    actionKey:          'antilinkAction',
    defaultAction:      'warn',
    featureType:        'antilink',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
  4: {
    label:              'Antimedia',
    enableKey:          'antimedia',
    actionKey:          'antimediaAction',
    defaultAction:      'kick',
    featureType:        'antimedia',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
  5: {
    label:              'AntiMessage Spam',
    enableKey:          'antimessageSpam',
    actionKey:          'antimessageSpamAction',
    defaultAction:      'delete',
    featureType:        'antimessageSpam',
    supportsWarnLimit:  false,   // spam system uses spamCount/timegap, not warnLimit
    supportsWarnings:   false,
  },
  6: {
    label:              'Antistatus',
    enableKey:          'antistatus',
    actionKey:          'antistatusAction',
    defaultAction:      'warn',
    featureType:        'antistatus',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
  7: {
    label:              'Antisticker',
    enableKey:          'antisticker',
    actionKey:          'antistickerAction',
    defaultAction:      'warn',
    featureType:        'antisticker',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
  8: {
    label:              'AntiSticker Spam',
    enableKey:          'antistickerSpam',
    actionKey:          'antistickerSpamAction',
    defaultAction:      'delete',
    featureType:        'antistickerSpam',
    supportsWarnLimit:  false,
    supportsWarnings:   false,
  },
  9: {
    label:              'Antiviewonce',
    enableKey:          'antiviewonce',
    actionKey:          'antiviewonceAction',
    defaultAction:      'warn',
    featureType:        'antiviewonce',
    supportsWarnLimit:  true,
    supportsWarnings:   true,
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a digit string like "1247" into an array of unique, valid feature
 * objects. Invalid digits (0, non-existent) are silently skipped.
 */
function parseDigits(str) {
  const seen = new Set();
  const features = [];
  for (const ch of (str || '')) {
    const n = parseInt(ch, 10);
    if (FEATURE_MAP[n] && !seen.has(n)) {
      seen.add(n);
      features.push({ num: n, ...FEATURE_MAP[n] });
    }
  }
  return features;
}

/** Extract mentioned/quoted JID from a message */
function getMentioned(msg) {
  const mentioned = (
    msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
    msg.message?.contextInfo?.mentionedJid || []
  );
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
  return mentioned[0] || quoted || null;
}

/** Capitalise first letter */
function cap(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  name: 'antioption',
  aliases: ['ao'],
  category: 'admin',
  description: 'Bulk-control multiple anti features by number',
  usage: '.antioption on/off/set/limit/warnings/warn reset <digits> [@user]',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;
      const opt = (args[0] || '').toLowerCase();
      const sub = (args[1] || '').toLowerCase();

      // ── STATUS (show full number map) ──────────────────────────────────────
      if (!opt || opt === 'status') {
        const settings = database.getGroupSettings(from);
        let text = '_*AntiOption — Feature Map*_\n\n';
        for (let n = 1; n <= 9; n++) {
          const f     = FEATURE_MAP[n];
          const state = settings[f.enableKey] ? '✅ ON' : '❌ OFF';
          const mode  = settings[f.actionKey] || f.defaultAction;
          text += `_*${n}.*_ _*${f.label}*_ — _*${state}*_ / _*${cap(mode)}*_\n`;
        }
        text += '\n_*Commands:*_\n';
        text += '  _*.antioption on/off <digits>*_\n';
        text += '  _*.antioption set warn/kick/delete <digits>*_\n';
        text += '  _*.antioption limit <number> <digits>*_\n';
        text += '  _*.antioption warnings <digits> @user*_\n';
        text += '  _*.antioption warn reset <digits> @user*_\n';
        text += '  _*.antioption status*_\n\n';
        text += '_*Number map:*_\n';
        text += '  _*1=antibot  2=antichannel  3=antilink  4=antimedia*_\n';
        text += '  _*5=antimessage spam  6=antistatus*_\n';
        text += '  _*7=antisticker  8=antisticker spam  9=antiviewonce*_';
        return reply(text);
      }

      // ── ON ─────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        // .antioption on <digits>   →  args[1] is the digit string
        const features = parseDigits(sub || args[1]);
        if (!features.length) {
          return reply(
            '_*❌ Please specify which features to enable.*_\n\n' +
            '_*Usage: .antioption on <digits>*_\n' +
            '_*Example: .antioption on 1234*_'
          );
        }
        const settings = database.getGroupSettings(from);
        const update   = {};
        const lines    = [];
        for (const f of features) {
          update[f.enableKey]  = true;
          update[f.actionKey]  = settings[f.actionKey] || f.defaultAction;
          lines.push(`_*${f.num}. ${f.label}*_ → _*✅ Enabled*_`);
        }
        database.updateGroupSettings(from, update);
        return reply('_*AntiOption — Enabled*_\n\n' + lines.join('\n'));
      }

      // ── OFF ────────────────────────────────────────────────────────────────
      if (opt === 'off') {
        const features = parseDigits(sub || args[1]);
        if (!features.length) {
          return reply(
            '_*❌ Please specify which features to disable.*_\n\n' +
            '_*Usage: .antioption off <digits>*_\n' +
            '_*Example: .antioption off 1234*_'
          );
        }
        const update = {};
        const lines  = [];
        for (const f of features) {
          update[f.enableKey] = false;
          lines.push(`_*${f.num}. ${f.label}*_ → _*❌ Disabled*_`);
        }
        database.updateGroupSettings(from, update);
        return reply('_*AntiOption — Disabled*_\n\n' + lines.join('\n'));
      }

      // ── SET [warn | kick | delete] ─────────────────────────────────────────
      // Format: .antioption set <mode> <digits>
      if (opt === 'set') {
        const mode    = sub;   // args[1]
        const digits  = (args[2] || '');
        const validModes = ['kick', 'warn', 'delete'];

        if (!mode || !validModes.includes(mode)) {
          return reply(
            '_*❌ Please specify a valid mode.*_\n\n' +
            '_*Usage: .antioption set warn/kick/delete <digits>*_\n' +
            '_*Example: .antioption set warn 137*_'
          );
        }
        const features = parseDigits(digits);
        if (!features.length) {
          return reply(
            '_*❌ Please specify which features to update.*_\n\n' +
            '_*Usage: .antioption set ' + mode + ' <digits>*_\n' +
            '_*Example: .antioption set ' + mode + ' 1234*_'
          );
        }
        const update = {};
        const lines  = [];
        for (const f of features) {
          update[f.actionKey] = mode;
          lines.push(`_*${f.num}. ${f.label}*_ → _*${cap(mode)}*_`);
        }
        database.updateGroupSettings(from, update);
        return reply('_*AntiOption — Mode Set to ' + cap(mode) + '*_\n\n' + lines.join('\n'));
      }

      // ── LIMIT <n> <digits> ─────────────────────────────────────────────────
      // Format: .antioption limit <number> <digits>
      if (opt === 'limit') {
        const limitArg = sub;         // args[1]  — the new limit number
        const digits   = (args[2] || '');

        const newLimit = parseInt(limitArg, 10);
        if (isNaN(newLimit) || newLimit < 1 || newLimit > 20) {
          return reply(
            '_*❌ Invalid limit. Enter a number between 1 and 20.*_\n\n' +
            '_*Usage: .antioption limit <number> <digits>*_\n' +
            '_*Example: .antioption limit 5 137*_'
          );
        }
        const features = parseDigits(digits);
        if (!features.length) {
          return reply(
            '_*❌ Please specify which features to update.*_\n\n' +
            '_*Usage: .antioption limit ' + newLimit + ' <digits>*_\n' +
            '_*Example: .antioption limit ' + newLimit + ' 1234*_'
          );
        }
        const applied = [];
        const skipped = [];
        for (const f of features) {
          if (f.supportsWarnLimit) {
            database.setAntiWarnLimit(from, f.featureType, newLimit);
            applied.push(`_*${f.num}. ${f.label}*_ → _*${newLimit} warnings before kick*_`);
          } else {
            skipped.push(`_*${f.num}. ${f.label}*_ (uses spam count — use its own command)`);
          }
        }
        let text = '_*AntiOption — Warn Limit Updated*_\n\n';
        if (applied.length) text += applied.join('\n');
        if (skipped.length) text += '\n\n_*⚠️ Skipped (no warn limit):*_\n' + skipped.join('\n');
        return reply(text);
      }

      // ── WARNINGS <digits> @user ───────────────────────────────────────────
      // Format: .antioption warnings <digits> @user
      if (opt === 'warnings') {
        // digits = args[1], @user is a mention in the message
        const digits  = sub;   // args[1]
        const target  = getMentioned(msg);

        if (!digits) {
          return reply(
            '_*❌ Please specify feature digits.*_\n\n' +
            '_*Usage: .antioption warnings <digits> @user*_\n' +
            '_*Example: .antioption warnings 137 @user*_'
          );
        }
        if (!target) {
          return reply(
            '_*❌ Please mention a user.*_\n\n' +
            '_*Usage: .antioption warnings <digits> @user*_'
          );
        }

        const features   = parseDigits(digits);
        if (!features.length) {
          return reply('_*❌ No valid feature numbers found in: ' + digits + '*_');
        }

        const userTag = '@' + target.split('@')[0];
        let text = '_*AntiOption — Warnings for ' + userTag + '*_\n\n';

        const supported = features.filter(f => f.supportsWarnings);
        const unsupported = features.filter(f => !f.supportsWarnings);

        for (const f of supported) {
          const maxWarns  = database.getAntiWarnLimit(from, f.featureType);
          const warnData  = database.getAntiWarnings(from, target, f.featureType);
          const count     = warnData.count || 0;
          const remaining = Math.max(0, maxWarns - count);
          text += `_*${f.num}. ${f.label}*_ — _*${count}/${maxWarns}*_`;
          if (count >= maxWarns) {
            text += ' _*(⚠️ will be kicked next offence)*_';
          } else {
            text += ' _*(${remaining} remaining)*_'.replace('${remaining}', remaining);
          }
          text += '\n';
        }
        if (unsupported.length) {
          text += '\n_*⚠️ Skipped (no warn system):*_ ';
          text += unsupported.map(f => f.num + '.' + f.label).join(', ');
        }

        return sock.sendMessage(from, { text, mentions: [target] }, { quoted: msg });
      }

      // ── WARN RESET <digits> @user ─────────────────────────────────────────
      // Format: .antioption warn reset <digits> @user
      if (opt === 'warn' && sub === 'reset') {
        // digits = args[2]
        const digits = (args[2] || '');
        const target = getMentioned(msg);

        if (!digits) {
          return reply(
            '_*❌ Please specify feature digits.*_\n\n' +
            '_*Usage: .antioption warn reset <digits> @user*_\n' +
            '_*Example: .antioption warn reset 137 @user*_'
          );
        }
        if (!target) {
          return reply(
            '_*❌ Please mention a user.*_\n\n' +
            '_*Usage: .antioption warn reset <digits> @user*_'
          );
        }

        const features = parseDigits(digits);
        if (!features.length) {
          return reply('_*❌ No valid feature numbers found in: ' + digits + '*_');
        }

        const userTag    = '@' + target.split('@')[0];
        const resetLines = [];
        const skipLines  = [];

        for (const f of features) {
          if (f.supportsWarnings) {
            database.clearAntiWarnings(from, target, f.featureType);
            const maxWarns = database.getAntiWarnLimit(from, f.featureType);
            resetLines.push(`_*${f.num}. ${f.label}*_ → _*Reset to 0/${maxWarns}*_`);
          } else {
            skipLines.push(`_*${f.num}. ${f.label}*_ (no warn system)`);
          }
        }

        let text = '_*AntiOption — Warnings Reset for ' + userTag + '*_\n\n';
        if (resetLines.length) text += resetLines.join('\n');
        if (skipLines.length)  text += '\n\n_*⚠️ Skipped:*_\n' + skipLines.join('\n');

        return sock.sendMessage(from, { text, mentions: [target] }, { quoted: msg });
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        '_*❌ Unknown option.*_\n\n' +
        '_*Usage:*_\n' +
        '  _*.antioption on/off <digits>*_\n' +
        '  _*.antioption set warn/kick/delete <digits>*_\n' +
        '  _*.antioption limit <number> <digits>*_\n' +
        '  _*.antioption warnings <digits> @user*_\n' +
        '  _*.antioption warn reset <digits> @user*_\n' +
        '  _*.antioption status*_\n\n' +
        '_*1=antibot  2=antichannel  3=antilink  4=antimedia*_\n' +
        '_*5=antimessage spam  6=antistatus*_\n' +
        '_*7=antisticker  8=antisticker spam  9=antiviewonce*_'
      );

    } catch (error) {
      await extra.reply('_*❌ Error: ' + error.message + '*_');
    }
  },
};
