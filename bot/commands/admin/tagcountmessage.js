'use strict';

/**
 * Tag Count Message (.tagcountmessage / .tcm)
 * Tags ALL members in the group with their message counts.
 * Sorted highest → lowest. Sends pages of 50 so every member gets notified.
 */

const database = require('../../database');

const PAGE_SIZE = 50; // WhatsApp notifies up to 50 mentions per message

module.exports = {
  name: 'tagcountmessage',
  aliases: ['tcm'],
  category: 'admin',
  description: 'Tag all group members with their message count (sorted highest first).',
  usage: '.tcm',
  groupOnly: true,
  adminOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const { from, reply, groupMetadata } = extra;

      // Always do a live fetch for accuracy
      let participants = [];
      try {
        const meta = await sock.groupMetadata(from);
        participants = meta.participants || [];
      } catch (_) {
        participants = groupMetadata?.participants || [];
      }

      if (!participants.length) {
        return reply('_*❌ Could not fetch group members.*_');
      }

      // Build [{ jid, count }] for every participant
      const entries = participants
        .map(p => {
          const jid = p.id || p.jid || p.participant || '';
          const count = jid ? database.getMsgCount(from, jid) : 0;
          return { jid, count };
        })
        .filter(e => e.jid);

      // Sort highest count first
      entries.sort((a, b) => b.count - a.count);

      const total     = entries.length;
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const groupName = groupMetadata?.subject || 'This Group';

      // Send one page at a time — each page mentions 50 members so they get notified
      for (let page = 0; page < totalPages; page++) {
        const start = page * PAGE_SIZE;
        const end   = Math.min(start + PAGE_SIZE, total);
        const slice = entries.slice(start, end);

        // Build numbered lines for this page
        const lines = slice.map((e, i) => {
          const phone = e.jid.split('@')[0];
          const rank  = start + i + 1;
          return `*${rank})* @${phone} *${e.count}* ✉️`;
        });

        const mentionJids = slice.map(e => e.jid);

        let text = '';

        if (page === 0) {
          // First page: include header
          text = `*📊 Message Count — All Members*\n*📌 ${groupName}*\n\n`;
        }

        text += lines.join('\n');

        if (page === totalPages - 1) {
          // Last page: include footer
          text += `\n\n*👥 Total members: ${total}*`;
        }

        await sock.sendMessage(from, {
          text,
          mentions: mentionJids,
        }, { quoted: page === 0 ? msg : undefined });

        // Wait between pages so WhatsApp doesn't rate-limit the bot
        if (page < totalPages - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

    } catch (error) {
      await extra.reply(`_*❌ Error: ${error.message}*_`);
    }
  },
};
