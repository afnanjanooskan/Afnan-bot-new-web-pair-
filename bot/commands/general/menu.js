/**
 * Menu Command - Display all available commands
 */

const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');

module.exports = {
  name: 'menu',
  aliases: ['help', 'commands'],
  category: 'general',
  description: 'Show all available commands',
  usage: '.menu',
  
  async execute(sock, msg, args, extra) {
    try {
      const commands = loadCommands();
      const categories = {};
      
      // Group commands by category
      commands.forEach((cmd, name) => {
        if (cmd.name === name) { // Only count main command names, not aliases
          if (!categories[cmd.category]) {
            categories[cmd.category] = [];
          }
          categories[cmd.category].push(cmd);
        }
      });
      
      const ownerNames = Array.isArray(config.ownerName) ? config.ownerName : [config.ownerName];
      const displayOwner = ownerNames[0] || config.ownerName || 'Bot Owner';
      
      let menuText = `╭━━『 *${config.botName}* 』━━╮\n\n`;
      menuText += `👋 Hello @${extra.sender.split('@')[0]}!\n\n`;
      menuText += `⚡ Prefix: ${config.prefix}\n`;
      menuText += `📦 Total Commands: ${commands.size}\n`;
      menuText += `👑 Owner: ${displayOwner}\n\n`;
      
      // General Commands
      if (categories.general) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🧭 GENERAL COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.general.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }
      
      // AI Commands
      if (categories.ai) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🤖 AI COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.ai.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }
      
      // Group Commands
      if (categories.group) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🔵 GROUP COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.group.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }
      
      // Admin Commands
      if (categories.admin) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🛡️ ADMIN COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;

        // ── Anti-option commands — fixed numbered list ──────────────────────
        // Numbers match the .antioption shortcut system exactly.
        const antiOptionList = [
          '1).antibot',
          '2).antichannel',
          '3).antilink',
          '4).antimedia',
          '5).antimessage spam',
          '6).antistatus',
          '7).antisticker',
          '8).antisticker spam',
          '9).antiviewonce',
        ];
        antiOptionList.forEach(entry => {
          menuText += `│ ➜ ${entry}\n`;
        });

        // ── Other admin commands (non-anti) ────────────────────────────────
        const antiNames = new Set([
          'antibot','antichannel','antilink','antimedia',
          'antimessage','antistatus','antisticker',
          'antistickerspam','antiviewonce',
        ]);
        categories.admin.forEach(cmd => {
          if (!antiNames.has(cmd.name)) {
            menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
          }
        });

        menuText += `\n`;
      }

      // Anti-Channel Share block — always shown
      menuText += `┏━━━━━━━━━━━━━━━━━\n`;
      menuText += `┃ 📢 ANTI-CHANNEL SHARE\n`;
      menuText += `┗━━━━━━━━━━━━━━━━━\n`;
      menuText += `│ Blocks channel posts from being shared\n`;
      menuText += `│ ➜ ${config.prefix}antichannel on/off\n`;
      menuText += `│ ➜ ${config.prefix}antichannel set delete\n`;
      menuText += `│ ➜ ${config.prefix}antichannel set warn\n`;
      menuText += `│ ➜ ${config.prefix}antichannel set kick\n`;
      menuText += `\n`;

      // Tag Count Message
      menuText += `┏━━━━━━━━━━━━━━━━━\n`;
      menuText += `┃ 📊 TAG COUNT MESSAGE\n`;
      menuText += `┗━━━━━━━━━━━━━━━━━\n`;
      menuText += `│ Show message counts of tagged members\n`;
      menuText += `│ ➜ ${config.prefix}tagcountmessage @user\n`;
      menuText += `│ ➜ ${config.prefix}tcm @user\n`;
      menuText += `\n`;

      // Owner Commands
      if (categories.owner) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 👑 OWNER COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.owner.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
          // Show sudo sub-commands inline under .sudo
          if (cmd.name === 'sudo') {
            menuText += `│    ↳ add @user / add number\n`;
            menuText += `│    ↳ del @user / del number\n`;
            menuText += `│    ↳ list\n`;
          }
        });
        menuText += `\n`;
      }
      
      // Media Commands
      if (categories.media) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🎞️ MEDIA COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.media.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }
      
      // Fun Commands
      if (categories.fun) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🎭 FUN COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.fun.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }
      
      // Utility Commands
      if (categories.utility) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🔧 UTILITY COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.utility.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }

       // Anime Commands
       if (categories.anime) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 👾 ANIME COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.anime.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }

       // Textmaker Commands
       if (categories.utility) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🖋️ TEXTMAKER COMMAND\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.textmaker.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }
      
      if (categories.games) {
        menuText += `┏━━━━━━━━━━━━━━━━━\n`;
        menuText += `┃ 🐺 GAMES\n`;
        menuText += `┗━━━━━━━━━━━━━━━━━\n`;
        categories.games.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}\n`;
        });
        menuText += `\n`;
      }

      if (categories.games) {
        menuText += `┏━━━━━━━━━━━━━━━━━
`;
        menuText += `┃ 🎮 GAMES
`;
        menuText += `┗━━━━━━━━━━━━━━━━━
`;
        categories.games.forEach(cmd => {
          menuText += `│ ➜ ${config.prefix}${cmd.name}
`;
        });
        menuText += `
`;
      }

      menuText += `╰━━━━━━━━━━━━━━━━━\n\n`;
      menuText += `💡 Type ${config.prefix}help <command> for more info\n`;
      menuText += `🌟 Bot Version: 1.0.0\n`;
      
      // Send menu with image
      const fs = require('fs');
      const path = require('path');
      const imagePath = path.join(__dirname, '../../utils/bot_image.jpg');
      
      if (fs.existsSync(imagePath)) {
        // Send image with newsletter forwarding context
        const imageBuffer = fs.readFileSync(imagePath);
        await sock.sendMessage(extra.from, {
          image: imageBuffer,
          caption: menuText,
          mentions: [extra.sender]
        }, { quoted: msg });
      } else {
        await sock.sendMessage(extra.from, {
          text: menuText,
          mentions: [extra.sender]
        }, { quoted: msg });
      }
      
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
