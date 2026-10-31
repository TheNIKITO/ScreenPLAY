// Prévia de links do chat: título, descrição e miniatura (como no Discord).
// Roda no processo principal (sem limite de CORS) e devolve a imagem já como data URL pequena,
// então a página não carrega nada de fora. Nunca busca endereços da rede local (roteador etc.).
const dns = require('dns');
const net = require('net');
const { nativeImage } = require('electron');

const TIMEOUT = 6000;
const HTML_MAX = 600 * 1024;        // lê só o começo da página (as tags og: ficam no <head>)
const IMAGE_MAX = 4 * 1024 * 1024;
const THUMB_W = 400;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 ScreenPLAY';

const cache = new Map();   // url -> Promise<prévia | null>

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// Só http/https para um endereço público.
async function safeUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return null;
  try {
    const all = await dns.promises.lookup(host, { all: true });
    if (!all.length || all.some((r) => privateIp(r.address))) return null;
  } catch { return null; }
  return url;
}

// Baixa até `max` bytes; segue redirecionamentos conferindo cada destino.
async function get(raw, max, accept) {
  let url = await safeUrl(raw);
  for (let hop = 0; url && hop < 5; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(url.href, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await safeUrl(new URL(res.headers.get('location'), url).href);
        continue;
      }
      if (!res.ok || !res.body) return null;
      const chunks = [];
      let size = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size >= max) { reader.cancel().catch(() => {}); break; }
      }
      return { url, type: (res.headers.get('content-type') || '').toLowerCase(), body: Buffer.concat(chunks).subarray(0, max) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] || m)
    .replace(/\s+/g, ' ')
    .trim();
}
function metaTags(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (/\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const val = (/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1];
    if (key && val != null && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decode(val);
  }
  return out;
}

// Imagem reduzida para uma miniatura JPEG (data URL); null se não der.
async function thumb(raw) {
  const r = await get(raw, IMAGE_MAX, 'image/*');
  if (!r || !/^image\/(png|jpe?g|webp|gif|bmp)/.test(r.type) || r.body.length >= IMAGE_MAX) return null;
  let img = nativeImage.createFromBuffer(r.body);
  if (img.isEmpty()) {
    // O Electron não abre todo formato (ex.: alguns webp/gif): manda o original se for pequeno.
    return r.body.length <= 300 * 1024 ? { src: `data:${r.type.split(';')[0]};base64,${r.body.toString('base64')}`, w: 0, h: 0 } : null;
  }
  const { width, height } = img.getSize();
  if (width > THUMB_W) img = img.resize({ width: THUMB_W, quality: 'good' });
  return { src: `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}`, w: Math.min(width, THUMB_W), h: Math.round(height * Math.min(1, THUMB_W / width)) };
}

const YT_RE = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)$/i;

async function build(raw) {
  const url = await safeUrl(raw);
  if (!url) return null;
  // YouTube: o oEmbed traz título e canal sem baixar a página inteira.
  if (YT_RE.test(url.hostname)) {
    const r = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`, 64 * 1024, 'application/json');
    if (r) {
      try {
        const o = JSON.parse(r.body.toString('utf8'));
        const img = o.thumbnail_url ? await thumb(o.thumbnail_url) : null;
        return { url: url.href, site: 'YouTube', title: decode(o.title).slice(0, 200), desc: decode(o.author_name).slice(0, 300), image: img, big: true };
      } catch { /* cai na página normal */ }
    }
  }
  const r = await get(url.href, HTML_MAX, 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5');
  if (!r) return null;
  // Link direto para uma imagem: a prévia é a própria imagem.
  if (r.type.startsWith('image/')) {
    const img = await thumb(r.url.href);
    return img ? { url: url.href, site: r.url.hostname.replace(/^www\./, ''), title: '', desc: '', image: img, big: true } : null;
  }
  if (!r.type.includes('html')) return null;
  const charset = (/charset=([\w-]+)/.exec(r.type) || [])[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset).decode(r.body); } catch { html = r.body.toString('utf8'); }
  const m = metaTags(html);
  const title = m['og:title'] || m['twitter:title'] || decode((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1]);
  const desc = m['og:description'] || m['twitter:description'] || m.description || '';
  const imageUrl = m['og:image:secure_url'] || m['og:image'] || m['og:image:url'] || m['twitter:image'] || m['twitter:image:src'] || '';
  if (!title && !imageUrl) return null;
  let image = null;
  if (imageUrl) {
    try { image = await thumb(new URL(imageUrl, r.url).href); } catch { image = null; }
  }
  const big = /summary_large_image/i.test(m['twitter:card'] || '') || m['og:type'] === 'video.other';
  return {
    url: url.href,
    site: (m['og:site_name'] || r.url.hostname.replace(/^www\./, '')).slice(0, 80),
    title: title.slice(0, 200), desc: desc.slice(0, 300), image, big,
  };
}

function linkPreview(raw) {
  const key = String(raw || '').slice(0, 2000);
  if (!cache.has(key)) {
    cache.set(key, build(key).catch(() => null));
    while (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

module.exports = { linkPreview };
