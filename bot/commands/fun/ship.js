// commands/fun/ship.js
module.exports = {
  name: 'ship',
  aliases: ['shipit', 'match'],
  category: 'fun',
  description: 'Ship two users randomly or mention/reply to specific users.',
  usage: '.ship (random) OR .ship @user1 @user2 OR reply with .ship',
  groupOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
      const mentioned = ctx.mentionedJid || [];

      let a = null;
      let b = null;

      // If two mentions -> use them
      if (mentioned.length >= 2) {
        a = mentioned[0];
        b = mentioned[1];
      }

      // If one mention -> pair with sender
      else if (mentioned.length === 1) {
        a = mentioned[0];
        b = extra.sender;
      }

      // If reply -> pair replied user with sender
      else if (ctx.participant) {
        a = ctx.participant;
        b = extra.sender;
      }

      // Random group members
      else {
        if (extra.isGroup && extra.groupMetadata?.participants) {
          const participants = extra.groupMetadata.participants
            .map(p => p.id)
            .filter(id => id !== sock.user.id);

          if (participants.length < 2) {
            return extra.reply('❌ Not enough members to ship!');
          }

          const shuffled = participants.sort(() => Math.random() - 0.5);

          a = shuffled[0];
          b = shuffled[1];
        } else {
          return extra.reply('❌ This command works only in groups!');
        }
      }

      // Special pair numbers
      const special1 = '355693531299@s.whatsapp.net';
      const special2 = '93788834840@s.whatsapp.net';

      // Check if special pair
      const isSpecialPair =
        (a === special1 && b === special2) ||
        (a === special2 && b === special1);

      // Love percentage
      let love;

      if (isSpecialPair) {
        love = 100;
      } else {
        // Random for everyone else
        love = Math.floor(Math.random() * 101);
      }

      // Mention format
      const nameOf = id => `@${id.split('@')[0]}`;

      // Hearts
      const hearts = ['💖', '💕', '💘', '💞', '💓'];
      const heart = hearts[Math.floor(Math.random() * hearts.length)];

      // Messages
      const phrases = [
        `${nameOf(a)} + ${nameOf(b)} = ${love}% ${heart}\nLooks promising!`,
        `${nameOf(a)} x ${nameOf(b)} = ${love}%\nNot bad, keep flirting 😉`,
        `${nameOf(a)} & ${nameOf(b)} Compatibility: ${love}%\n${
          love > 75
            ? 'A strong match ❤️'
            : love > 40
            ? 'Could work 🤝'
            : 'Mostly chaos 😂'
        }`
      ];

      const out = phrases[Math.floor(Math.random() * phrases.length)];

      await sock.sendMessage(
        extra.from,
        {
          text: out,
          mentions: [a, b]
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error('[ship] ERROR:', error);
      await extra.reply('❌ Something went wrong while shipping.');
    }
  }
};
