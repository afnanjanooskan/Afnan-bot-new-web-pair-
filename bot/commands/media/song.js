/**
 * Song Downloader - Download audio from YouTube
 */

const yts = require('yt-search');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const APIs = require('../../utils/api');
const { toAudio } = require('../../utils/converter');

module.exports = {
  name: 'song',
  aliases: ['play', 'music', 'yta'],
  category: 'media',
  description: 'Download audio from YouTube',
  usage: '.song <song name or YouTube link>',

  async execute(sock, msg, args) {
    try {
      const text = args.join(' ');
      const chatId = msg.key.remoteJid;

      if (!text) {
        return await sock.sendMessage(chatId, {
          text: '🎵 Usage: .song <song name or YouTube link>'
        }, { quoted: msg });
      }

      let videoUrl = '';
      let videoTitle = '';
      let videoThumbnail = '';
      let videoDuration = '';

      // Determine if input is a direct YouTube URL or a search query
      if (text.includes('youtube.com') || text.includes('youtu.be')) {
        videoUrl = text;
        // Extract ID for thumbnail fallback
        const ytId = (text.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
        videoThumbnail = ytId ? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` : '';
        videoTitle = 'YouTube Audio';
      } else {
        const search = await yts(text);
        if (!search || !search.videos.length) {
          return await sock.sendMessage(chatId, {
            text: '❌ No results found for: ' + text
          }, { quoted: msg });
        }
        const video = search.videos[0];
        videoUrl = video.url;
        videoTitle = video.title;
        // yts returns both .thumbnail and .image — use whichever is available
        videoThumbnail = video.thumbnail || video.image || '';
        videoDuration = video.timestamp || '';
      }

      // Send info card — skip image if no thumbnail to avoid crash
      try {
        const caption = `🎵 Downloading: *${videoTitle || 'Audio'}*${videoDuration ? `\n⏱ Duration: ${videoDuration}` : ''}`;
        if (videoThumbnail) {
          await sock.sendMessage(chatId, {
            image: { url: videoThumbnail },
            caption
          }, { quoted: msg });
        } else {
          await sock.sendMessage(chatId, { text: caption }, { quoted: msg });
        }
      } catch (thumbErr) {
        // If thumbnail send fails, send text fallback and keep going
        await sock.sendMessage(chatId, {
          text: `🎵 Downloading: *${videoTitle || 'Audio'}*`
        }, { quoted: msg }).catch(() => {});
      }

      // Try multiple APIs with fallback chain
      let audioData;
      let audioBuffer;
      let downloadSuccess = false;

      const apiMethods = [
        { name: 'EliteProTech', method: () => APIs.getEliteProTechDownloadByUrl(videoUrl) },
        { name: 'Yupra',        method: () => APIs.getYupraDownloadByUrl(videoUrl) },
        { name: 'Okatsu',       method: () => APIs.getOkatsuDownloadByUrl(videoUrl) },
        { name: 'Izumi',        method: () => APIs.getIzumiDownloadByUrl(videoUrl) },
        { name: 'PublicYT',     method: () => APIs.getPublicYtMp3ByUrl(videoUrl) },
      ];

      for (const apiMethod of apiMethods) {
        try {
          audioData = await apiMethod.method();
          const audioUrl = audioData.download || audioData.dl || audioData.url;

          if (!audioUrl) {
            console.log(`[Song] ${apiMethod.name} returned no download URL, trying next...`);
            continue;
          }

          // Try arraybuffer download
          try {
            const audioResponse = await axios.get(audioUrl, {
              responseType: 'arraybuffer',
              timeout: 90000,
              maxContentLength: Infinity,
              maxBodyLength: Infinity,
              decompress: true,
              validateStatus: s => s >= 200 && s < 400,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'identity'
              }
            });
            audioBuffer = Buffer.from(audioResponse.data);
            if (audioBuffer && audioBuffer.length > 0) {
              downloadSuccess = true;
              break;
            }
          } catch (downloadErr) {
            const statusCode = downloadErr.response?.status;
            if (statusCode === 451) {
              console.log(`[Song] Download blocked (451) from ${apiMethod.name}, trying next...`);
              continue;
            }
            // Fallback: stream mode
            try {
              const audioResponse = await axios.get(audioUrl, {
                responseType: 'stream',
                timeout: 90000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                validateStatus: s => s >= 200 && s < 400,
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept': '*/*',
                  'Accept-Encoding': 'identity'
                }
              });
              const chunks = [];
              await new Promise((resolve, reject) => {
                audioResponse.data.on('data', c => chunks.push(c));
                audioResponse.data.on('end', resolve);
                audioResponse.data.on('error', reject);
              });
              audioBuffer = Buffer.concat(chunks);
              if (audioBuffer && audioBuffer.length > 0) {
                downloadSuccess = true;
                break;
              }
            } catch (streamErr) {
              console.log(`[Song] Stream download failed from ${apiMethod.name}:`, streamErr.message);
              continue;
            }
          }
        } catch (apiErr) {
          console.log(`[Song] ${apiMethod.name} API failed:`, apiErr.message);
          continue;
        }
      }

      if (!downloadSuccess || !audioBuffer || audioBuffer.length === 0) {
        throw new Error('All download sources failed. The content may be unavailable or blocked in your region.');
      }

      // Detect format from file signature
      const firstBytes = audioBuffer.slice(0, 12);
      const asciiSignature = firstBytes.toString('ascii', 4, 8);

      let fileExtension = 'mp3';

      if (asciiSignature === 'ftyp' || firstBytes.slice(4, 8).toString('ascii') === 'ftyp') {
        fileExtension = 'm4a';
      } else if (
        audioBuffer.toString('ascii', 0, 3) === 'ID3' ||
        (audioBuffer[0] === 0xFF && (audioBuffer[1] & 0xE0) === 0xE0)
      ) {
        fileExtension = 'mp3';
      } else if (audioBuffer.toString('ascii', 0, 4) === 'OggS') {
        fileExtension = 'ogg';
      } else if (audioBuffer.toString('ascii', 0, 4) === 'RIFF') {
        fileExtension = 'wav';
      } else {
        fileExtension = 'm4a';
      }

      // Convert to MP3 if needed
      let finalBuffer = audioBuffer;
      if (fileExtension !== 'mp3') {
        try {
          finalBuffer = await toAudio(audioBuffer, fileExtension);
          if (!finalBuffer || finalBuffer.length === 0) throw new Error('Empty buffer after conversion');
        } catch (convErr) {
          throw new Error(`Conversion to MP3 failed: ${convErr.message}`);
        }
      }

      const safeTitle = (audioData?.title || videoTitle || 'song').replace(/[^\w\s-]/g, '').trim() || 'song';

      await sock.sendMessage(chatId, {
        audio: finalBuffer,
        mimetype: 'audio/mpeg',
        fileName: `${safeTitle}.mp3`,
        ptt: false
      }, { quoted: msg });

      // Cleanup temp files
      try {
        const tempDir = path.join(__dirname, '../../temp');
        if (fs.existsSync(tempDir)) {
          const now = Date.now();
          fs.readdirSync(tempDir).forEach(file => {
            const filePath = path.join(tempDir, file);
            try {
              const stats = fs.statSync(filePath);
              if (now - stats.mtimeMs > 10000 &&
                  (file.endsWith('.mp3') || file.endsWith('.m4a') || /^\d+\.(mp3|m4a|ogg|wav)$/.test(file))) {
                fs.unlinkSync(filePath);
              }
            } catch (_) {}
          });
        }
      } catch (_) {}

    } catch (err) {
      console.error('[Song] Command error:', err.message);

      let errorMessage = '❌ Failed to download song.';
      if (err.message?.includes('blocked') || err.message?.includes('451')) {
        errorMessage = '❌ Download blocked. This content may be restricted in your region.';
      } else if (err.message?.includes('All download sources failed')) {
        errorMessage = '❌ All download sources failed. Please try again or use a direct YouTube link.';
      } else if (err.message?.includes('Conversion')) {
        errorMessage = '❌ Audio conversion failed. Please try again.';
      }

      await sock.sendMessage(msg.key.remoteJid, {
        text: errorMessage
      }, { quoted: msg });
    }
  }
};
