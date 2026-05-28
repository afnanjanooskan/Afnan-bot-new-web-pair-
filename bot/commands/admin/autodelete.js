/**
 * Auto Delete System — Per Group
 *
 * Commands:
 *   .autodelete on   → enable: delete all non-admin messages in this group
 *   .autodelete off  → disable: allow all messages normally
 *
 * Permission: Group admins only (+ bot owner)
 * Scope: Group only — has no effect in DMs
 *
 * How it works:
 *   When ON, every incoming message from a non-admin is silently deleted.
 *   Admin messages (including the bot owner's) are always preserved.
 *   Setting is stored per group in database/groups.json and survives restarts.
 */

const database = require('../../database');

module.exports = {
  name: 'autodelete',
  aliases: ['autodel', 'auto-delete'],
  category: 'admin',
  description: 'Auto-delete non-admin messages in the group',
  usage: '.autodelete on | .autodelete off',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;

    const sub = (args[0] || '').toLowerCase();

    if (!['on', 'off'].includes(sub)) {
      const current = database.getGroupSettings(from).autodelete ? '🟢 ON' : '🔴 OFF';
      return reply(
        `╭━━『 *Auto Delete* 』━━╮\n\n` +
        `📌 *Status:* ${current}\n\n` +
        `📖 *Usage:*\n` +
        `• *.autodelete on* — delete all non-admin messages\n` +
        `• *.autodelete off* — allow all messages normally\n\n` +
        `ℹ️ Admin messages are never deleted.\n\n` +
        `╰━━━━━━━━━━━━━━━╯`
      );
    }

    const enable = sub === 'on';
    database.updateGroupSettings(from, { autodelete: enable });

    if (enable) {
      return reply(
        `✅ *Auto Delete enabled!*\n\n` +
        `🗑️ All non-admin messages will now be automatically deleted.\n` +
        `👮 Admin messages are safe.\n\n` +
        `Use *.autodelete off* to disable.`
      );
    } else {
      return reply(
        `✅ *Auto Delete disabled!*\n\n` +
        `💬 Messages will no longer be auto-deleted in this group.\n\n` +
        `Use *.autodelete on* to re-enable.`
      );
    }
  }
};
