/**
 * DM Mute Command
 * Controls whether users can execute bot commands in private chat (DM).
 *
 * .bot dm mute on  — block DM command execution for regular users
 * .bot dm mute off — allow DM command execution (default)
 *
 * Rules:
 *  - Only affects private chats (DMs). Groups are NEVER touched.
 *  - Completely separate from ".bot mute on/off" (group mute system).
 *  - Owner and sudo users always bypass DM mute.
 *  - Works regardless of public/private bot mode.
 */

'use strict';

const database = require('../../database');

module.exports = {
  name: 'dmmute',
  aliases: [],
  category: 'owner',
  description: 'Block or allow command usage in private chat (DM)',
  usage: '.bot dm mute <on/off>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const sub = args[0]?.toLowerCase();

      // Status display when no arg given
      if (!sub) {
        const current = database.getDmMute();
        return extra.reply(
          `🔕 *DM Mute System*\n\n` +
          `Current status: *${current ? 'ON (DM commands blocked)' : 'OFF (DM commands allowed)'}*\n\n` +
          `Usage:\n` +
          `  *.bot dm mute on*  — Block commands in DM\n` +
          `  *.bot dm mute off* — Allow commands in DM\n\n` +
          `_Owner and sudo users always bypass DM mute._\n` +
          `_Groups are never affected._`
        );
      }

      if (sub === 'on') {
        if (database.getDmMute()) {
          return extra.reply('🔕 DM Mute is already *ON*.\nUsers cannot use commands in private chat.');
        }
        database.setDmMute(true);
        return extra.reply(
          '🔕 *DM Mute enabled.*\n\n' +
          'Users can no longer use commands in private chat.\n' +
          'Groups are unaffected. Owner and sudo users can still use DM commands.'
        );
      }

      if (sub === 'off') {
        if (!database.getDmMute()) {
          return extra.reply('🔔 DM Mute is already *OFF*.\nEveryone can use commands in private chat.');
        }
        database.setDmMute(false);
        return extra.reply(
          '🔔 *DM Mute disabled.*\n\n' +
          'Commands in private chat are allowed again.'
        );
      }

      return extra.reply('❌ Invalid option.\nUsage: *.bot dm mute on* / *.bot dm mute off*');

    } catch (error) {
      console.error('[DmMute] Error:', error.message);
      return extra.reply('❌ Error updating DM mute setting.');
    }
  },
};
