/**
 * API Integration Utilities
 */

const axios = require('axios');

const api = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
});

// API Endpoints
const APIs = {
  // Image Generation
  generateImage: async (prompt) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/ai/stablediffusion`, {
        params: { prompt }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to generate image');
    }
  },
  
  // AI Chat - multi-endpoint fallback (no hardcoded invalid keys)
  chatAI: async (text) => {
    const endpoints = [
      async () => {
        const res = await api.get('https://api.siputzx.my.id/api/ai/chatgpt', {
          params: { text },
          timeout: 15000,
        });
        if (res.data && res.data.data) return { msg: res.data.data };
        if (res.data && res.data.result) return { msg: res.data.result };
        throw new Error('No data');
      },
      async () => {
        const res = await api.get('https://api.siputzx.my.id/api/ai/llama', {
          params: { text },
          timeout: 15000,
        });
        if (res.data && res.data.data) return { msg: res.data.data };
        if (res.data && res.data.result) return { msg: res.data.result };
        throw new Error('No data');
      },
    ];
    for (const fn of endpoints) {
      try { return await fn(); } catch (_) {}
    }
    throw new Error('All AI endpoints are currently unavailable. Please try again later.');
  },
  
  // YouTube Download
  ytDownload: async (url, type = 'audio') => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/d/ytmp3`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download YouTube video');
    }
  },
  
  // Instagram Download
  igDownload: async (url) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/d/igdl`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to download Instagram content');
    }
  },
  
  // TikTok Download (legacy alias — delegates to getTikTokDownload)
  // NOTE: The old siputzx endpoint is broken/outdated. This now forwards
  // to the multi-endpoint fallback below so existing callers still work.
  tiktokDownload: async (url) => {
    return APIs.getTikTokDownload(url);
  },
  
  // Translate
  translate: async (text, to = 'en') => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/tools/translate`, {
        params: { text, to }
      });
      return response.data;
    } catch (error) {
      throw new Error('Translation failed');
    }
  },
  
  // Random Meme
  getMeme: async () => {
    try {
      const response = await api.get('https://meme-api.com/gimme');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch meme');
    }
  },
  
  // Random Quote
  getQuote: async () => {
    try {
      const response = await api.get('https://api.quotable.io/random');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch quote');
    }
  },
  
  // Random Joke
  getJoke: async () => {
    try {
      const response = await api.get('https://official-joke-api.appspot.com/random_joke');
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch joke');
    }
  },
  
  // Weather
  getWeather: async (city) => {
    try {
      const response = await api.get(`https://api.siputzx.my.id/api/tools/weather`, {
        params: { city }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to fetch weather');
    }
  },
  
  // Shorten URL
  shortenUrl: async (url) => {
    try {
      const response = await api.get(`https://tinyurl.com/api-create.php`, {
        params: { url }
      });
      return response.data;
    } catch (error) {
      throw new Error('Failed to shorten URL');
    }
  },
  
  // Wikipedia Search
  wikiSearch: async (query) => {
    try {
      const response = await api.get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      return response.data;
    } catch (error) {
      throw new Error('Wikipedia search failed');
    }
  },
  
  // Song Download APIs
  getIzumiDownloadByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube?url=${encodeURIComponent(youtubeUrl)}&format=mp3`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.download) return res.data.result;
    throw new Error('Izumi youtube?url returned no download');
  },
  
  getIzumiDownloadByQuery: async (query) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://izumiiiiiiii.dpdns.org/downloader/youtube-play?query=${encodeURIComponent(query)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.download) return res.data.result;
    throw new Error('Izumi youtube-play returned no download');
  },
  
  getYupraDownloadByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
      return {
        download: res.data.data.download_url,
        title: res.data.data.title,
        thumbnail: res.data.data.thumbnail
      };
    }
    throw new Error('Yupra returned no download');
  },
  
  getOkatsuDownloadByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.dl) {
      return {
        download: res.data.dl,
        title: res.data.title,
        thumbnail: res.data.thumb
      };
    }
    throw new Error('Okatsu ytmp3 returned no download');
  },
  
  getEliteProTechDownloadByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp3`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
      return {
        download: res.data.downloadURL,
        title: res.data.title
      };
    }
    throw new Error('EliteProTech ytdown returned no download');
  },
  
  
  // Fallback: public yt-api.p.rapidapi alternative using y2mate style
  getPublicYtMp3ByUrl: async (youtubeUrl) => {
    const ytId = (youtubeUrl.match(/(?:youtu\.be\/|v=)([a-zA-Z0-9_-]{11})/) || [])[1];
    if (!ytId) throw new Error('Could not extract YouTube ID');
    
    // Use yt-api.p.rapidapi.com (free tier) — no key needed for basic endpoints
    // Fallback to a known working public converter
    const endpoints = [
      async () => {
        const res = await axios.get(
          `https://yt-api.p.rapidapi.com/dl?id=${ytId}`,
          {
            timeout: 30000,
            headers: {
              'X-RapidAPI-Key': 'SIGN-UP-FOR-KEY',
              'X-RapidAPI-Host': 'yt-api.p.rapidapi.com'
            }
          }
        );
        const fmt = (res.data?.adaptiveFormats || []).find(f => f.mimeType?.includes('audio'));
        if (fmt?.url) return { download: fmt.url, title: res.data?.title };
        throw new Error('No audio format');
      },
      async () => {
        // cobalt.tools open API — no key required
        const res = await axios.post(
          'https://api.cobalt.tools/',
          { url: youtubeUrl, isAudioOnly: true, aFormat: 'mp3', filenamePattern: 'basic' },
          {
            timeout: 30000,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'User-Agent': 'Mozilla/5.0'
            }
          }
        );
        if (res.data?.url) return { download: res.data.url, title: res.data?.filename || 'audio' };
        throw new Error('Cobalt returned no URL');
      }
    ];
    
    for (const fn of endpoints) {
      try { return await fn(); } catch (_) {}
    }
    throw new Error('Public YT MP3 APIs all failed');
  },
  
  getEliteProTechVideoByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp4`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.downloadURL) {
      return {
        download: res.data.downloadURL,
        title: res.data.title
      };
    }
    throw new Error('EliteProTech ytdown video returned no download');
  },
  
  // Video Download APIs
  getYupraVideoByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.success && res?.data?.data?.download_url) {
      return {
        download: res.data.data.download_url,
        title: res.data.data.title,
        thumbnail: res.data.data.thumbnail
      };
    }
    throw new Error('Yupra returned no download');
  },
  
  getOkatsuVideoByUrl: async (youtubeUrl) => {
    const AXIOS_DEFAULTS = {
      timeout: 60000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };
    
    const tryRequest = async (getter, attempts = 3) => {
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await getter();
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    };
    
    const apiUrl = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(youtubeUrl)}`;
    const res = await tryRequest(() => axios.get(apiUrl, AXIOS_DEFAULTS));
    if (res?.data?.result?.mp4) {
      return { download: res.data.result.mp4, title: res.data.result.title };
    }
    throw new Error('Okatsu ytmp4 returned no mp4');
  },
  
  // TikTok Download API — multi-endpoint fallback with debug logging
  getTikTokDownload: async (url) => {
    console.log('[TikTok] getTikTokDownload called with url:', url);
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const FORM_HEADERS = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Accept': 'application/json, */*',
    };
    const JSON_HEADERS = {
      'User-Agent': UA,
      'Accept': 'application/json, */*',
    };

    // ── Endpoint 1: tikwm.com ────────────────────────────────────────────
    // High-reliability POST API, no key required, returns HD + no-watermark URLs.
    try {
      console.log('[TikTok] Trying Endpoint 1: tikwm.com');
      const res = await axios.post(
        'https://www.tikwm.com/api/',
        new URLSearchParams({ url, count: 12, cursor: 0, web: 1, hd: 1 }).toString(),
        { timeout: 20000, headers: FORM_HEADERS }
      );
      const d = res.data?.data;
      if (d && (d.play || d.hdplay || d.wmplay)) {
        // Prefer d.play — always a full audio+video MP4.
        // d.hdplay often returns a relative path that tikwm serves as audio-only.
        let videoUrl = d.play || d.wmplay;
        let hdUrl    = d.hdplay || null;

        // Resolve any relative paths to full tikwm URLs
        if (videoUrl && videoUrl.startsWith('/')) videoUrl = 'https://www.tikwm.com' + videoUrl;
        if (hdUrl    && hdUrl.startsWith('/'))    hdUrl    = 'https://www.tikwm.com' + hdUrl;

        console.log('[TikTok] Endpoint 1 success. videoUrl:', videoUrl, '| hdUrl:', hdUrl);
        return {
          videoUrl,
          hdUrl,
          title:    d.title    || 'TikTok Video',
          username: d.author?.unique_id || d.author?.nickname || null,
          likes:    d.digg_count    ?? null,
          comments: d.comment_count ?? null,
          shares:   d.share_count   ?? null,
        };
      }
      console.log('[TikTok] Endpoint 1: no usable URL in response', JSON.stringify(res.data?.data));
    } catch (e) { console.log('[TikTok] Endpoint 1 failed:', e.message); }

    // ── Endpoint 2: tiklydown.eu.org ─────────────────────────────────────
    // Free public API, no key, returns JSON with video_without_watermark.
    try {
      console.log('[TikTok] Trying Endpoint 2: tiklydown.eu.org');
      const res = await axios.get(
        `https://api.tiklydown.eu.org/api/download/v2?url=${encodeURIComponent(url)}`,
        { timeout: 20000, headers: JSON_HEADERS }
      );
      const video = res.data?.video;
      if (video && (video.noWatermark || video.watermark)) {
        const videoUrl = video.noWatermark || video.watermark;
        console.log('[TikTok] Endpoint 2 success. videoUrl:', videoUrl);
        return {
          videoUrl,
          title:    res.data?.title  || 'TikTok Video',
          username: res.data?.author?.name || null,
          likes:    res.data?.diggCount    ?? null,
          comments: res.data?.commentCount ?? null,
          shares:   res.data?.shareCount   ?? null,
        };
      }
      console.log('[TikTok] Endpoint 2: no usable URL');
    } catch (e) { console.log('[TikTok] Endpoint 2 failed:', e.message); }

    // ── Endpoint 3: aiodownloader.com ────────────────────────────────────
    // POST API, returns links array with no-watermark mp4.
    try {
      console.log('[TikTok] Trying Endpoint 3: aiodownloader.com');
      const res = await axios.post(
        'https://aiodownloader.com/api/video',
        new URLSearchParams({ url }).toString(),
        { timeout: 20000, headers: FORM_HEADERS }
      );
      const links = res.data?.links || res.data?.data?.links;
      if (Array.isArray(links) && links.length > 0) {
        const noWm = links.find(l =>
          (l.quality || '').toLowerCase().includes('no watermark') ||
          (l.label  || '').toLowerCase().includes('no watermark') ||
          (l.type   || '').includes('mp4_n')
        );
        const pick = noWm || links[0];
        const videoUrl = pick?.url || pick?.link || pick?.a || pick?.src;
        if (videoUrl) {
          console.log('[TikTok] Endpoint 3 success. videoUrl:', videoUrl);
          return { videoUrl, title: res.data?.title || 'TikTok Video', username: null, likes: null, comments: null, shares: null };
        }
      }
      console.log('[TikTok] Endpoint 3: no usable URL');
    } catch (e) { console.log('[TikTok] Endpoint 3 failed:', e.message); }

    // ── Endpoint 4: snaptik.app ──────────────────────────────────────────
    // POST API, parses HTML response for mp4 download links.
    try {
      console.log('[TikTok] Trying Endpoint 4: snaptik.app');
      const tokenRes = await axios.get('https://snaptik.app/', {
        timeout: 10000, headers: { 'User-Agent': UA },
      });
      const tokenMatch = (tokenRes.data || '').match(/name="token"\s+value="([^"]+)"/);
      const token = tokenMatch?.[1];
      if (token) {
        const res = await axios.post(
          'https://snaptik.app/abc2.php',
          new URLSearchParams({ url, token }).toString(),
          { timeout: 20000, headers: { ...FORM_HEADERS, 'Referer': 'https://snaptik.app/' } }
        );
        const html = res.data || '';
        // Look for the highest-quality mp4 download link
        const matches = [...html.matchAll(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/g)];
        if (matches.length > 0) {
          const videoUrl = matches[0][1];
          console.log('[TikTok] Endpoint 4 success. videoUrl:', videoUrl);
          return { videoUrl, title: 'TikTok Video', username: null, likes: null, comments: null, shares: null };
        }
      }
      console.log('[TikTok] Endpoint 4: no token or no mp4 found');
    } catch (e) { console.log('[TikTok] Endpoint 4 failed:', e.message); }

    // ── Endpoint 5: musicaldown.com ──────────────────────────────────────
    // POST API, scrapes download page for mp4 link.
    try {
      console.log('[TikTok] Trying Endpoint 5: musicaldown.com');
      const pageRes = await axios.get('https://musicaldown.com/', {
        timeout: 10000, headers: { 'User-Agent': UA },
      });
      const idMatch  = (pageRes.data || '').match(/name="id"\s+value="([^"]+)"/);
      const id2Match = (pageRes.data || '').match(/name="id2"\s+value="([^"]+)"/);
      if (idMatch && id2Match) {
        const res = await axios.post(
          'https://musicaldown.com/download',
          new URLSearchParams({ id: idMatch[1], id2: id2Match[1], submit: '' }).toString(),
          {
            timeout: 20000,
            maxRedirects: 5,
            headers: { ...FORM_HEADERS, 'Referer': 'https://musicaldown.com/' },
          }
        );
        const html = res.data || '';
        const mp4Match = html.match(/href="(https?:\/\/[^"]+\.mp4[^"]*)"/);
        if (mp4Match?.[1]) {
          const videoUrl = mp4Match[1];
          console.log('[TikTok] Endpoint 5 success. videoUrl:', videoUrl);
          return { videoUrl, title: 'TikTok Video', username: null, likes: null, comments: null, shares: null };
        }
      }
      console.log('[TikTok] Endpoint 5: no mp4 found');
    } catch (e) { console.log('[TikTok] Endpoint 5 failed:', e.message); }

    throw new Error('All TikTok download endpoints failed. Please try a different link or try again later.');
  },
  
  // Screenshot Website API
  screenshotWebsite: async (url) => {
    try {
      const apiUrl = `https://eliteprotech-apis.zone.id/ssweb?url=${encodeURIComponent(url)}`;
      const response = await axios.get(apiUrl, {
        timeout: 30000,
        responseType: 'arraybuffer',
        headers: {
          'accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      // Return the image buffer directly (API returns PNG binary)
      if (response.headers['content-type']?.includes('image')) {
        return Buffer.from(response.data);
      }
      
      // If API returns JSON with URL, try to parse it
      try {
        const data = JSON.parse(Buffer.from(response.data).toString());
        return data.url || data.data?.url || data.image || apiUrl;
      } catch (e) {
        // If not JSON, assume it's image data and return buffer
        return Buffer.from(response.data);
      }
    } catch (error) {
      throw new Error('Failed to take screenshot');
    }
  },
  
  // Text to Speech API
  textToSpeech: async (text) => {
    try {
      const apiUrl = `https://www.laurine.site/api/tts/tts-nova?text=${encodeURIComponent(text)}`;
      const response = await axios.get(apiUrl, {
        timeout: 30000,
        headers: {
          'accept': '*/*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (response.data) {
        // Check if response.data is a string (direct URL)
        if (typeof response.data === 'string' && (response.data.startsWith('http://') || response.data.startsWith('https://'))) {
          return response.data;
        }
        
        // Check nested data structure
        if (response.data.data) {
          const data = response.data.data;
          if (data.URL) return data.URL;
          if (data.url) return data.url;
          if (data.MP3) return `https://ttsmp3.com/created_mp3_ai/${data.MP3}`;
          if (data.mp3) return `https://ttsmp3.com/created_mp3_ai/${data.mp3}`;
        }
        
        // Check top-level URL fields
        if (response.data.URL) return response.data.URL;
        if (response.data.url) return response.data.url;
        if (response.data.MP3) return `https://ttsmp3.com/created_mp3_ai/${response.data.MP3}`;
        if (response.data.mp3) return `https://ttsmp3.com/created_mp3_ai/${response.data.mp3}`;
      }
      
      throw new Error('Invalid API response structure');
    } catch (error) {
      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  }
};

module.exports = APIs;
