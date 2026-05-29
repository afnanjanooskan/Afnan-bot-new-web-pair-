/**
 * Add Command - Add a person to the group by phone number
 * Owner only
 */

module.exports = {
  name: 'add',
  aliases: [],
  category: 'owner',
  description: 'Add a person to the group by phone number',
  usage: '.add <phone number>',
  groupOnly: true,
  ownerOnly: true,
  botAdminNeeded: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args[0]) {
        return extra.reply(
          '📞 *Usage:* .add <phone number>\n\n' +
          'Examples:\n' +
          '  .add 94771234567\n' +
          '  .add +94771234567'
        );
      }

      // Sanitize: strip spaces, dashes, parentheses, leading +
      const raw = args[0].replace(/[\s\-\(\)\+]/g, '');

      if (!/^\d{7,15}$/.test(raw)) {
        return extra.reply('❌ Invalid phone number. Use digits only, e.g. .add 94771234567');
      }

      const jid = raw + '@s.whatsapp.net';

      // Check if already in group
      const metadata = await sock.groupMetadata(extra.from);
      const already = metadata.participants.some(p => p.id === jid);
      if (already) {
        return extra.reply(`❌ @${raw} is already in this group.`, { mentions: [jid] });
      }

      const result = await sock.groupParticipantsUpdate(extra.from, [jid], 'add');

      // result is an array of { status, jid }
      const status = result?.[0]?.status;

      if (status === '200') {
        await sock.sendMessage(extra.from, {
          text: `✅ @${raw} has been added to the group.`,
          mentions: [jid],
        }, { quoted: msg });
      } else if (status === '403') {
        await extra.reply(`❌ Cannot add @${raw} — their privacy settings prevent being added to groups.`);
      } else if (status === '408') {
        await extra.reply(`❌ @${raw} has not accepted the invite yet (invite sent instead).`);
      } else if (status === '409') {
        await extra.reply(`❌ @${raw} is already in the group.`);
      } else {
        await extra.reply(`❌ Failed to add +${raw}. Status: ${status || 'unknown'}`);
      }

    } catch (error) {
      console.error('Add command error:', error);
      await extra.reply(`❌ Error: ${error.message}`);
    }
  },
};
