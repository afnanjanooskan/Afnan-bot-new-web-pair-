/**
 * Group Enable System — Owner Only
 *
 * Commands:
 *   .group enable on   → Enable bot for all members in this group
 *   .group enable off  → Disable bot for everyone except owners in this group
 *
 * Rules:
 *   - Owner only
 *   - Groups only
 *   - Per-group setting (stored in database/groups.json)
 *   - Default: enabled = true
 *
 * When OFF:
 *   - Only bot owners can use commands
 *   - Admins and members are silently blocked
 *   - No warning message sent to blocked users
 */

const database = require('../../database');

module.exports = {
  name: 'group',
  aliases: [],
  category: 'owner',
  description: 'Enable or disable bot commands for this group',
  usage: '.group enable on | .group enable off',
  ownerOnly: true,
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    const { from, reply } = extra;

    // Expected: args[0] = 'enable', args[1] = 'on' | 'off'
    const sub1 = (args[0] || '').toLowerCase();
    const sub2 = (args[1] || '').toLowerCase();

    if (sub1 !== 'enable' || !['on', 'off'].includes(sub2)) {
      return reply(
        `❌ *Invalid usage.*\n\n` +
        `Usage:\n` +
        `*.group enable on*\n` +
        `*.group enable off*`
      );
    }

    const enable = sub2 === 'on';
    database.updateGroupSettings(from, { enabled: enable });

    if (enable) {
      return reply(
        `✅ Bot enabled in this group.\n` +
        `All members can use commands now.`
      );
    } else {
      return reply(
        `✅ Bot disabled in this group.\n` +
        `Only owners can use commands now.`
      );
    }
  }
};
