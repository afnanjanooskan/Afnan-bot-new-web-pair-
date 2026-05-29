/**
 * Dheos / Amel Command - Fun roast command
 */

module.exports = {
  name: 'dheos',
  aliases: ['amel'],
  category: 'fun',
  description: 'Expose Amel the PUBG noob 😂',
  usage: '.dheos or .amel',

  async execute(sock, msg, args, extra) {
    try {
      await extra.reply('amel is a PUBG Noob 😂 she is afnan\'s enemy in werewolf. She is always getting killed by afnan 🙂😂');
      await extra.reply('huhu I\'m just kidding, you\'re genius');
      await extra.reply('April fool 🤣🤣🤣');
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
