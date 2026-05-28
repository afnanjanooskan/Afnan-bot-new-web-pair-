'use strict';

/**
 * Welcome Command — Full management of welcome messages per group.
 *
 * Subcommands:
 *   .welcome on                    — Enable welcome for this group
 *   .welcome off                   — Disable welcome for this group
 *   .welcome edit <message>        — Set a custom welcome message for this group
 *   .welcome pfp on / off          — Show/hide profile picture in welcome
 *   .welcome add default           — Reset welcome message back to default
 *   .welcome (no args)             — Show current status
 *
 * Placeholders supported in custom messages:
 *   @user        — Mentions the new member
 *   @group       — Group name
 *   #memberCount — Current member count
 *
 * Each group's settings are fully independent.
 * Does NOT touch .welcomeB (business welcome) in any way.
 */

const database = require('../../database');
const config   = require('../../config');

module.exports = {
  name:           'welcome',
  aliases:        ['welcomeon', 'welcomeoff'],
  category:       'admin',
  description:    'Manage welcome messages for new members — on/off/edit/pfp/default',
  usage:          '.welcome on | off | edit <msg> | pfp on|off | add default',
  groupOnly:      true,
  adminOnly:      true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply, rawBody } = extra;
      const settings = database.getGroupSettings(from);
      const opt = (args[0] || '').toLowerCase();
      const sub = (args[1] || '').toLowerCase();

      // ── No args → show status ─────────────────────────────────────────────
      if (!opt) {
        const state      = settings.welcome     ? '✅ ON'  : '❌ OFF';
        const pfpState   = settings.welcomePfp !== false ? '✅ ON'  : '❌ OFF';
        const isCustom   = !!settings.welcomeMessage;
        const msgPreview = (settings.welcomeMessage || config.defaultGroupSettings.welcomeMessage || '')
          .slice(0, 60).replace(/\n/g, ' ') + '…';

        return reply(
          `_*👋 Welcome System — This Group*_\n\n` +
          `_*Status      :*_ _*${state}*_\n` +
          `_*Profile Pic :*_ _*${pfpState}*_\n` +
          `_*Message     :*_ _*${isCustom ? 'Custom' : 'Default'}*_\n` +
          `_*Preview     :*_ _*${msgPreview}*_\n\n` +
          `_*Commands:*_\n` +
          `  _*.welcome on | off*_\n` +
          `  _*.welcome edit <your message>*_\n` +
          `  _*.welcome pfp on | off*_\n` +
          `  _*.welcome add default*_\n\n` +
          `_*Placeholders:*_ _*@  =  mention new member    #  =  member count*_`
        );
      }

      // ── .welcome on ───────────────────────────────────────────────────────
      if (opt === 'on') {
        database.updateGroupSettings(from, { welcome: true });
        return reply(`_*✅ Welcome Messages: ENABLED for this group*_`);
      }

      // ── .welcome off ──────────────────────────────────────────────────────
      if (opt === 'off') {
        database.updateGroupSettings(from, { welcome: false });
        return reply(`_*❌ Welcome Messages: DISABLED for this group*_`);
      }

      // ── .welcome edit <message> ───────────────────────────────────────────
      if (opt === 'edit') {
        // Extract the message from rawBody to preserve line breaks and spacing.
        // rawBody is the full command text e.g. ".welcome edit Hello\nLine2"
        // We find the position right after "edit " and take everything from there.
        const editMatch = rawBody.match(/\.welcome\s+edit\s/i);
        const customMsg = editMatch
          ? rawBody.slice(editMatch.index + editMatch[0].length)
          : args.slice(1).join(' ').trim();

        if (!customMsg || !customMsg.trim()) {
          return reply(
            `_*❌ Please provide your custom welcome message.*_\n\n` +
            `_*Usage: .welcome edit <your message>*_\n\n` +
            `_*Placeholders:*_\n` +
            `  _*@  →  Mentions the new member*_\n` +
            `  _*#  →  Total member count*_`
          );
        }

        database.updateGroupSettings(from, { welcomeMessage: customMsg });
        const preview = customMsg.slice(0, 80).replace(/\n/g, ' ') + (customMsg.length > 80 ? '…' : '');
        return reply(
          `_*✅ Custom Welcome Message Set*_\n\n` +
          `_*Preview: ${preview}*_\n\n` +
          `_*This group only. Other groups are not affected.*_`
        );
      }

      // ── .welcome pfp on / off ─────────────────────────────────────────────
      if (opt === 'pfp') {
        if (sub === 'on') {
          database.updateGroupSettings(from, { welcomePfp: true });
          return reply(`_*✅ Profile Picture: ENABLED in welcome for this group*_`);
        }
        if (sub === 'off') {
          database.updateGroupSettings(from, { welcomePfp: false });
          return reply(`_*❌ Profile Picture: DISABLED in welcome for this group*_`);
        }
        return reply(`_*❌ Usage: .welcome pfp on | off*_`);
      }

      // ── .welcome add default ──────────────────────────────────────────────
      if (opt === 'add' && sub === 'default') {
        // Clear the custom message — handler will fall back to config default
        database.updateGroupSettings(from, { welcomeMessage: null });
        return reply(
          `_*✅ Welcome Message Reset to Default*_\n\n` +
          `_*This group will now use the bot's default welcome message.*_\n` +
          `_*Only this group is affected.*_`
        );
      }

      // ── Unknown ───────────────────────────────────────────────────────────
      return reply(
        `_*❌ Unknown option.*_\n\n` +
        `_*Usage:*_\n` +
        `  _*.welcome on | off*_\n` +
        `  _*.welcome edit <your message>*_\n` +
        `  _*.welcome pfp on | off*_\n` +
        `  _*.welcome add default*_`
      );

    } catch (err) {
      await extra.reply(`_*❌ Error: ${err.message}*_`);
    }
  },
};
