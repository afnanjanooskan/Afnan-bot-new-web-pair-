/**
 * Message Handler - Processes incoming messages and executes commands
 */

const config = require('./config');
const database = require('./database');
const { loadCommands } = require('./utils/commandLoader');
const { addMessage } = require('./utils/groupstats');
const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// Group metadata cache to prevent rate limiting
const groupMetadataCache = new Map();
const CACHE_TTL = 60000; // 1 minute cache

// Load all commands
const commands = loadCommands();

// Unwrap WhatsApp containers (ephemeral, document, etc.)
// IMPORTANT: Do NOT unwrap viewOnceMessageV2 or viewOnceMessage here.
// handleAntiviewonce reads msg.message directly (the raw original).
// Unwrapping here would destroy the viewOnce structure before detection runs.
const getMessageContent = (msg) => {
  if (!msg || !msg.message) return null;
  
  let m = msg.message;
  
  // Unwrap ephemeral outer wrapper (safe — viewOnce will still be inside)
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;

  // If this is a view-once message, return it as-is.
  // actualMessageTypes will contain viewOnceMessageV2 / viewOnceMessage,
  // keeping the message alive through the handleMessage flow.
  if (m.viewOnceMessageV2 || m.viewOnceMessage || m.viewOnceMessageV2Extension) {
    return m;
  }

  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  
  return m;
};

// Cached group metadata getter with rate limit handling (for non-admin checks)
const getCachedGroupMetadata = async (sock, groupId) => {
  try {
    // Validate group JID before attempting to fetch
    if (!groupId || !groupId.endsWith('@g.us')) {
      return null;
    }
    
    // Check cache first
    const cached = groupMetadataCache.get(groupId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data; // Return cached data (even if null for forbidden groups)
    }
    
    // Fetch from API
    const metadata = await sock.groupMetadata(groupId);
    
    // Cache it
    groupMetadataCache.set(groupId, {
      data: metadata,
      timestamp: Date.now()
    });
    
    return metadata;
  } catch (error) {
    // Handle forbidden (403) errors - cache null to prevent retry storms
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      // Cache null for forbidden groups to prevent repeated attempts
      groupMetadataCache.set(groupId, {
        data: null,
        timestamp: Date.now()
      });
      return null; // Silently return null for forbidden groups
    }
    
    // Handle rate limit errors
    if (error.message && error.message.includes('rate-overlimit')) {
      const cached = groupMetadataCache.get(groupId);
      if (cached) {
        return cached.data;
      }
      return null;
    }
    
    // For other errors, try cached data as fallback
    const cached = groupMetadataCache.get(groupId);
    if (cached) {
      return cached.data;
    }
    
    // Return null instead of throwing to prevent crashes
    return null;
  }
};

// Live group metadata getter (always fresh, no cache) - for admin checks
const getLiveGroupMetadata = async (sock, groupId) => {
  try {
    // Always fetch fresh metadata, bypass cache
    const metadata = await sock.groupMetadata(groupId);
    
    // Update cache for other features (antilink, welcome, etc.)
    groupMetadataCache.set(groupId, {
      data: metadata,
      timestamp: Date.now()
    });
    
    return metadata;
  } catch (error) {
    // On error, try cached data as fallback
    const cached = groupMetadataCache.get(groupId);
    if (cached) {
      return cached.data;
    }
    return null;
  }
};

// Alias for backward compatibility (non-admin features use cached)
const getGroupMetadata = getCachedGroupMetadata;

// Helper functions
const isOwner = (sender) => {
  if (!sender) return false;
  
  // Normalize sender JID to handle LID
  const normalizedSender = normalizeJidWithLid(sender);
  const senderNumber = normalizeJid(normalizedSender);
  
  // Check against owner numbers
  return config.ownerNumber.some(owner => {
    const normalizedOwner = normalizeJidWithLid(owner.includes('@') ? owner : `${owner}@s.whatsapp.net`);
    const ownerNumber = normalizeJid(normalizedOwner);
    return ownerNumber === senderNumber;
  });
};

const isMod = (sender) => {
  const number = sender.split('@')[0];
  return database.isModerator(number);
};

// isSudo — check if sender is a sudo user (can use non-owner commands but NOT ownerOnly)
const isSudo = (sender) => {
  if (!sender) return false;
  return database.isSudo(sender);
};

// LID mapping cache
const lidMappingCache = new Map();

// Helper to normalize JID to just the number part
const normalizeJid = (jid) => {
  if (!jid) return null;
  if (typeof jid !== 'string') return null;
  
  // Remove device ID if present (e.g., "1234567890:0@s.whatsapp.net" -> "1234567890")
  if (jid.includes(':')) {
    return jid.split(':')[0];
  }
  // Remove domain if present (e.g., "1234567890@s.whatsapp.net" -> "1234567890")
  if (jid.includes('@')) {
    return jid.split('@')[0];
  }
  return jid;
};

// Get LID mapping value from session files
const getLidMappingValue = (user, direction) => {
  if (!user) return null;
  
  const cacheKey = `${direction}:${user}`;
  if (lidMappingCache.has(cacheKey)) {
    return lidMappingCache.get(cacheKey);
  }
  
  const sessionPath = path.join(__dirname, config.sessionName || 'session');
  const suffix = direction === 'pnToLid' ? '.json' : '_reverse.json';
  const filePath = path.join(sessionPath, `lid-mapping-${user}${suffix}`);
  
  if (!fs.existsSync(filePath)) {
    lidMappingCache.set(cacheKey, null);
    return null;
  }
  
  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    const value = raw ? JSON.parse(raw) : null;
    lidMappingCache.set(cacheKey, value || null);
    return value || null;
  } catch (error) {
    lidMappingCache.set(cacheKey, null);
    return null;
  }
};

// Normalize JID handling LID conversion
const normalizeJidWithLid = (jid) => {
  if (!jid) return jid;
  
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) {
      return `${jid.split(':')[0].split('@')[0]}@s.whatsapp.net`;
    }
    
    let user = decoded.user;
    let server = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    
    const mapToPn = () => {
      const pnUser = getLidMappingValue(user, 'lidToPn');
      if (pnUser) {
        user = pnUser;
        server = server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
        return true;
      }
      return false;
    };
    
    if (server === 'lid' || server === 'hosted.lid') {
      mapToPn();
    } else if (server === 's.whatsapp.net' || server === 'hosted') {
      mapToPn();
    }
    
    if (server === 'hosted') {
      return jidEncode(user, 'hosted');
    }
    return jidEncode(user, 's.whatsapp.net');
  } catch (error) {
    return jid;
  }
};

// Build comparable JID variants (PN + LID) for matching
const buildComparableIds = (jid) => {
  if (!jid) return [];
  
  try {
    const decoded = jidDecode(jid);
    if (!decoded?.user) {
      return [normalizeJidWithLid(jid)].filter(Boolean);
    }
    
    const variants = new Set();
    const normalizedServer = decoded.server === 'c.us' ? 's.whatsapp.net' : decoded.server;
    
    variants.add(jidEncode(decoded.user, normalizedServer));
    
    const isPnServer = normalizedServer === 's.whatsapp.net' || normalizedServer === 'hosted';
    const isLidServer = normalizedServer === 'lid' || normalizedServer === 'hosted.lid';
    
    if (isPnServer) {
      const lidUser = getLidMappingValue(decoded.user, 'pnToLid');
      if (lidUser) {
        const lidServer = normalizedServer === 'hosted' ? 'hosted.lid' : 'lid';
        variants.add(jidEncode(lidUser, lidServer));
      }
    } else if (isLidServer) {
      const pnUser = getLidMappingValue(decoded.user, 'lidToPn');
      if (pnUser) {
        const pnServer = normalizedServer === 'hosted.lid' ? 'hosted' : 's.whatsapp.net';
        variants.add(jidEncode(pnUser, pnServer));
      }
    }
    
    return Array.from(variants);
  } catch (error) {
    return [jid];
  }
};

// Find participant by either PN JID or LID JID
const findParticipant = (participants = [], userIds) => {
  const targets = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean)
    .flatMap(id => buildComparableIds(id));
  
  if (!targets.length) return null;
  
  return participants.find(participant => {
    if (!participant) return false;
    
    const participantIds = [
      participant.id,
      participant.lid,
      participant.userJid
    ]
      .filter(Boolean)
      .flatMap(id => buildComparableIds(id));
    
    return participantIds.some(id => targets.includes(id));
  }) || null;
};

const isAdmin = async (sock, participant, groupId, groupMetadata = null) => {
  if (!participant) return false;
  
  // Early return for non-group JIDs (DMs) - prevents slow sock.groupMetadata() call
  if (!groupId || !groupId.endsWith('@g.us')) {
    return false;
  }
  
  // Always fetch live metadata for admin checks
  let liveMetadata = groupMetadata;
  if (!liveMetadata || !liveMetadata.participants) {
    if (groupId) {
      liveMetadata = await getLiveGroupMetadata(sock, groupId);
    } else {
      return false;
    }
  }
  
  if (!liveMetadata || !liveMetadata.participants) return false;
  
  // Use findParticipant to handle LID matching
  const foundParticipant = findParticipant(liveMetadata.participants, participant);
  if (!foundParticipant) return false;
  
  return foundParticipant.admin === 'admin' || foundParticipant.admin === 'superadmin';
};

const isBotAdmin = async (sock, groupId, groupMetadata = null) => {
  if (!sock.user || !groupId) return false;
  
  // Early return for non-group JIDs (DMs) - prevents slow sock.groupMetadata() call
  if (!groupId.endsWith('@g.us')) {
    return false;
  }
  
  try {
    // Get bot's JID - Baileys stores it in sock.user.id
    const botId = sock.user.id;
    const botLid = sock.user.lid;
    
    if (!botId) return false;
    
    // Prepare bot JIDs to check - findParticipant will normalize them via buildComparableIds
    const botJids = [botId];
    if (botLid) {
      botJids.push(botLid);
    }
    
    // ALWAYS fetch live metadata for bot admin checks (never use cached)
    const liveMetadata = await getLiveGroupMetadata(sock, groupId);
    
    if (!liveMetadata || !liveMetadata.participants) return false;
    
    const participant = findParticipant(liveMetadata.participants, botJids);
    if (!participant) return false;
    
    return participant.admin === 'admin' || participant.admin === 'superadmin';
  } catch (error) {
    return false;
  }
};

const isUrl = (text) => {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  return urlRegex.test(text);
};

const hasGroupLink = (text) => {
  const linkRegex = /chat.whatsapp.com\/([0-9A-Za-z]{20,24})/i;
  return linkRegex.test(text);
};

// System JID filter - checks if JID is from broadcast/status/newsletter
const isSystemJid = (jid) => {
  if (!jid) return true;
  return jid.includes('@broadcast') || 
         jid.includes('status.broadcast') || 
         jid.includes('@newsletter') ||
         jid.includes('@newsletter.');
};

// Main message handler
const handleMessage = async (sock, msg) => {
  try {
    // Debug logging to see all messages
    // Debug log removed
    
    if (!msg.message) return;
    
    const from = msg.key.remoteJid;
    
    // System message filter - ignore broadcast/status/newsletter messages
    if (isSystemJid(from)) {
      return; // Silently ignore system messages
    }
    
    // Auto-React System
    try {
      // Clear cache to get fresh config values
      delete require.cache[require.resolve('./config')];
      const config = require('./config');

      if (config.autoReact && msg.message && !msg.key.fromMe) {
        const content = msg.message.ephemeralMessage?.message || msg.message;
        const text =
          content.conversation ||
          content.extendedTextMessage?.text ||
          '';

        const jid = msg.key.remoteJid;
        const emojis = ['❤️','🔥','👌','💀','😁','✨','👍','🤨','😎','😂','🤝','💫'];
        
        const mode = config.autoReactMode || 'bot';

        if (mode === 'bot') {
          const prefixList = ['.', '/', '#'];
          if (prefixList.includes(text?.trim()[0])) {
            await sock.sendMessage(jid, {
              react: { text: '⏳', key: msg.key }
            });
          }
        }

        if (mode === 'all') {
          const rand = emojis[Math.floor(Math.random() * emojis.length)];
          await sock.sendMessage(jid, {
            react: { text: rand, key: msg.key }
          });
        }
      }
    } catch (e) {
      console.error('[AutoReact Error]', e.message);
    }
    
    // Unwrap containers first
    const content = getMessageContent(msg);
    // Note: We don't return early if content is null because forwarded status messages might not have content
    
    // Still check for actual message content for regular processing
    let actualMessageTypes = [];
    if (content) {
      const allKeys = Object.keys(content);
      // Filter out protocol/system messages and find actual message content
      const protocolMessages = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
      actualMessageTypes = allKeys.filter(key => !protocolMessages.includes(key));
    }
    
    // We'll check for empty content later after we've processed group messages
    
    // Use the first actual message type (conversation, extendedTextMessage, etc.)
    const messageType = actualMessageTypes[0];
    
    // from already defined above in DM block check
    const sender = msg.key.fromMe ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : msg.key.participant || msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us'); // Should always be true now due to DM block above
    
    // Fetch group metadata immediately if it's a group
    const groupMetadata = isGroup ? await getGroupMetadata(sock, from) : null;
    
    // Anti-group mention protection (check BEFORE prefix check, as these are non-command messages)
    if (isGroup) {
      // Debug logging to confirm we're trying to call the handler
      const groupSettings = database.getGroupSettings(from);
      // Debug log removed
      if (groupSettings.antistatus) {
        // Debug log removed
      }
      try {
        await handleAntistatus(sock, msg, groupMetadata);
      } catch (error) {
        console.error('Error in antistatus handler:', error);
      }

      // Anti-Channel Share protection
      try {
        await handleAntiChannel(sock, msg, groupMetadata);
      } catch (error) {
        console.error('Error in handleAntiChannel:', error);
      }

      // Anti-Link protection
      try {
        await handleAntilink(sock, msg, groupMetadata);
      } catch (error) {
        console.error('Error in handleAntilink:', error);
      }

      // Anti-Sticker protection
      try {
        await handleAntisticker(sock, msg, groupMetadata);
      } catch (error) {
        console.error('Error in handleAntisticker:', error);
      }

      // Anti-Bot protection
      try {
        await handleAntibot(sock, msg, groupMetadata);
      } catch (error) {
        console.error('Error in handleAntibot:', error);
      }

      // Anti-Media protection
      if (!msg.key.fromMe && groupSettings.antimedia) {
        try {
          await handleAntimedia(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in handleAntimedia:', error);
        }
      }

      // Anti-Sticker Spam protection
      if (!msg.key.fromMe && groupSettings.antistickerSpam) {
        try {
          await handleAntistickerSpam(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in handleAntistickerSpam:', error);
        }
      }

      // Anti-Message Spam protection
      if (!msg.key.fromMe && groupSettings.antimessageSpam) {
        try {
          await handleAntimessageSpam(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in handleAntimessageSpam:', error);
        }
      }

      // Anti-Viewonce protection
      if (!msg.key.fromMe && groupSettings.antiviewonce) {
        try {
          await handleAntiviewonce(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in handleAntiviewonce:', error);
        }
      }
      // Auto Delete — delete non-admin messages when enabled
      if (!msg.key.fromMe) {
        try {
          await handleAutodelete(sock, msg, groupMetadata);
        } catch (error) {
          console.error('Error in handleAutodelete:', error);
        }
      }
    }
    
    // Track group message statistics
    if (isGroup) {
      addMessage(from, sender);
      // Increment persistent per-user per-group message count (used by .tagcountmessage)
      if (sender && !msg.key.fromMe) {
        database.incrementMsgCount(from, sender);
      }
    }
    
    // Return early for non-group messages with no recognizable content
    if (!content || actualMessageTypes.length === 0) return;
    
    // 🔹 Button response should also check unwrapped content
    const btn = content.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
    if (btn) {
      const buttonId = btn.selectedButtonId;
      const displayText = btn.selectedDisplayText;
      
      // Handle button clicks by routing to commands
      if (buttonId === 'btn_menu') {
        // Execute menu command
        const menuCmd = commands.get('menu');
        if (menuCmd) {
          await menuCmd.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            isSudo: isSudo(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
        }
        return;
      } else if (buttonId === 'btn_ping') {
        // Execute ping command
        const pingCmd = commands.get('ping');
        if (pingCmd) {
          await pingCmd.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            isSudo: isSudo(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
        }
        return;
      } else if (buttonId === 'btn_help') {
        // Execute list command again (help)
        const listCmd = commands.get('list');
        if (listCmd) {
          await listCmd.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            isSudo: isSudo(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
        }
        return;
      }
    }
    
    // Get message body from unwrapped content
    let body = '';
    if (content.conversation) {
      body = content.conversation;
    } else if (content.extendedTextMessage) {
      body = content.extendedTextMessage.text || '';
    } else if (content.imageMessage) {
      body = content.imageMessage.caption || '';
    } else if (content.videoMessage) {
      body = content.videoMessage.caption || '';
    }
    
    body = (body || '').trim();
    
    // Check antiall protection (owner only feature)
    if (isGroup) {
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.antiall) {
        const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
        const senderIsOwner = isOwner(sender);
        
        if (!senderIsAdmin && !senderIsOwner) {
          const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
          if (botIsAdmin) {
            await sock.sendMessage(from, { delete: msg.key });
            return;
          }
        }
      }
    }

    // AutoSticker feature - convert images/videos to stickers automatically
    if (isGroup) { // Process all messages in groups (including bot's own messages)
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.autosticker) {
        const mediaMessage = content?.imageMessage || content?.videoMessage;
        
        // Only process if it's an image or video (not documents)
        if (mediaMessage) {
          // Skip if message has a command prefix (let command handle it)
          if (!body.startsWith(config.prefix)) {
            try {
              // Import sticker command logic
              const stickerCmd = commands.get('sticker');
              if (stickerCmd) {
                // Execute sticker conversion silently
                await stickerCmd.execute(sock, msg, [], {
                  from,
                  sender,
                  isGroup,
                  groupMetadata,
                  isOwner: isOwner(sender),
                  isAdmin: await isAdmin(sock, sender, from, groupMetadata),
                  isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
                  isMod: isMod(sender),
            isSudo: isSudo(sender),
                  reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
                  react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
                });
                return; // Don't process as command after auto-converting
              }
            } catch (error) {
              console.error('[AutoSticker Error]:', error);
              // Continue to normal processing if autosticker fails
            }
          }
        }
      }
    }

     // Check for active bomb games (before prefix check)
    try {
      const bombModule = require('./commands/fun/bomb');
      if (bombModule.gameState && bombModule.gameState.has(sender)) {
        const bombCommand = commands.get('bomb');
        if (bombCommand && bombCommand.execute) {
          // User has active game, process input
          await bombCommand.execute(sock, msg, [], {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            isSudo: isSudo(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
          return; // Don't process as command
        }
      }
    } catch (e) {
      // Silently ignore if bomb command doesn't exist or has errors
    }
    
    // Check for active tictactoe games (before prefix check)
    try {
      const tictactoeModule = require('./commands/fun/tictactoe');
      if (tictactoeModule.handleTicTacToeMove) {
        // Check if user is in an active game
        const isInGame = Object.values(tictactoeModule.games || {}).some(room => 
          room.id.startsWith('tictactoe') && 
          [room.game.playerX, room.game.playerO].includes(sender) && 
          room.state === 'PLAYING'
        );
        
        if (isInGame) {
          // User has active game, process input
          const handled = await tictactoeModule.handleTicTacToeMove(sock, msg, {
            from,
            sender,
            isGroup,
            groupMetadata,
            isOwner: isOwner(sender),
            isAdmin: await isAdmin(sock, sender, from, groupMetadata),
            isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
            isMod: isMod(sender),
            isSudo: isSudo(sender),
            reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
            react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
          });
          if (handled) return; // Don't process as command if move was handled
        }
      }
    } catch (e) {
      // Silently ignore if tictactoe command doesn't exist or has errors
    }

    // ── Werewolf DM night-action routing ──────────────────────────
    // If the message is from a DM (not a group) and the sender is in an active game,
    // route their text input as a night action without requiring a prefix.
    try {
      if (!isGroup) {
        const werewolfCmd = commands.get('ww') || commands.get('werewolf');
        if (werewolfCmd && werewolfCmd.handleWerewolfDM && body) {
          const handled = await werewolfCmd.handleWerewolfDM(sock, msg, sender, body);
          if (handled) return;
        }
      }
    } catch (e) {
      // Silently ignore Werewolf DM routing errors
    }

    // ── Math Game answer listener ─────────────────────────────────
    // Intercepts every group/private message so players can answer
    // math questions by typing a number — no prefix needed.
    // Per-player sessions support multiplayer in the same group.
    if (body) {
      try {
        const mathCmd = commands.get('math');
        if (mathCmd && mathCmd.handleMathAnswer) {
          const mathHandled = await mathCmd.handleMathAnswer(sock, msg, sender, body, from);
          if (mathHandled) return;
        }
      } catch (e) {
        // Silently ignore math errors
      }
    }

    // ── Ban check — runs before every command ────────────────────────────────
    // Banned users cannot use ANY bot command in groups OR DMs.
    // Owner is always bypassed.
    {
      const senderNumber = sender.split('@')[0].replace(/[^0-9]/g, '');
      const senderIsOwner = isOwner(sender);
      if (!senderIsOwner && database.isBanned(senderNumber)) {
        return; // silently ignore banned users
      }
    }

    // ── Group Enable check — runs before every command ──────────────────────
    // When a group has enabled=false, only owners can use commands.
    // Non-owners are silently ignored — no reply sent.
    if (isGroup) {
      const groupSettings = database.getGroupSettings(from);
      if (groupSettings.enabled === false && !isOwner(sender)) {
        return;
      }
    }

    // Check if message starts with prefix
    if (!body.startsWith(config.prefix)) return;
    
    // Parse command
    const args = body.slice(config.prefix.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();
    
    // Get command
    const command = commands.get(commandName);
    if (!command) return;
    
    // Check self mode (private mode) - only owner and sudo users can use commands
    // Exception: .bot mute / .botmute always works so admins can manage group mute state
    if (config.selfMode && !isOwner(sender) && !isSudo(sender) && commandName !== 'bot' && commandName !== 'botmute') {
      return;
    }

    // Check bot mute — per-group restriction
    // If botMute is on, only admins, owner, and sudo users can use commands in this group.
    if (isGroup) {
      const groupSettingsForMute = database.getGroupSettings(from);
      if (groupSettingsForMute.botMute) {
        const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
        const senderIsOwner = isOwner(sender);
        const senderIsSudo  = isSudo(sender);
        if (!senderIsAdmin && !senderIsOwner && !senderIsSudo) {
          // Silently ignore — don't reveal the bot is muted
          return;
        }
      }
    }

    // ── DM Mute check ───────────────────────────────────────────────────────
    // Block command execution in private chat when dmMute is enabled.
    // Groups are NEVER affected. Owner and sudo users always bypass.
    if (!isGroup) {
      const { getDmMute } = require('./database');
      if (getDmMute() && !isOwner(sender) && !isSudo(sender)) {
        return sock.sendMessage(from, {
          text: '❌ Commands in private chat are currently disabled by the owner.',
        }, { quoted: msg });
      }
    }

    // Permission checks
    if (command.ownerOnly && !isOwner(sender)) {
      // Sudo users are explicitly blocked from ownerOnly commands
      if (isSudo(sender)) {
        return sock.sendMessage(from, {
          text: '🚫 *This command is for the bot owner only!*\n\nSudo users cannot use owner commands.',
        }, { quoted: msg });
      }
      return sock.sendMessage(from, { text: config.messages.ownerOnly }, { quoted: msg });
    }
    
    if (command.modOnly && !isMod(sender) && !isOwner(sender)) {
      return sock.sendMessage(from, { text: '🔒 This command is only for moderators!' }, { quoted: msg });
    }
    
    if (command.groupOnly && !isGroup) {
      return sock.sendMessage(from, { text: config.messages.groupOnly }, { quoted: msg });
    }
    
    if (command.privateOnly && isGroup) {
      return sock.sendMessage(from, { text: config.messages.privateOnly }, { quoted: msg });
    }
    
    if (command.adminOnly && !(await isAdmin(sock, sender, from, groupMetadata)) && !isOwner(sender) && !isSudo(sender)) {
      return sock.sendMessage(from, { text: config.messages.adminOnly }, { quoted: msg });
    }
    
    if (command.botAdminNeeded) {
      const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
      if (!botIsAdmin) {
        return sock.sendMessage(from, { text: config.messages.botAdminNeeded }, { quoted: msg });
      }
    }
    
    // Auto-typing
    if (config.autoTyping) {
      await sock.sendPresenceUpdate('composing', from);
    }
    
    // Execute command
    console.log(`Executing command: ${commandName} from ${sender}`);
    
    await command.execute(sock, msg, args, {
      from,
      sender,
      isGroup,
      groupMetadata,
      isOwner: isOwner(sender),
      isAdmin: await isAdmin(sock, sender, from, groupMetadata),
      isBotAdmin: await isBotAdmin(sock, from, groupMetadata),
      isMod: isMod(sender),
            isSudo: isSudo(sender),
      rawBody: body,
      reply: (text) => sock.sendMessage(from, { text }, { quoted: msg }),
      react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
    });
    
  } catch (error) {
    console.error('Error in message handler:', error);
    
    // Don't send error messages for rate limit errors
    if (error.message && error.message.includes('rate-overlimit')) {
      console.warn('⚠️ Rate limit reached. Skipping error message.');
      return;
    }
    
    try {
      await sock.sendMessage(msg.key.remoteJid, { 
        text: `${config.messages.error}\n\n${error.message}` 
      }, { quoted: msg });
    } catch (e) {
      // Don't log rate limit errors when sending error messages
      if (!e.message || !e.message.includes('rate-overlimit')) {
        console.error('Error sending error message:', e);
      }
    }
  }
};

// Group participant update handler
const handleGroupUpdate = async (sock, update) => {
  try {
    const { id, participants, action } = update;
    
    // Validate group JID before processing
    if (!id || !id.endsWith('@g.us')) {
      return;
    }
    
    const groupSettings = database.getGroupSettings(id);
    
    if (!groupSettings.welcome && !groupSettings.welcomeB && !groupSettings.goodbye) return;
    
    const groupMetadata = await getGroupMetadata(sock, id);
    if (!groupMetadata) return; // Skip if metadata unavailable (forbidden or error)
    
    // Helper to extract participant JID
    const getParticipantJid = (participant) => {
      if (typeof participant === 'string') {
        return participant;
      }
      if (participant && participant.id) {
        return participant.id;
      }
      if (participant && typeof participant === 'object') {
        // Try to find JID in object
        return participant.jid || participant.participant || null;
      }
      return null;
    };
    
    for (const participant of participants) {
      const participantJid = getParticipantJid(participant);
      if (!participantJid) {
        console.warn('Could not extract participant JID:', participant);
        continue;
      }
      
      const participantNumber = participantJid.split('@')[0];
      
      if (action === 'add' && groupSettings.welcome) {
        try {
          // ── Resolve display name ─────────────────────────────
          let displayName = participantNumber;

          const participantInfo = groupMetadata.participants.find(p => {
            const pId = p.id || p.jid || p.participant;
            return pId === participantJid || pId?.split('@')[0] === participantNumber;
          });

          if (participantInfo) {
            if (participantInfo.notify && participantInfo.notify.trim() && !participantInfo.notify.match(/^\d+$/)) {
              displayName = participantInfo.notify.trim();
            } else if (participantInfo.name && participantInfo.name.trim() && !participantInfo.name.match(/^\d+$/)) {
              displayName = participantInfo.name.trim();
            }
          }

          // Try contact store as well
          try {
            const phoneJid = participantJid.includes('@') ? participantJid : participantJid + '@s.whatsapp.net';
            if (sock.store?.contacts?.[phoneJid]) {
              const c = sock.store.contacts[phoneJid];
              if (c.notify && c.notify.trim() && !c.notify.match(/^\d+$/)) displayName = c.notify.trim();
            }
          } catch (_) {}

          // ── Fetch profile picture ─────────────────────────────
          let profilePicBuffer = null;
          try {
            const ppUrl = await sock.profilePictureUrl(participantJid, 'image');
            const ppResp = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 8000 });
            profilePicBuffer = Buffer.from(ppResp.data);
          } catch (_) {
            // No profile picture — will send text-only
          }

          // ── Build welcome message ─────────────────────────────
          const groupName   = groupMetadata.subject || 'the group';
          const memberCount = groupMetadata.participants.length;
          const userTag     = `@${participantJid.split('@')[0]}`;

          // Default welcome message (built-in template)
          // @ and # are resolved after construction
          const DEFAULT_WELCOME =
            `Welcome @
` +
            `Members: #`;

          // Use custom message if set for this group, otherwise default
          let welcomeMsg;
          if (groupSettings.welcomeMessage) {
            // Substitute placeholders in custom message
            // Replace bare @ with user mention, bare # with member count
            welcomeMsg = groupSettings.welcomeMessage
              .replace(/@/g,  userTag)
              .replace(/#/g,  String(memberCount));
          } else {
            welcomeMsg = DEFAULT_WELCOME
              .replace(/@/g,  userTag)
              .replace(/#/g,  String(memberCount));
          }

          // ── Send welcome — respect pfp setting (default: show pfp) ───────
          const showPfp = groupSettings.welcomePfp !== false; // true unless explicitly disabled

          if (showPfp && profilePicBuffer) {
            await sock.sendMessage(id, {
              image:    profilePicBuffer,
              caption:  welcomeMsg,
              mentions: [participantJid]
            });
          } else {
            // pfp disabled or unavailable — text only
            await sock.sendMessage(id, {
              text:     welcomeMsg,
              mentions: [participantJid]
            });
          }

        } catch (welcomeError) {
          console.error('Welcome error:', welcomeError);
          // Silent fail — don't spam the group with error messages
        }
      }

      // ── BUSINESS WELCOME ─────────────────────────────────────────────────
      if (action === 'add' && groupSettings.welcomeB) {
        try {
          const userTag     = `@${participantJid.split('@')[0]}`;
          const memberCount = String(groupMetadata.participants.length);

          // Use the admin's custom message if set, otherwise fall back to the
          // built-in default exported from the welcomeB command module.
          const { DEFAULT_WELCOME_B } = require('./commands/admin/welcomeB');
          const template = groupSettings.welcomeBMessage || DEFAULT_WELCOME_B;

          // Resolve placeholders — same convention as .welcome:
          //   @  →  mentioned user tag
          //   #  →  current member count
          // Line breaks are preserved exactly as the admin typed them.
          const businessWelcomeMsg = template
            .replace(/@/g, userTag)
            .replace(/#/g, memberCount);

          await sock.sendMessage(id, {
            text: businessWelcomeMsg,
            mentions: [participantJid],
          });

        } catch (welcomeBError) {
          console.error('Business Welcome error:', welcomeBError);
        }
      } else if (action === 'remove') {
        // Always reset message count when a member leaves
        try {
          const leavingJid = typeof participant === 'string'
            ? participant
            : (participant?.id || null);
          if (leavingJid) {
            database.resetMsgCount(id, leavingJid);
            console.log('[MsgCount] Reset count for', leavingJid, 'in', id);
          }
        } catch (_) {}

        if (groupSettings.goodbye) {
        try {
          // Get user's display name - find participant using phoneNumber or JID
          let displayName = participantNumber;
          
          // Try to find participant in group metadata (before they left)
          const participantInfo = groupMetadata.participants.find(p => {
            const pId = p.id || p.jid || p.participant;
            const pPhone = p.phoneNumber;
            // Match by JID or phoneNumber
            return pId === participantJid || 
                   pId?.split('@')[0] === participantNumber ||
                   pPhone === participantJid ||
                   pPhone?.split('@')[0] === participantNumber;
          });
          
          // Get phoneNumber JID to fetch contact name
          let phoneJid = null;
          if (participantInfo && participantInfo.phoneNumber) {
            phoneJid = participantInfo.phoneNumber;
          } else {
            // Try to normalize participantJid to phoneNumber format
            try {
              const normalized = normalizeJidWithLid(participantJid);
              if (normalized && normalized.includes('@s.whatsapp.net')) {
                phoneJid = normalized;
              }
            } catch (e) {
              if (participantJid.includes('@s.whatsapp.net')) {
                phoneJid = participantJid;
              }
            }
          }
          
          // Try to get contact name from phoneNumber JID
          if (phoneJid) {
            try {
              // Method 1: Try to get from contact store if available
              if (sock.store && sock.store.contacts && sock.store.contacts[phoneJid]) {
                const contact = sock.store.contacts[phoneJid];
                if (contact.notify && contact.notify.trim() && !contact.notify.match(/^\d+$/)) {
                  displayName = contact.notify.trim();
                } else if (contact.name && contact.name.trim() && !contact.name.match(/^\d+$/)) {
                  displayName = contact.name.trim();
                }
              }
              
              // Method 2: Try to fetch contact using onWhatsApp and then check store
              if (displayName === participantNumber) {
                try {
                  await sock.onWhatsApp(phoneJid);
                  
                  // After onWhatsApp, check store again
                  if (sock.store && sock.store.contacts && sock.store.contacts[phoneJid]) {
                    const contact = sock.store.contacts[phoneJid];
                    if (contact.notify && contact.notify.trim() && !contact.notify.match(/^\d+$/)) {
                      displayName = contact.notify.trim();
                    }
                  }
                } catch (fetchError) {
                  // Silently handle fetch errors
                }
              }
            } catch (contactError) {
              // Silently handle contact errors
            }
          }
          
          // Final fallback: use participantInfo.notify or name if available
          if (displayName === participantNumber && participantInfo) {
            if (participantInfo.notify && participantInfo.notify.trim() && !participantInfo.notify.match(/^\d+$/)) {
              displayName = participantInfo.notify.trim();
            } else if (participantInfo.name && participantInfo.name.trim() && !participantInfo.name.match(/^\d+$/)) {
              displayName = participantInfo.name.trim();
            }
          }
          
          // Get user's profile picture URL
          let profilePicUrl = '';
          try {
            profilePicUrl = await sock.profilePictureUrl(participantJid, 'image');
          } catch (ppError) {
            // If profile picture not available, use default avatar
            profilePicUrl = 'https://img.pyrocdn.com/dbKUgahg.png';
          }
          
          // Get group name and description
          const groupName = groupMetadata.subject || 'the group';
          const groupDesc = groupMetadata.desc || 'No description';
          
          // Get current time string
          const now = new Date();
          const timeString = now.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
          });
          
          // Create simple goodbye message
          const goodbyeMsg = `Goodbye @${displayName} 👋 We will never miss you!`;
          
          // Construct API URL for goodbye image (using leave type)
          const apiUrl = `https://api.some-random-api.com/welcome/img/7/gaming4?type=leave&textcolor=white&username=${encodeURIComponent(displayName)}&guildName=${encodeURIComponent(groupName)}&memberCount=${groupMetadata.participants.length}&avatar=${encodeURIComponent(profilePicUrl)}`;
          
          // Download the goodbye image
          const imageResponse = await axios.get(apiUrl, { responseType: 'arraybuffer' });
          const imageBuffer = Buffer.from(imageResponse.data);
          
          // Send the goodbye image with caption
          await sock.sendMessage(id, { 
            image: imageBuffer,
            caption: goodbyeMsg,
            mentions: [participantJid] 
          });
        } catch (goodbyeError) {
          // Fallback to simple goodbye message
          console.error('Goodbye error:', goodbyeError);
          const goodbyeMsg = `Goodbye @${participantNumber} 👋 We will never miss you! 💀`;
          
          await sock.sendMessage(id, { 
            text: goodbyeMsg, 
            mentions: [participantJid] 
          });
        }
        } // end if groupSettings.goodbye
      }
    }
  } catch (error) {
    // Silently handle forbidden errors and other group metadata errors
    if (error.message && (
      error.message.includes('forbidden') || 
      error.message.includes('403') ||
      error.statusCode === 403 ||
      error.output?.statusCode === 403 ||
      error.data === 403
    )) {
      // Silently skip forbidden groups
      return;
    }
    // Only log non-forbidden errors
    if (!error.message || !error.message.includes('forbidden')) {
      console.error('Error handling group update:', error);
    }
  }
};

// Antilink handler
const handleAntilink = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antilink) return;

    // Skip admins and bot owner immediately
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    // ── Extract raw message text ───────────────────────────────────────────
    const m = msg.message || {};
    const rawText = (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      ''
    );

    if (!rawText) return;

    // ════════════════════════════════════════════════════════════════════════
    //  PRE-PROCESSING PIPELINE
    //  Normalise the text to defeat common bypass tricks.
    //
    //  Steps:
    //    1. Lowercase
    //    2. Strip zero-width / invisible Unicode characters
    //    3. Collapse whitespace to single spaces
    //    4. Restore dots hidden as "[.]", "(.)", or the word "dot"
    //       NOTE: We do NOT collapse spaces around every "." here —
    //       doing so converts "know me" into "know.me" when "dot" is nearby,
    //       causing false positives on normal English words.
    //    5. Restore slashes hidden as "(slash)", "[/]"
    //    6. Collapse letter-by-letter spacing (e.g. "h t t p s : / /")
    // ════════════════════════════════════════════════════════════════════════

    let text = rawText.toLowerCase();

    // Step 2 — strip zero-width / invisible Unicode
    text = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');

    // Step 3 — collapse whitespace
    text = text.replace(/\s+/g, ' ').trim();

    // Step 4 — restore ONLY explicitly hidden dots (never collapse spaces globally)
    text = text
      .replace(/\s*\[\.\]\s*/g, '.')   // [.]
      .replace(/\s*\(\.\)\s*/g, '.')   // (.)
      .replace(/\bdot\b/g, '.');       // the word "dot"
    // NOTE: We intentionally do NOT do .replace(/\s*\.\s*/g, '.') here —
    // that collapsed ALL spaces around dots and caused "know me",
    // "rank in", "let me know" etc. to false-positive against .me / .in TLDs.

    // Step 5 — restore hidden slashes
    text = text
      .replace(/\(slash\)/g, '/')
      .replace(/\[\/\]/g, '/');

    // Step 6 — collapse letter-by-letter spacing ("h t t p s : / / e x a m p l e . c o m")
    text = text.replace(/(?<!\w)([a-z] ){3,}[a-z](?!\w)/g, (match) =>
      match.replace(/ /g, '')
    );

    // ════════════════════════════════════════════════════════════════════════
    //  CHANNEL LINK GUARD
    //  WhatsApp channel / newsletter links are handled by handleAntiChannel.
    //  This handler must NOT act on them.
    // ════════════════════════════════════════════════════════════════════════
    const isChannelLink =
      /whatsapp\.com\/channel\//i.test(text) ||
      /wa\.me\/channel\//i.test(text)        ||
      /whatsapp\.com\/newsletter\//i.test(text);

    if (isChannelLink) return;

    // ════════════════════════════════════════════════════════════════════════
    //  LINK DETECTION
    //
    //  Rules designed to eliminate false positives on normal words:
    //
    //  A. Explicit protocol (http:// / https://) — always a real link
    //  B. www. prefix — always a real link
    //  C. Platform invite / profile links (hardcoded, require path)
    //  D. Known short-link services (require a "/" path component)
    //  E. Generic domain + UNAMBIGUOUS TLD (no short 2-char TLDs like
    //     .me, .in, .co, .io, .my, .is etc. — these clash with common words)
    //  F. Short/ambiguous TLDs ONLY when followed by a "/" path component
    //     (e.g. example.io/page is a link; "count me in" is not)
    //
    //  Layer F (obfuscated domain without dots — "example com") is removed
    //  entirely: it caused massive false positives on everyday phrases like
    //  "know me", "rank in", "let me know", etc.
    // ════════════════════════════════════════════════════════════════════════

    // A — explicit protocol
    const hasProtocol = /https?:\/\/[^\s]{4,}/.test(text);

    // B — www. prefix
    const hasWww = /\bwww\.[a-z0-9-]{2,}\.[a-z]{2,}/.test(text);

    // C — platform invite / profile links (all require a path "/" to avoid bare-word matches)
    const hasPlatformLink = (
      /\bchat\.whatsapp\.com\//.test(text)       ||  // WhatsApp group invite
      /\bt\.me\/[^\s]/.test(text)                ||  // Telegram
      /\btelegram\.me\//.test(text)              ||  // Telegram alt
      /\bdiscord\.gg\/[^\s]/.test(text)          ||  // Discord invite
      /\bdiscord\.com\/invite\//.test(text)      ||  // Discord invite alt
      /\binstagram\.com\/[^\s]{2,}/.test(text)   ||  // Instagram
      /\bfacebook\.com\/[^\s]{2,}/.test(text)    ||  // Facebook
      /\byoutube\.com\/[^\s]{2,}/.test(text)     ||  // YouTube
      /\byoutu\.be\/[^\s]/.test(text)            ||  // YouTube short
      /\btiktok\.com\/@/.test(text)              ||  // TikTok
      /\btwitter\.com\/[^\s]{2,}/.test(text)     ||  // Twitter
      /\bx\.com\/[^\s]{2,}/.test(text)               // X (Twitter)
    );

    // D — known short-link services (always require a "/" path)
    const hasShortLink = (
      /\bbit\.ly\/[^\s]/.test(text)       ||
      /\btinyurl\.com\/[^\s]/.test(text)  ||
      /\bgoo\.gl\/[^\s]/.test(text)       ||
      /\bshorten\.to\/[^\s]/.test(text)   ||
      /\bis\.gd\/[^\s]/.test(text)        ||
      /\bclck\.ru\/[^\s]/.test(text)      ||
      /\bshrtco\.de\/[^\s]/.test(text)
    );

    // E — generic domain + UNAMBIGUOUS TLD (minimum 3-char domain label)
    //  Short/common TLDs that clash with English words (.me, .in, .co, .io,
    //  .my, .is, .to, .tv, .gg, .re, .id, .ly) are intentionally excluded here —
    //  they are handled safely in layer F with a required path component.
    const SAFE_TLD =
      /\b[a-z0-9][a-z0-9-]{2,}\.(com|net|org|edu|gov|info|biz|app|dev|lk|uk|us|au|ca|de|fr|jp|ru|br|pk|bd|sg|ng|gh|ke|za|ae|sa|qa|kw|bh|om|eg|tn|ma|dz|sd|ye|iq|sy|jo|lb|ps|am|az|ge|kz|uz|tm|kg|tj|mn|mm|th|vn|ph|tw|hk|kr|cn|np|af|ir|tr|ua|by|md|ro|bg|rs|hr|si|sk|cz|pl|hu|lt|lv|ee|fi|se|no|dk|nl|be|ch|at|es|pt|it|gr|cy|mt|ie|nz|fj|pg|ws|vu|sb|ki|fm|pw|mh|nr|mp|gu|as|vi|pr|gl|fo|ax|je|im|sh|ai|bm|vg|tc|ms|ag|bb|bs|dm|gd|jm|kn|lc|tt|vc|an|aw|cw|sx|mq|gp|gf|yt|pm|nc|pf|wf|tf|hn|gt|sv|ni|cr|pa|cu|ht|do|mx|bz|sr|gy|pe|ec|ve|bo|py|uy|ar|cl|fk|gs)\b/;
    const hasGenericDomain = SAFE_TLD.test(text);

    // F — short/ambiguous TLDs ONLY when followed by "/" (confirms it's a URL path)
    //  This catches links like example.io/page, some.co/path, mysite.me/profile
    //  while correctly ignoring "count me in", "rank in class", "know me", etc.
    const SHORT_TLD_WITH_PATH =
      /\b[a-z0-9][a-z0-9-]{2,}\.(io|co|me|in|ly|id|my|is|tv|to|gg|re)\/[^\s]/;
    const hasShortTldWithPath = SHORT_TLD_WITH_PATH.test(text);

    const isRealLink = hasProtocol || hasWww || hasPlatformLink || hasShortLink || hasGenericDomain || hasShortTldWithPath;

    if (!isRealLink) return;

    // ── Enforce ────────────────────────────────────────────────────────────
    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const action    = (groupSettings.antilinkAction || 'warn').toLowerCase();
    const MAX_WARNS = database.getAntiWarnLimit(from, 'antilink');
    const senderTag = '@' + sender.split('@')[0];

    // Always delete the offending message first
    try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

    // ── MODE: DELETE ────────────────────────────────────────────────────────
    if (action === 'delete') {
      return;
    }

    // ── MODE: KICK ──────────────────────────────────────────────────────────
    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {
        console.error('[AntiLink] Kick failed:', e.message);
      }
      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for violating the link policy.*_`,
        mentions: [sender],
      });
      return;
    }

    // ── MODE: WARN (default) ────────────────────────────────────────────────
    const warnData  = database.addAntiWarning(from, sender, 'antilink', 'Sent an unauthorized link');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    if (warnCount >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {
        console.error('[AntiLink] Kick failed (warn mode):', e.message);
      }
      database.clearAntiWarnings(from, sender, 'antilink');

      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for violating the link policy.*_`,
        mentions: [sender],
      });

    } else {
      const warnEmoji = warnCount === 1 ? '⚠️' : '🔴';
      await sock.sendMessage(from, {
        text:
          `_*${warnEmoji} Antilink — Warning ${warnCount}/${MAX_WARNS}*_\n\n` +
          `_*${senderTag}, do not send links in this group!*_\n\n` +
          `_*📊 Warnings : ${warnCount}/${MAX_WARNS}*_\n` +
          `_*⚠️ ${remaining} more warning${remaining === 1 ? '' : 's'} before you are kicked!*_`,
        mentions: [sender],
      });
    }

  } catch (error) {
    console.error('Error in antilink handler:', error);
  }
};


// Anti-group mention handler

// ─────────────────────────────────────────────────────────────────
//  Anti-Channel Share Handler
//  Detects WhatsApp Channel messages forwarded into groups and
//  applies the configured action: delete / warn / kick.
//
//  Detection covers all known channel share formats:
//   • newsletterMessage  (native channel forward)
//   • forwardedNewsletterMessageInfo in any contextInfo
//   • viewOnceMessage wrapping a channel post
//   • Audio/video/image with newsletter contextInfo
// ─────────────────────────────────────────────────────────────────
const handleAntiChannel = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antichannel) return;

    // ════════════════════════════════════════════════════════
    //  DETECTION — catches all channel share methods:
    //  1. Direct newsletter / channel message types
    //  2. Forwarded channel post (forwardedNewsletterMessageInfo)
    //  3. Channel invite links in message text
    //     (whatsapp.com/channel/... | wa.me/channel/...)
    //
    //  NOTE: protocolMessage type 25 and groupStatusMentionMessage
    //  are WhatsApp status shares — handled by handleAntistatus only.
    //  This handler must NOT act on those.
    // ════════════════════════════════════════════════════════
    let isChannelShare = false;

    if (msg.message) {
      const m = msg.message;

      // 1. Direct newsletter / channel message types
      if (m.newsletterMessage || m.newsletterAdminInviteMessage) {
        isChannelShare = true;
      }

      // 2. Forwarded newsletter info in any contextInfo
      if (!isChannelShare) {
        const ctxSources = [
          m.contextInfo,
          m.extendedTextMessage?.contextInfo,
          m.imageMessage?.contextInfo,
          m.videoMessage?.contextInfo,
          m.audioMessage?.contextInfo,
          m.documentMessage?.contextInfo,
          m.stickerMessage?.contextInfo,
          m.viewOnceMessage?.message?.imageMessage?.contextInfo,
          m.viewOnceMessage?.message?.videoMessage?.contextInfo,
          m.viewOnceMessageV2?.message?.imageMessage?.contextInfo,
          m.viewOnceMessageV2?.message?.videoMessage?.contextInfo,
        ];
        for (const ctx of ctxSources) {
          if (ctx && ctx.forwardedNewsletterMessageInfo) {
            isChannelShare = true;
            break;
          }
        }
      }

      // 3. Channel link in message text
      if (!isChannelShare) {
        const bodyText = (
          m.conversation ||
          m.extendedTextMessage?.text ||
          m.imageMessage?.caption ||
          m.videoMessage?.caption ||
          m.documentMessage?.caption ||
          ''
        );
        const CHANNEL_LINK_PATTERNS = [
          /whatsapp\.com\/channel\//i,
          /wa\.me\/channel\//i,
          /whatsapp\.com\/newsletter\//i,
        ];
        for (const pattern of CHANNEL_LINK_PATTERNS) {
          if (pattern.test(bodyText)) {
            isChannelShare = true;
            break;
          }
        }
      }
    }

    if (!isChannelShare) return;

    // Skip admins and bot owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const action    = (groupSettings.antichannelAction || 'warn').toLowerCase();
    const MAX_WARNS = database.getAntiWarnLimit(from, 'antichannel');
    const senderTag = '@' + sender.split('@')[0];

    // Always delete the offending message first
    try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

    // ── MODE: DELETE ────────────────────────────────────────────────────────
    if (action === 'delete') {
      return;
    }

    // ── MODE: KICK ──────────────────────────────────────────────────────────
    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {
        console.error('[AntiChannel] Kick failed:', e.message);
      }
      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for violating the channel policy.*_`,
        mentions: [sender],
      });
      return;
    }

    // ── MODE: WARN (default) ────────────────────────────────────────────────
    const warnData  = database.addAntiWarning(from, sender, 'antichannel', 'Shared a WhatsApp channel');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    if (warnCount >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {
        console.error('[AntiChannel] Kick failed (warn mode):', e.message);
      }
      database.clearAntiWarnings(from, sender, 'antichannel');

      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for violating the channel policy.*_`,
        mentions: [sender],
      });

    } else {
      const warnEmoji = warnCount === 1 ? '⚠️' : '🔴';
      await sock.sendMessage(from, {
        text:
          `_*${warnEmoji} Antichannel — Warning ${warnCount}/${MAX_WARNS}*_\n\n` +
          `_*${senderTag}, do not share WhatsApp channel content in this group!*_\n\n` +
          `_*📊 Warnings : ${warnCount}/${MAX_WARNS}*_\n` +
          `_*⚠️ ${remaining} more warning${remaining === 1 ? '' : 's'} before you are kicked!*_`,
        mentions: [sender],
      });
    }

  } catch (error) {
    console.error('Error in handleAntiChannel:', error);
  }
};

const handleAntisticker = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antisticker) return;

    // ── Detection: sticker message type ONLY ──────────────────────────────
    // Images, videos, text, and all other message types are NOT affected.
    if (!msg.message?.stickerMessage) return;

    // Skip admins and bot owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const action    = (groupSettings.antistickerAction || 'warn').toLowerCase();
    const MAX_WARNS = database.getAntiWarnLimit(from, 'antisticker');
    const senderTag = '@' + sender.split('@')[0];

    // Always delete the sticker first
    try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

    // ── MODE: DELETE ────────────────────────────────────────────────────────
    if (action === 'delete') {
      return;
    }

    // ── MODE: KICK ──────────────────────────────────────────────────────────
    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {
        console.error('[AntiSticker] Kick failed:', e.message);
      }
      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for sending stickers.*_`,
        mentions: [sender],
      });
      return;
    }

    // ── MODE: WARN (default) ────────────────────────────────────────────────
    // Warning keys use a _sticker suffix to keep counts separate from
    // other warning systems (antilink, antichannel, etc.)
    const warnData  = database.addAntiWarning(from, sender, 'antisticker', 'Sent a sticker');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    if (warnCount >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [sender], 'remove');
      } catch (e) {
        console.error('[AntiSticker] Kick failed (warn mode):', e.message);
      }
      database.clearAntiWarnings(from, sender, 'antisticker');

      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for sending stickers.*_`,
        mentions: [sender],
      });

    } else {
      const warnEmoji = warnCount === 1 ? '⚠️' : '🔴';
      await sock.sendMessage(from, {
        text:
          `_*${warnEmoji} Antisticker — Warning ${warnCount}/${MAX_WARNS}*_\n\n` +
          `_*${senderTag}, do not send stickers in this group!*_\n\n` +
          `_*📊 Warnings : ${warnCount}/${MAX_WARNS}*_\n` +
          `_*⚠️ ${remaining} more warning${remaining === 1 ? '' : 's'} before you are kicked!*_`,
        mentions: [sender],
      });
    }

  } catch (error) {
    console.error('Error in handleAntisticker:', error);
  }
};

const handleAntibot = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antibot) return;

    // Never act on the bot's own messages
    if (msg.key.fromMe) return;

    // Never act on admins or the bot owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    // ════════════════════════════════════════════════════════════════════════
    //  BOT DETECTION — multiple signals, metadata only, never message content
    //
    //  Each signal earns a score. Threshold ≥ 2 = bot detected.
    //  This prevents false positives on normal users while catching bots.
    // ════════════════════════════════════════════════════════════════════════

    const msgKey  = msg.key || {};
    const msgId   = msgKey.id || '';
    const msgBody = msg.message || {};

    let score  = 0;
    const hits = [];

    // ── Signal 1: non-zero agentId (high confidence — weight 3) ─────────
    // Real human WhatsApp clients always send agentId = 0.
    if (typeof msgKey.agentId === 'number' && msgKey.agentId > 0) {
      score += 3;
      hits.push('non-zero agentId=' + msgKey.agentId);
    }

    // ── Signal 2: Baileys bot message ID patterns (high confidence — weight 3)
    // @whiskeysockets/baileys generates IDs starting with "3EB0", "BAE5",
    // "B6AC", or "3A" followed by long uppercase hex strings.
    if (
      /^3EB0[0-9A-F]{14,}$/i.test(msgId) ||
      /^BAE5[0-9A-F]{12,}$/i.test(msgId) ||
      /^B6AC[0-9A-F]{12,}$/i.test(msgId) ||
      /^3A[0-9A-F]{18,}$/i.test(msgId)
    ) {
      score += 3;
      hits.push('bot-style message ID: ' + msgId.slice(0, 12));
    }

    // ── Signal 3: non-zero agent index in sender JID (medium — weight 2) ─
    // Format: "number:agentIndex@s.whatsapp.net"
    // Human = :0, bot = :1, :2, etc.
    const agentMatch = sender.match(/^(\d+):(\d+)@/);
    if (agentMatch && parseInt(agentMatch[2], 10) > 0) {
      score += 2;
      hits.push('non-zero agent index in JID: ' + agentMatch[2]);
    }

    // ── Signal 4: deviceListMetadataVersion without deviceListMetadata (medium — weight 2)
    const ctx = (
      msgBody.extendedTextMessage?.contextInfo ||
      msgBody.imageMessage?.contextInfo ||
      msgBody.videoMessage?.contextInfo ||
      msgBody.contextInfo
    );
    if (
      ctx &&
      typeof ctx.deviceListMetadataVersion === 'number' &&
      ctx.deviceListMetadataVersion > 0 &&
      !ctx.deviceListMetadata
    ) {
      score += 2;
      hits.push('deviceListMetadataVersion without deviceListMetadata');
    }

    // ── Signal 5: no pushName at all (weak — weight 1) ──────────────────
    // Human WhatsApp accounts almost always have a pushName.
    // Bots often have null/empty pushName.
    if (!msg.pushName || msg.pushName.trim() === '') {
      score += 1;
      hits.push('no pushName');
    }

    // ── Signal 6: message ID is all uppercase hex, 20+ chars (weak — weight 1)
    // Baileys-generated IDs tend to be long pure hex strings.
    if (/^[0-9A-F]{20,}$/.test(msgId)) {
      score += 1;
      hits.push('long uppercase hex message ID');
    }

    // ── Signal 7: verifiedBizName present (weak — weight 1) ─────────────
    // Some bot frameworks use verified business accounts.
    if (ctx?.verifiedBizName) {
      score += 1;
      hits.push('verifiedBizName: ' + ctx.verifiedBizName);
    }

    // Debug log — shows in console so you can tune detection
    console.log(
      '[AntiBot] score=' + score +
      ' sender=' + sender +
      ' msgId=' + msgId +
      ' pushName=' + (msg.pushName || '(none)') +
      ' hits=[' + hits.join(', ') + ']'
    );

    // Threshold: score ≥ 2 = likely bot
    const isBotMessage = score >= 2;
    if (!isBotMessage) return;

    console.log('[AntiBot] ✅ Bot detected — executing action: ' + (groupSettings.antibotAction || 'kick'));

    // Confirm bot is admin before acting
    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) {
      console.warn('[AntiBot] Bot is not admin — cannot enforce');
      return;
    }

    const action    = (groupSettings.antibotAction || 'kick').toLowerCase();
    const MAX_WARNS = database.getAntiWarnLimit(from, 'antibot');

    // Normalize JID — strip device suffix for reliable kick
    const target      = sender.includes(':') ? sender.split(':')[0] + '@s.whatsapp.net' : sender;
    const phoneNumber = target.split('@')[0];

    // Always delete the bot message first
    try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

    // ── MODE: DELETE ──────────────────────────────────────────────────────
    if (action === 'delete') return;

    // ── MODE: KICK ────────────────────────────────────────────────────────
    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        console.log('[AntiBot] ✅ Kicked ' + target);
      } catch (e) {
        console.error('[AntiBot] ❌ Kick failed:', e.message);
      }
      await sock.sendMessage(from, {
        text: '_*🤖 @' + phoneNumber + ' has been removed for using a bot in this group.*_',
        mentions: [target],
      });
      return;
    }

    // ── MODE: WARN ────────────────────────────────────────────────────────
    const warnKey   = 'antibot_' + target;
    const warnData  = database.addAntiWarning(from, target, 'antibot', 'Bot-generated message detected');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    if (warnCount >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        console.log('[AntiBot] ✅ Kicked ' + target + ' after ' + warnCount + ' warnings');
      } catch (e) {
        console.error('[AntiBot] ❌ Kick failed (warn):', e.message);
      }
      database.clearAntiWarnings(from, target, 'antibot');
      await sock.sendMessage(from, {
        text: '_*🤖 @' + phoneNumber + ' has been removed for using a bot in this group.*_',
        mentions: [target],
      });
    } else {
      await sock.sendMessage(from, {
        text:
          '_*⚠️ Antibot — Warning ' + warnCount + '/' + MAX_WARNS + '*_\\n\\n' +
          '_*@' + phoneNumber + ', bot usage has been detected!*_\\n\\n' +
          '_*📊 Warnings : ' + warnCount + '/' + MAX_WARNS + '*_\\n' +
          '_*⚠️ ' + remaining + ' more warning' + (remaining === 1 ? '' : 's') + ' before you are kicked!*_',
        mentions: [target],
      });
    }

  } catch (error) {
    console.error('Error in handleAntibot:', error);
  }
};

const handleAntistatus = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antistatus) return;

    // ── Detect WhatsApp status shares only ────────────────────────────────
    // Does NOT trigger on @all / group-wide mentions — only real status shares.
    let isStatusShare = false;

    if (msg.message) {
      const m = msg.message;

      // Shape 1: explicit groupStatusMentionMessage type
      if (m.groupStatusMentionMessage) isStatusShare = true;

      // Shape 2: protocolMessage type 25 (STATUS_MENTION_MESSAGE)
      if (!isStatusShare && m.protocolMessage && m.protocolMessage.type === 25) isStatusShare = true;

      // Shape 3: forwardedNewsletterMessageInfo present in any contextInfo
      const hasNewsletterInfo = (ctx) => !!(ctx && ctx.forwardedNewsletterMessageInfo);
      if (!isStatusShare) {
        isStatusShare =
          hasNewsletterInfo(m.extendedTextMessage?.contextInfo) ||
          hasNewsletterInfo(m.imageMessage?.contextInfo)        ||
          hasNewsletterInfo(m.videoMessage?.contextInfo)        ||
          hasNewsletterInfo(m.audioMessage?.contextInfo)        ||
          hasNewsletterInfo(m.documentMessage?.contextInfo)     ||
          hasNewsletterInfo(m.contextInfo);
      }

      // Shape 4: message forwarded from a status (isForwarded + forwardingScore)
      if (!isStatusShare) {
        const ec = m.extendedTextMessage?.contextInfo;
        if (ec && ec.isForwarded && ec.forwardingScore) isStatusShare = true;
      }
      if (!isStatusShare && m.contextInfo && m.contextInfo.isForwarded && m.contextInfo.forwardingScore) {
        isStatusShare = true;
      }
    }

    if (!isStatusShare) return;

    // Skip admins and bot owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    const action     = groupSettings.antistatusAction || 'warn';
    const MAX_WARNS  = database.getAntiWarnLimit(from, 'antistatus');
    const senderTag  = '@' + sender.split('@')[0];

    // ── MODE: DELETE ────────────────────────────────────────────────────────
    if (action === 'delete') {
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
      return;
    }

    // ── MODE: KICK ──────────────────────────────────────────────────────────
    if (action === 'kick') {
      try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}
      if (botIsAdmin) {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
        } catch (e) {
          console.error('[AntiStatus] Kick failed:', e.message);
        }
      }
      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for violating the group status policy.*_`,
        mentions: [sender],
      });
      return;
    }

    // ── MODE: WARN (default) ────────────────────────────────────────────────
    try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

    const warnData  = database.addAntiWarning(from, sender, 'antistatus', 'Shared WhatsApp status in group');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    if (warnCount >= MAX_WARNS) {
      if (botIsAdmin) {
        try {
          await sock.groupParticipantsUpdate(from, [sender], 'remove');
        } catch (e) {
          console.error('[AntiStatus] Kick failed:', e.message);
        }
      }
      database.clearAntiWarnings(from, sender, 'antistatus');

      await sock.sendMessage(from, {
        text: `_*🚫 ${senderTag} has been removed for violating the group status policy.*_`,
        mentions: [sender],
      });

    } else {
      const warnEmoji = warnCount === 1 ? '⚠️' : '🔴';
      await sock.sendMessage(from, {
        text:
          `_*${warnEmoji} Antistatus — Warning ${warnCount}/${MAX_WARNS}*_\n\n` +
          `_*${senderTag}, do not share your WhatsApp status in this group!*_\n\n` +
          `_*📊 Warnings : ${warnCount}/${MAX_WARNS}*_\n` +
          `_*⚠️ ${remaining} more warning${remaining === 1 ? '' : 's'} before you are kicked!*_`,
        mentions: [sender],
      });
    }

  } catch (error) {
    console.error('Error in handleAntistatus:', error);
  }
};

// Anti-call feature initializer
const initializeAntiCall = (sock) => {
  // Anti-call feature - reject and block incoming calls
  sock.ev.on('call', async (calls) => {
    try {
      // Reload config to get fresh settings
      delete require.cache[require.resolve('./config')];
      const config = require('./config');
      
      if (!config.defaultGroupSettings.anticall) return;

      for (const call of calls) {
        if (call.status === 'offer') {
          // Reject the call
          await sock.rejectCall(call.id, call.from);

          // Block the caller
          await sock.updateBlockStatus(call.from, 'block');

          // Notify user
          await sock.sendMessage(call.from, {
            text: '🚫 Calls are not allowed. You have been blocked.'
          });
        }
      }
    } catch (err) {
      console.error('[ANTICALL ERROR]', err);
    }
  });
};


const handleAntiviewonce = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const settings = database.getGroupSettings(from);
    if (!settings.antiviewonce) return;

    // ── DETECTION ──────────────────────────────────────────────────────────
    const m = msg.message;
    if (!m) return;

    // Log raw keys so we can see exactly what WhatsApp sends
    console.log('[AntiViewonce] rawKeys=' + Object.keys(m).join(',') + ' sender=' + sender + ' action=' + settings.antiviewonceAction);

    // WhatsApp wraps view-once in different layers depending on version:
    //   Modern:   msg.message.viewOnceMessageV2.message
    //   Older:    msg.message.viewOnceMessage.message
    //   Extended: msg.message.viewOnceMessageV2Extension.message
    //   Ephemeral wrap: msg.message.ephemeralMessage.message.viewOnceMessageV2.message
    // We must check ALL layers — ephemeral is the most common in current WhatsApp.

    // Unwrap ephemeral layer first if present
    const outerMsg = m.ephemeralMessage?.message || m;

    const viewOnce =
      outerMsg?.viewOnceMessage?.message ||
      outerMsg?.viewOnceMessageV2?.message ||
      outerMsg?.viewOnceMessageV2Extension?.message ||
      // Also check direct viewOnce flag on media (rare)
      (outerMsg?.imageMessage?.viewOnce ? outerMsg.imageMessage : null) ||
      (outerMsg?.videoMessage?.viewOnce ? outerMsg.videoMessage : null);

    console.log('[AntiViewonce] outerKeys=' + Object.keys(outerMsg).join(',') + ' viewOnce=' + !!viewOnce);

    if (!viewOnce) return;

    // Ignore voice notes — only images and videos are acted on
    if (viewOnce.audioMessage) return;

    // ── PERMISSIONS ────────────────────────────────────────────────────────
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    console.log('[AntiViewonce] botIsAdmin=' + botIsAdmin);
    if (!botIsAdmin) return;

    const action    = (settings.antiviewonceAction || 'kick').toLowerCase();
    const MAX_WARNS = database.getAntiWarnLimit(from, 'antiviewonce');

    // Normalize JID — strip device suffix for reliable kick (e.g. 123:5@s -> 123@s)
    const target      = sender.includes(':') ? sender.split(':')[0] + '@s.whatsapp.net' : sender;
    const phoneNumber = target.split('@')[0];

    // Always delete the view-once message first
    try {
      await sock.sendMessage(from, { delete: msg.key });
      console.log('[AntiViewonce] message deleted');
    } catch (_) {}

    // ── DELETE MODE ────────────────────────────────────────────────────────
    if (action === 'delete') return;

    // ── KICK MODE ──────────────────────────────────────────────────────────
    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        console.log('[AntiViewonce] ✅ Kicked ' + target);
      } catch (e) {
        console.error('[AntiViewonce] ❌ Kick failed:', e.message);
      }
      await sock.sendMessage(from, {
        text: '_*🚫 @' + phoneNumber + ' has been removed for sending view-once media.*_',
        mentions: [target],
      });
      return;
    }

    // ── WARN MODE ──────────────────────────────────────────────────────────
    const warnData  = database.addAntiWarning(from, target, 'antiviewonce', 'Sent view-once media in group');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    console.log('[AntiViewonce] warn count=' + warnCount + '/' + MAX_WARNS);

    if (warnCount >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        console.log('[AntiViewonce] ✅ Kicked ' + target + ' after ' + warnCount + ' warnings');
      } catch (e) {
        console.error('[AntiViewonce] ❌ Kick failed (warn):', e.message);
      }
      database.clearAntiWarnings(from, target, 'antiviewonce');
      await sock.sendMessage(from, {
        text: '_*🚫 @' + phoneNumber + ' has been removed for sending view-once media.*_',
        mentions: [target],
      });
    } else {
      await sock.sendMessage(from, {
        text:
          '_*⚠️ Antiviewonce — Warning ' + warnCount + '/' + MAX_WARNS + '*_\n\n' +
          '_*@' + phoneNumber + ', do not send view-once media in this group!*_\n\n' +
          '_*📊 Warnings : ' + warnCount + '/' + MAX_WARNS + '*_\n' +
          '_*⚠️ ' + remaining + ' more warning' + (remaining === 1 ? '' : 's') + ' before you are kicked!*_',
        mentions: [target],
      });
    }

  } catch (err) {
    console.error('[AntiViewonce] Error:', err.message);
  }
};


const handleAntimedia = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antimedia) return;

    // Detect photos and videos ONLY — ignore text, stickers, docs, audio
    const m = msg.message || {};
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.viewOnceMessage?.message ||
      m;

    const isMedia = !!(
      inner.imageMessage ||
      inner.videoMessage
    );

    // Exclude GIFs (videoMessage with gifPlayback = true)
    const isGif = !!(inner.videoMessage?.gifPlayback);

    if (!isMedia || isGif) return;

    // Skip admins and owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const action    = (groupSettings.antimediaAction || 'kick').toLowerCase();
    const MAX_WARNS = database.getAntiWarnLimit(from, 'antimedia');

    // Normalize JID — strip device suffix for reliable kick and mention
    const target      = sender.includes(':') ? sender.split(':')[0] + '@s.whatsapp.net' : sender;
    const phoneNumber = target.split('@')[0];

    // Always delete the media message first
    try { await sock.sendMessage(from, { delete: msg.key }); } catch (_) {}

    // ── MODE: DELETE ──────────────────────────────────────────────────────
    if (action === 'delete') return;

    // ── MODE: KICK ────────────────────────────────────────────────────────
    if (action === 'kick') {
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        console.log('[AntiMedia] Kicked ' + target);
      } catch (e) {
        console.error('[AntiMedia] Kick failed:', e.message);
      }
      await sock.sendMessage(from, {
        text: '_*🚫 @' + phoneNumber + ' has been removed for sending media in this group.*_',
        mentions: [target],
      });
      return;
    }

    // ── MODE: WARN ────────────────────────────────────────────────────────
    const warnData  = database.addAntiWarning(from, target, 'antimedia', 'Sent media (photo/video) in group');
    const warnCount = warnData.count;
    const remaining = MAX_WARNS - warnCount;

    if (warnCount >= MAX_WARNS) {
      try {
        await sock.groupParticipantsUpdate(from, [target], 'remove');
        console.log('[AntiMedia] Kicked ' + target + ' after ' + warnCount + ' warnings');
      } catch (e) {
        console.error('[AntiMedia] Kick failed (warn):', e.message);
      }
      database.clearAntiWarnings(from, target, 'antimedia');
      await sock.sendMessage(from, {
        text: '_*🚫 @' + phoneNumber + ' has been removed for sending media in this group.*_',
        mentions: [target],
      });
    } else {
      await sock.sendMessage(from, {
        text:
          '_*⚠️ Antimedia — Warning ' + warnCount + '/' + MAX_WARNS + '*_\n\n' +
          '_*@' + phoneNumber + ', do not send photos or videos in this group!*_\n\n' +
          '_*📊 Warnings : ' + warnCount + '/' + MAX_WARNS + '*_\n' +
          '_*⚠️ ' + remaining + ' more warning' + (remaining === 1 ? '' : 's') + ' before you are kicked!*_',
        mentions: [target],
      });
    }

  } catch (error) {
    console.error('Error in handleAntimedia:', error);
  }
};

// ─── In-memory spam tracker (per group per user) ──────────────────────────────
// Structure: spamCache[feature][groupId][userId] = { count, lastTime, keys: [] }
// `keys` holds msg.key of every message in the current spam window so we
// can bulk-delete all of them when the threshold is reached.
const spamCache = {};

function getSpamEntry(feature, groupId, userId) {
  if (!spamCache[feature]) spamCache[feature] = {};
  if (!spamCache[feature][groupId]) spamCache[feature][groupId] = {};
  if (!spamCache[feature][groupId][userId]) {
    spamCache[feature][groupId][userId] = { count: 0, lastTime: 0, keys: [] };
  }
  return spamCache[feature][groupId][userId];
}

function resetSpamEntry(feature, groupId, userId) {
  if (spamCache[feature]?.[groupId]?.[userId]) {
    spamCache[feature][groupId][userId] = { count: 0, lastTime: 0, keys: [] };
  }
}

// Delete every collected spam message key, then clear the key list.
async function deleteSpamMessages(sock, from, entry) {
  const keys = entry.keys.slice(); // snapshot
  entry.keys = [];                 // clear immediately to avoid double-delete
  for (const key of keys) {
    try { await sock.sendMessage(from, { delete: key }); } catch (_) {}
  }
}

// ─── Shared action executor for spam systems ──────────────────────────────────
async function executeSpamAction(sock, msg, from, sender, feature, label, violationReason, entry) {
  const groupSettings = database.getGroupSettings(from);
  const action   = (groupSettings[feature + 'Action'] || 'delete').toLowerCase();
  const MAX_WARNS = database.getAntiWarnLimit(from, feature);

  const target      = sender.includes(':') ? sender.split(':')[0] + '@s.whatsapp.net' : sender;
  const phoneNumber = target.split('@')[0];
  const senderTag   = '@' + phoneNumber;

  // Delete ALL spam messages collected in this window (bulk delete)
  await deleteSpamMessages(sock, from, entry);

  // ── MODE: DELETE ────────────────────────────────────────────────────────
  if (action === 'delete') return;

  // ── MODE: KICK ──────────────────────────────────────────────────────────
  if (action === 'kick') {
    try {
      await sock.groupParticipantsUpdate(from, [target], 'remove');
    } catch (e) {
      console.error('[' + label + '] Kick failed:', e.message);
    }
    await sock.sendMessage(from, {
      text: '_*🚫 ' + senderTag + ' has been removed for spamming.*_',
      mentions: [target],
    });
    resetSpamEntry(feature, from, sender);
    return;
  }

  // ── MODE: WARN (default) ────────────────────────────────────────────────
  const warnData  = database.addAntiWarning(from, target, feature, violationReason);
  const warnCount = warnData.count;
  const remaining = MAX_WARNS - warnCount;

  if (warnCount >= MAX_WARNS) {
    try {
      await sock.groupParticipantsUpdate(from, [target], 'remove');
    } catch (e) {
      console.error('[' + label + '] Kick failed (warn):', e.message);
    }
    database.clearAntiWarnings(from, target, feature);
    resetSpamEntry(feature, from, sender);
    await sock.sendMessage(from, {
      text: '_*🚫 ' + senderTag + ' has been removed for spamming.*_',
      mentions: [target],
    });
  } else {
    const warnEmoji = warnCount === 1 ? '⚠️' : '🔴';
    await sock.sendMessage(from, {
      text:
        '_*' + warnEmoji + ' ' + label + ' — Warning ' + warnCount + '/' + MAX_WARNS + '*_\n\n' +
        '_*' + senderTag + ', stop spamming in this group!*_\n\n' +
        '_*📊 Warnings : ' + warnCount + '/' + MAX_WARNS + '*_\n' +
        '_*⚠️ ' + remaining + ' more warning' + (remaining === 1 ? '' : 's') + ' before you are kicked!*_',
      mentions: [target],
    });
  }
}

// ─── handleAntistickerSpam ────────────────────────────────────────────────────
const handleAntistickerSpam = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antistickerSpam) return;

    // Only act on sticker messages
    if (!msg.message?.stickerMessage) return;

    // Skip admins and bot owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const spamCount = groupSettings.antistickerSpamCount  ?? 6;
    const timeGapMs = (groupSettings.antistickerSpamTimegap ?? 3) * 1000;

    const entry = getSpamEntry('antistickerSpam', from, sender);
    const now   = Date.now();

    if (now - entry.lastTime < timeGapMs) {
      // Within time gap — increment spam counter and record this message key
      entry.count++;
      entry.keys.push(msg.key);
    } else {
      // Gap elapsed — reset counter and key list, start fresh with this message
      entry.count = 1;
      entry.keys = [msg.key];
    }
    entry.lastTime = now;

    console.log('[AntistickerSpam] ' + sender.split('@')[0] + ' count=' + entry.count + '/' + spamCount);

    if (entry.count >= spamCount) {
      entry.count = 0; // reset after action
      await executeSpamAction(sock, msg, from, sender, 'antistickerSpam', 'AntiSticker Spam', 'Sticker spam', entry);
    }
    // Note: messages below the threshold are NOT silently deleted —
    // they are kept in entry.keys and only removed if/when spam is confirmed.

  } catch (error) {
    console.error('[AntistickerSpam] Error:', error.message);
  }
};

// ─── handleAntimessageSpam ────────────────────────────────────────────────────
const handleAntimessageSpam = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.antimessageSpam) return;

    // Only act on plain text messages — ignore stickers, media, commands
    const m     = msg.message || {};
    const inner = m.ephemeralMessage?.message || m.viewOnceMessageV2?.message || m.viewOnceMessage?.message || m;
    const isText = !!(inner.conversation || inner.extendedTextMessage);
    if (!isText) return;

    // Ignore bot commands (starts with prefix)
    const text = (inner.conversation || inner.extendedTextMessage?.text || '').trim();
    const prefix = '.';
    if (text.startsWith(prefix)) return;

    // Skip admins and bot owner
    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    const senderIsOwner = isOwner(sender);
    if (senderIsAdmin || senderIsOwner) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    const spamCount = groupSettings.antimessageSpamCount  ?? 6;
    const timeGapMs = (groupSettings.antimessageSpamTimegap ?? 3) * 1000;

    const entry = getSpamEntry('antimessageSpam', from, sender);
    const now   = Date.now();

    if (now - entry.lastTime < timeGapMs) {
      // Within time gap — increment spam counter and record this message key
      entry.count++;
      entry.keys.push(msg.key);
    } else {
      // Gap elapsed — reset counter and key list, start fresh with this message
      entry.count = 1;
      entry.keys = [msg.key];
    }
    entry.lastTime = now;

    console.log('[AntimessageSpam] ' + sender.split('@')[0] + ' count=' + entry.count + '/' + spamCount);

    if (entry.count >= spamCount) {
      entry.count = 0; // reset after action
      await executeSpamAction(sock, msg, from, sender, 'antimessageSpam', 'AntiMessage Spam', 'Message spam', entry);
    }

  } catch (error) {
    console.error('[AntimessageSpam] Error:', error.message);
  }
};


// ─── Auto Delete Handler ──────────────────────────────────────────────────────
const handleAutodelete = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    const groupSettings = database.getGroupSettings(from);
    if (!groupSettings.autodelete) return;

    if (msg.key.fromMe) return;
    if (isOwner(sender)) return;

    const senderIsAdmin = await isAdmin(sock, sender, from, groupMetadata);
    if (senderIsAdmin) return;

    const botIsAdmin = await isBotAdmin(sock, from, groupMetadata);
    if (!botIsAdmin) return;

    try {
      await sock.sendMessage(from, { delete: msg.key });
    } catch (_) {}

  } catch (error) {
    console.error('[AutoDelete] Error:', error.message);
  }
};

module.exports = {
  handleMessage,
  handleGroupUpdate,
  handleAntilink,
  handleAntistatus,
  handleAntiChannel,
  handleAntisticker,
  handleAntibot,
  handleAntiviewonce,
  handleAntimedia,
  handleAntistickerSpam,
  handleAntimessageSpam,
  handleAutodelete,
  initializeAntiCall,
  isOwner,
  isAdmin,
  isBotAdmin,
  isMod,
  isSudo,
  getGroupMetadata,
  findParticipant
};
