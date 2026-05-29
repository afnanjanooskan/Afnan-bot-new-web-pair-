/**
 * Sudo Command — Grant / Revoke / List sudo users
 *
 * Only the bot OWNER can run these commands.
 * Sudo users can use all non-owner commands freely,
 * but they CANNOT use ownerOnly commands.
 *
 * Usage:
 *   .sudo add @user          — add by mention
 *   .sudo add 919876543210   — add by phone number
 *   .sudo del @user          — remove by mention
 *   .sudo del 919876543210   — remove by phone number
 *   .sudo delete @user       — alias for del
 *   .sudo list               — list all sudo users
 */

'use strict';

const database = require('../../database');
const config   = require('../../config');

module.exports = {
  name: 'sudo',
  aliases: ['su'],
  category: 'owner',
  description: 'Manage sudo users (owner only). Sudo users can use non-owner commands.',
  usage: '.sudo add @user | .sudo del @user | .sudo list',
  ownerOnly: true,   // ← ONLY real bot owner can touch this

  async execute(sock, msg, args, extra) {
    try {
      const { from, sender, reply } = extra;
      const sub = (args[0] || '').toLowerCase();

      // ── HELPERS ─────────────────────────────────────────────────────────────
      // Extract JIDs from mention or raw number argument
      const getMentioned = () => {
        return (
          msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ||
          msg.message?.contextInfo?.mentionedJid ||
          []
        );
      };

      // Turn a plain number string into a WhatsApp JID
      const numToJid = (n) => {
        const clean = n.replace(/[^0-9]/g, '');
        return clean ? `${clean}@s.whatsapp.net` : null;
      };

      // Build target list from mention OR from args[1] number
      const getTargets = () => {
        const mentioned = getMentioned();
        if (mentioned.length > 0) return mentioned;
        // Try args[1] as a raw phone number
        const raw = args[1] ? args[1].replace(/[^0-9]/g, '') : '';
        if (raw.length >= 7) return [numToJid(raw)].filter(Boolean);
        return [];
      };

      // ── LIST ────────────────────────────────────────────────────────────────
      if (!sub || sub === 'list' || sub === 'ls') {
        const sudos = database.getSudos();
        if (!sudos.length) {
          return reply(
            `🔰 *Sudo Users*\n\n` +
            `No sudo users added yet.\n\n` +
            `Usage:\n` +
            `• *.sudo add @user*\n` +
            `• *.sudo add 919876543210*`
          );
        }

        const ownerNums = config.ownerNumber.map(n => n.replace(/[^0-9]/g, ''));
        let text = `🔰 *Sudo Users (${sudos.length})*\n━━━━━━━━━━━━━━━━\n\n`;
        sudos.forEach((num, i) => {
          const badge = ownerNums.includes(num) ? '👑 Owner' : '🔰 Sudo';
          text += `${i + 1}. @${num}  ${badge}\n`;
        });
        text += `\n💡 Sudo users can use all non-owner commands.`;

        const mentions = sudos.map(n => `${n}@s.whatsapp.net`);
        return sock.sendMessage(from, { text, mentions }, { quoted: msg });
      }

      // ── ADD ─────────────────────────────────────────────────────────────────
      if (sub === 'add') {
        const targets = getTargets();
        if (!targets.length) {
          return reply(
            `❌ Please mention someone or provide a number!\n\n` +
            `Examples:\n` +
            `• *.sudo add @user*\n` +
            `• *.sudo add 919876543210*`
          );
        }

        const ownerNums = config.ownerNumber.map(n => n.replace(/[^0-9]/g, ''));
        const results = [];

        for (const jid of targets) {
          const num = jid.split('@')[0].replace(/[^0-9]/g, '');
          if (ownerNums.includes(num)) {
            results.push(`⚠️ @${num} is the *Owner* — no need to add as sudo!`);
            continue;
          }
          if (database.isSudo(num)) {
            results.push(`⚠️ @${num} is *already* a sudo user.`);
            continue;
          }
          const ok = database.addSudo(num);
          results.push(ok
            ? `✅ @${num} added as *sudo user* successfully!`
            : `❌ Failed to add @${num}.`
          );
        }

        return sock.sendMessage(from, {
          text: `🔰 *Sudo — Add*\n\n${results.join('\n')}`,
          mentions: targets,
        }, { quoted: msg });
      }

      // ── DEL / DELETE ────────────────────────────────────────────────────────
      if (sub === 'del' || sub === 'delete' || sub === 'remove' || sub === 'rm') {
        const targets = getTargets();
        if (!targets.length) {
          return reply(
            `❌ Please mention someone or provide a number!\n\n` +
            `Examples:\n` +
            `• *.sudo del @user*\n` +
            `• *.sudo del 919876543210*`
          );
        }

        const results = [];

        for (const jid of targets) {
          const num = jid.split('@')[0].replace(/[^0-9]/g, '');
          if (!database.isSudo(num)) {
            results.push(`⚠️ @${num} is *not* a sudo user.`);
            continue;
          }
          const ok = database.removeSudo(num);
          results.push(ok
            ? `✅ @${num} has been *removed* from sudo.`
            : `❌ Failed to remove @${num}.`
          );
        }

        return sock.sendMessage(from, {
          text: `🔰 *Sudo — Remove*\n\n${results.join('\n')}`,
          mentions: targets,
        }, { quoted: msg });
      }

      // ── DEFAULT ─────────────────────────────────────────────────────────────
      return reply(
        `🔰 *Sudo Command*\n\n` +
        `*Commands (Owner only):*\n` +
        `• *.sudo add @user* — Add by mention\n` +
        `• *.sudo add 919876543210* — Add by number\n` +
        `• *.sudo del @user* — Remove by mention\n` +
        `• *.sudo del 919876543210* — Remove by number\n` +
        `• *.sudo list* — Show all sudo users\n\n` +
        `💡 Sudo users can use all non-owner commands.\n` +
        `🚫 Sudo users *cannot* use owner-only commands.`
      );

    } catch (err) {
      await extra.reply(`❌ Error: ${err.message}`);
    }
  },
};
