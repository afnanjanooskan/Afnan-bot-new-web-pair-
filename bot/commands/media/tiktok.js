/**
 * TikTok Downloader (.tiktok / .tt)
 * Downloads TikTok videos without watermark using multi-endpoint fallback.
 *
 * Features:
 *  - URL validation (tiktok.com, vm.tiktok.com, vt.tiktok.com)
 *  - 7-second per-user anti-spam cooldown
 *  - 5-endpoint fallback via APIs.getTikTokDownload()
 *  - Full caption: username, title, likes, comments, shares
 *  - 50 MB file-size guard before sending
 *  - Debug logging at every stage
 */

'use strict';

const axios  = require('axios');
const APIs   = require('../../utils/api');
const config = require('../../config');

// ── Anti-spam cooldown ───────────────────────────────────────────────────────
const COOLDOWN_MS = 7000; // 7 seconds
const cooldowns   = new Map();

// ── WhatsApp practical video size limit ─────────────────────────────────────
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatCount(n) {
  if (n == null) return 'N/A';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
  name: 'tiktok',
  aliases: ['tt', 'ttdl', 'tiktokdl'],
  category: 'media',
  description: 'Download TikTok videos without watermark',
  usage: '.tt <TikTok URL>',

  async execute(sock, msg, args, extra) {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    try {
      // ── 1. Anti-spam check ───────────────────────────────────────────────
      const lastUsed  = cooldowns.get(sender) || 0;
      const remaining = COOLDOWN_MS - (Date.now() - lastUsed);
      if (remaining > 0) {
        return await sock.sendMessage(from, {
          text: `⏳ Please wait *${Math.ceil(remaining / 1000)}s* before using this command again.`,
        }, { quoted: msg });
      }
      cooldowns.set(sender, Date.now());
      // Clean up old entries to avoid memory leak
      if (cooldowns.size > 500) {
        const cutoff = Date.now() - COOLDOWN_MS * 2;
        for (const [k, v] of cooldowns) {
          if (v < cutoff) cooldowns.delete(k);
        }
      }

      // ── 2. Validate input ────────────────────────────────────────────────
      const url = args.join(' ').trim();

      if (!url) {
        return await sock.sendMessage(from, {
          text: '❌ Please provide a valid TikTok video link.\n\nUsage: *.tt <TikTok URL>*',
        }, { quoted: msg });
      }

      const isTikTok =
        /tiktok\.com/i.test(url) ||
        /vm\.tiktok/i.test(url)  ||
        /vt\.tiktok/i.test(url);

      if (!isTikTok) {
        return await sock.sendMessage(from, {
          text: '❌ That is not a valid TikTok link.\n\nExample: *.tt https://www.tiktok.com/@user/video/...*',
        }, { quoted: msg });
      }

      // ── 3. Loading indicator ─────────────────────────────────────────────
      await sock.sendMessage(from, { react: { text: '⏳', key: msg.key } });
      await sock.sendMessage(from, {
        text: '⏳ Downloading TikTok video...',
      }, { quoted: msg });

      // ── 4. Fetch video via multi-endpoint fallback ───────────────────────
      let videoUrl = null;
      let title    = null;
      let username = null;
      let likes    = null;
      let comments = null;
      let shares   = null;

      try {
        const result = await APIs.getTikTokDownload(url);
        console.log('[TikTok] getTikTokDownload result:', JSON.stringify(result));

        videoUrl = result.videoUrl || null;
        title    = result.title    || null;
        username = result.username || null;
        likes    = result.likes    ?? null;
        comments = result.comments ?? null;
        shares   = result.shares   ?? null;

        console.log('[TikTok] videoUrl resolved to:', videoUrl);
      } catch (err) {
        console.error('[TikTok] All endpoints failed:', err.message);
      }

      // ── 5. Handle no video URL ───────────────────────────────────────────
      if (!videoUrl) {
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
        return await sock.sendMessage(from, {
          text: '⚠️ Failed to fetch video. Try again later.\n\nPossible reasons:\n• The video is private\n• The link is expired\n• All download APIs are temporarily down',
        }, { quoted: msg });
      }

      // ── 6. Validate & download buffer ───────────────────────────────────
      // Ensure URL is absolute (relative paths already resolved in api.js,
      // but guard here too for any future endpoint changes).
      if (videoUrl.startsWith('/')) {
        videoUrl = 'https://www.tikwm.com' + videoUrl;
        console.log('[TikTok] Relative URL resolved to:', videoUrl);
      }

      // Strip query strings for the extension check only
      const urlPath = videoUrl.split('?')[0];
      if (!urlPath.endsWith('.mp4')) {
        console.warn('[TikTok] videoUrl does not end with .mp4 — may be audio-only stream. url:', videoUrl);
      }

      let videoBuffer = null;
      try {
        const resp = await axios.get(videoUrl, {
          responseType:     'arraybuffer',
          timeout:           60000,
          maxRedirects:      10,
          maxContentLength:  MAX_BYTES + 1024,
          headers: {
            'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer':         'https://www.tiktok.com/',
            'Accept':          'video/mp4,video/*;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });

        // Validate the response is actually video content
        const contentType = resp.headers?.['content-type'] || '';
        console.log('[TikTok] Response content-type:', contentType, '| size:', resp.data?.byteLength);

        if (contentType.includes('audio') && !contentType.includes('video')) {
          console.warn('[TikTok] Server returned audio-only stream! Aborting this URL.');
          videoBuffer = null;
        } else if (resp.data && resp.data.byteLength > 1000) {
          videoBuffer = Buffer.from(resp.data);
          console.log('[TikTok] Downloaded buffer size:', videoBuffer.length, 'bytes');
        }
      } catch (dlErr) {
        console.error('[TikTok] Buffer download failed:', dlErr.message);
      }

      if (!videoBuffer) {
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
        return await sock.sendMessage(from, {
          text: '⚠️ Found the video but could not download it.\n\nPossible causes:\n• Video URL expired\n• TikTok CDN blocked the request\n• Network timeout — please try again',
        }, { quoted: msg });
      }

      // ── 7. File size guard ───────────────────────────────────────────────
      if (videoBuffer.length > MAX_BYTES) {
        await sock.sendMessage(from, { react: { text: '❌', key: msg.key } });
        return await sock.sendMessage(from, {
          text: `⚠️ Video is too large to send (${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB).\nWhatsApp limit is ~50 MB.`,
        }, { quoted: msg });
      }

      // ── 8. Build caption ─────────────────────────────────────────────────
      const botName = config.botName ? config.botName.toUpperCase() : 'BOT';
      const lines   = ['🎬 *TikTok Video Downloaded*\n'];

      if (username) lines.push(`👤 *User:* @${username}`);
      if (title)    lines.push(`📝 *Caption:* ${title}`);
      lines.push('');
      lines.push(`❤️ *Likes:*    ${formatCount(likes)}`);
      lines.push(`💬 *Comments:* ${formatCount(comments)}`);
      lines.push(`🔁 *Shares:*   ${formatCount(shares)}`);
      lines.push(`\n_Downloaded by ${botName}_`);

      const caption = lines.join('\n');

      // ── 9. Send video ────────────────────────────────────────────────────
      await sock.sendMessage(from, {
        video:    videoBuffer,   // Buffer — ensures WhatsApp treats it as video/mp4
        mimetype: 'video/mp4',   // Explicit MIME — never audio/mp4 or auto-detected
        caption,
      }, { quoted: msg });

      await sock.sendMessage(from, { react: { text: '✅', key: msg.key } });

    } catch (error) {
      console.error('[TikTok] Unexpected error:', error.message);
      await sock.sendMessage(from, { react: { text: '❌', key: msg.key } }).catch(() => {});
      await sock.sendMessage(from, {
        text: '❌ An unexpected error occurred while downloading. Please try again later.',
      }, { quoted: msg });
    }
  },
};
