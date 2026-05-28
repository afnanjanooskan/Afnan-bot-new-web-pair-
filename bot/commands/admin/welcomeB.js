'use strict';

/**
 * welcomeB — Business Welcome
 *
 * Commands:
 *   .welcomeB on
 *   .welcomeB off
 *   .welcomeB status
 *   .welcomeB edit     — set a custom welcome message (multiline supported)
 *   .welcomeB reset    — restore the default built-in welcome message
 *   .welcomeB preview  — preview the current welcome message
 *
 * To set a multiline message, simply type the text after ".welcomeB edit"
 * and press Enter between lines normally — the bot preserves all line breaks.
 *
 * Inside the message text, use @ to mention the new member and # for member count.
 */

const database = require('../../database');

// ── Default built-in welcome text ─────────────────────────────────────────────
// Stored here so the handler can import it too (see handler.js).
const DEFAULT_WELCOME_B =
`*Welcome to our group* 🙂

@

*This is a free bot for everyone with advanced features. The bot contact is only provided to groups*

*Rules:*
1) The bot must be made an admin.
2) The group must be active.
3) The bot will always stay in private mode.
4) Only admins can access the bot.
5) The main purpose of this bot is to protect groups from harmful activity.
6) When the bot is added as an admin in a new group, it will pin the group link for one day.

Thanks for using our service.

Contact: +94784888490

*Main options for a group:*

*_anti bot_*
*_anti channel_*
*_anti link_*
*_anti media_*
*_anti status_*
*_anti sticker_*
*_anti viewonce_*`;

module.exports = {
  name: 'welcomeB',
  aliases: ['welcomeb', 'welcomebusiness', 'bwelcome'],
  category: 'admin',
  description: 'Enable or disable the business-style welcome message for new members.',
  usage: '.welcomeB on | off | status | edit | reset | preview',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,

  // Expose the default text so handler.js can require() it
  DEFAULT_WELCOME_B,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply } = extra;
      const settings = database.getGroupSettings(from);
      const opt = (args[0] || '').toLowerCase();

      // ── STATUS ────────────────────────────────────────────────────────────
      if (!opt || opt === 'status') {
        const state   = settings.welcomeB ? '✅ ON' : '❌ OFF';
        const hasCustom = !!settings.welcomeBMessage;
        return reply(
          `_*Business Welcome Status*_\n\n` +
          `_*System  :*_ _*${state}*_\n` +
          `_*Message :*_ _*${hasCustom ? '✏️ Custom' : '📋 Default'}*_\n\n` +
          `_*Commands:*_\n` +
          `  _*.welcomeB on*_\n` +
          `  _*.welcomeB off*_\n` +
          `  _*.welcomeB status*_\n` +
          `  _*.welcomeB edit <your message>*_\n` +
          `  _*.welcomeB reset*_\n` +
          `  _*.welcomeB preview*_\n\n` +
          `_*Tip: Use @ to mention the new member, # for member count.*_\n` +
          `_*Note: Use .welcome for the normal welcome message.*_`
        );
      }

      // ── ON ────────────────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, { welcomeB: true });
        return reply(`_*Business Welcome has been successfully enabled ✅*_`);
      }

      // ── OFF ───────────────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { welcomeB: false });
        return reply(`_*Business Welcome has been successfully disabled ❌*_`);
      }

      // ── EDIT <message text> ───────────────────────────────────────────────
      // Everything after ".welcomeB edit" becomes the new welcome message.
      // Line breaks typed in WhatsApp are preserved as-is.
      if (opt === 'edit') {
        // Reconstruct the raw message body and strip the ".welcomeB edit" prefix
        // so we capture the full multiline text the admin typed.
        const rawBody = (extra.rawBody || '').trim();

        // Remove the command prefix (e.g. ".welcomeB edit") — case-insensitive
        const prefixPattern = /^[.\\/]welcomeb?\s+edit\s*/i;
        const newText = rawBody.replace(prefixPattern, '').trim();

        if (!newText) {
          return reply(
            `_*❌ Please provide the message text after ".welcomeB edit".*_\n\n` +
            `_*Example:*_\n` +
            `_*.welcomeB edit Welcome @!*_\n` +
            `_*We're glad to have you here.*_\n\n` +
            `_*Use @ to mention the new member, # for member count.*_\n` +
            `_*Just press Enter between lines — line breaks are preserved.*_`
          );
        }

        if (newText.length > 1500) {
          return reply(`_*❌ Message too long. Maximum 1500 characters.*_`);
        }

        database.updateGroupSettings(from, { welcomeBMessage: newText });

        // Show a preview with a placeholder name so the admin can check layout
        const preview = newText.replace(/@/g, '@YourName').replace(/#/g, '42');

        return reply(
          `_*✅ Business Welcome Message Updated*_\n\n` +
          `_*Preview:*_\n` +
          `────────────────\n` +
          preview +
          `\n────────────────\n\n` +
          `_*Use .welcomeB reset to restore the default message.*_`
        );
      }

      // ── RESET ─────────────────────────────────────────────────────────────
      if (opt === 'reset') {
        database.updateGroupSettings(from, { welcomeBMessage: null });
        return reply(
          `_*✅ Business Welcome Message Reset*_\n\n` +
          `_*The default built-in welcome message will be used.*_\n` +
          `_*Use .welcomeB preview to see it.*_`
        );
      }

      // ── PREVIEW ───────────────────────────────────────────────────────────
      if (opt === 'preview') {
        const template = settings.welcomeBMessage || DEFAULT_WELCOME_B;
        const preview  = template.replace(/@/g, '@YourName').replace(/#/g, '42');
        const isCustom = !!settings.welcomeBMessage;
        return reply(
          `_*Business Welcome — ${isCustom ? 'Custom' : 'Default'} Message Preview*_\n\n` +
          `────────────────\n` +
          preview +
          `\n────────────────`
        );
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        `_*❌ Unknown option.*_\n\n` +
        `_*Usage: .welcomeB on | off | status | edit | reset | preview*_`
      );

    } catch (error) {
      await extra.reply(`_*❌ Error: ${error.message}*_`);
    }
  },
};
