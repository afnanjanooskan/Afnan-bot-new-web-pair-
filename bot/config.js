/**
 * Global Configuration for WhatsApp MD Bot
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: ['91xxxxxxxxxxx','917023951514'], // Add your number without + or spaces (e.g., 919876543210)
    ownerName: ["Afnan's Bot", 'Professor'], // Owner names corresponding to ownerNumber array
    
    // Bot Configuration
    botName: "Afnan's Bot",
    prefix: '.',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '', // Newsletter JID for menu forwarding
    updateZipUrl:'https://github.com/afnanjanooskan/Afnan-bot/archive/refs/heads/main.zip', // URL to latest code zip for .update command
    
    // Sticker Configuration
    packname: "Afnan's Bot",
    
    // Bot Behavior
    selfMode: false, // Private mode - only owner can use commands
    dmMute: false, // DM Mute - block command execution in private chat (owner/sudo bypass)
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot', // set bot or all via cmd
    autoDownload: false,
    
    // Group Settings Defaults
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete', // 'delete', 'kick', 'warn'      antiall: false, // Owner only - blocks all messages from non-admins
      antibot: false,
      anticall: false, // Anti-call feature
      antigroupmention: false, // Anti-group mention feature
      antigroupmentionAction: 'kick',   // always kick for status mention
      welcome: false,
      welcomeMessage: null, // null = use built-in DEFAULT_WELCOME in handler.js
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
      antiSpam: false,
      antidelete: false,
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false, // Auto-convert images/videos to stickers
      antichannel: false,         // Block WhatsApp channel shares
      antichannelAction: 'kick',  // 'delete', 'warn', 'kick'  — kick is the default
      antiviewonce: false,        // Block view-once (one-view) images/videos in group
      antiviewonceAction: 'warn', // 'delete', 'warn', 'kick'
      antimedia: false,           // Block all photos and videos in group
      antimediaAction: 'kick',    // 'delete', 'warn', 'kick'
      antistickerSpam: false,          // Block sticker spam
      antistickerSpamAction: 'delete', // 'delete', 'warn', 'kick'
      antistickerSpamCount: 6,         // Stickers within timeGap before action
      antistickerSpamTimegap: 3,       // Seconds between stickers before counting as spam
      antimessageSpam: false,          // Block message spam
      antimessageSpamAction: 'delete', // 'delete', 'warn', 'kick'
      antimessageSpamCount: 6,         // Messages within timeGap before action
      antimessageSpamTimegap: 3,       // Seconds between messages before counting as spam
      autodelete: false,               // Auto-delete non-admin messages in group
      enabled: true,                   // Whether bot responds to commands in this group
    },
    
    // API Keys (add your own)
    apiKeys: {
      // Add API keys here if needed
      openai: '',
      deepai: '',
      remove_bg: ''
    },
    
    // Message Configuration
    messages: {
      wait: '⏳ Please wait...',
      success: '✅ Success!',
      error: '❌ Error occurred!',
      ownerOnly: '👑 This command is only for bot owner!',
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
    
    // Social Links (optional)
    social: {
      github: 'https://github.com/mruniquehacker',
      instagram: 'https://instagram.com/yourusername',
      youtube: 'http://youtube.com/@mr_unique_hacker'
    }
};
  
