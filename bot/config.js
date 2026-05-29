/**
 * Global Configuration for Afnan Bot
 */

// Load persisted owners from owner.json
function loadPersistedOwners() {
  try {
    const fs = require('fs');
    const path = require('path');
    const ownerFile = path.join(__dirname, 'database', 'owner.json');
    if (fs.existsSync(ownerFile)) {
      const data = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
      return data.owners || [];
    }
  } catch (_) {}
  return [];
}

const persistedOwners = loadPersistedOwners();

module.exports = {
    // Bot Owner Configuration
    // These are updated dynamically when someone pairs via the web panel
    ownerNumber: persistedOwners.length > 0 ? persistedOwners : ['917023951514'],
    ownerName: ['Afnan'],

    // Bot Configuration
    botName: 'Afnan Bot',
    prefix: '.',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '',
    updateZipUrl: 'https://github.com/afnanjanooskan/Afnan-bot/archive/refs/heads/main.zip',

    // Sticker Configuration
    packname: 'Afnan Bot',

    // Bot Behavior
    selfMode: false,
    dmMute: false,
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot',
    autoDownload: false,

    // Group Settings Defaults
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete',
      antiall: false,
      antibot: false,
      anticall: false,
      antigroupmention: false,
      antigroupmentionAction: 'kick',
      welcome: false,
      welcomeMessage: null,
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋',
      antiSpam: false,
      antidelete: false,
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false,
      antichannel: false,
      antichannelAction: 'kick',
      antiviewonce: false,
      antiviewonceAction: 'warn',
      antimedia: false,
      antimediaAction: 'kick',
      antistickerSpam: false,
      antistickerSpamAction: 'delete',
      antistickerSpamCount: 6,
      antistickerSpamTimegap: 3,
      antimessageSpam: false,
      antimessageSpamAction: 'delete',
      antimessageSpamCount: 6,
      antimessageSpamTimegap: 3,
      autodelete: false,
      enabled: true,
    },

    // API Keys
    apiKeys: {
      openai: '',
      deepai: '',
      remove_bg: ''
    },

    // Messages
    messages: {
      wait: '⏳ Please wait...',
      success: '✅ Success!',
      error: '❌ Error occurred!',
      ownerOnly: '👑 This command is only for the bot owner (Afnan Bot)!',
      adminOnly: '🛡️ This command is only for group admins!',
      groupOnly: '👥 This command can only be used in groups!',
      privateOnly: '💬 This command can only be used in private chat!',
      botAdminNeeded: '🤖 Bot needs to be admin to execute this command!',
      invalidCommand: '❓ Invalid command! Type .menu for help'
    },

    // Timezone
    timezone: 'Asia/Kolkata',

    // Limits
    maxWarnings: 3,

    // Social Links
    social: {
      github: 'https://github.com/afnanjanooskan',
      instagram: '',
      youtube: ''
    }
};
