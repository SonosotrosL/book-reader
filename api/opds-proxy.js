const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 35 * 1024 * 1024; // 35 MB cap for serverless proxy

function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/i, '');
  if (clean === '::1' || clean === '::' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80')) {
    return true;
  }
  if (!net.isIPv4(clean)) return false;
  const parts = clean.split('.').map(Number);
  if (parts.length !== 4) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

async function validatePublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Apenas links HTTP ou HTTPS são permitidos.');
  }
  const host = (parsed.hostname || '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Host local ou privado não permitido.');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('Endereço IP privado não permitido.');
    return parsed.toString();
  }
  try {
    const res = await dns.lookup(host, { all: true });
    if (!res || !res.length || res.some(r => isPrivateIp(r.address))) {
      throw new Error('Host resolveu para endereço privado.');
    }
  } catch (err) {
    if (/privado/i.test(err.message)) throw err;
    throw new Error('Não foi possível resolver o domínio informado.');
  }
  return parsed.toString();
}

async function fetchRemoteSafe(rawUrl, rangeHeader = '') {
  const safeRange = /^bytes=\d+-\d*$/i.test(String(rangeHeader || '').trim())
    ? String(rangeHeader).trim()
    : '';
  let lastNetworkErr = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    let currentUrl = await validatePublicUrl(rawUrl);
    let res = null;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const parsedHop = new URL(currentUrl);
        const host = parsedHop.hostname.toLowerCase();
        const extraHeaders = {};
        if (host.endsWith('.pstatic.net') || host === 'webtoons.com' || host.endsWith('.webtoons.com')) {
          extraHeaders['Referer'] = 'https://www.webtoons.com/';
        } else if (host.endsWith('.tapas.io') || host === 'tapas.io') {
          extraHeaders['Referer'] = 'https://tapas.io/';
        } else if (host.endsWith('.mangadex.org') || host.endsWith('.mangadex.network')) {
          extraHeaders['Referer'] = 'https://mangadex.org/';
        }
        if (safeRange) {
          extraHeaders['Range'] = safeRange;
        }
        const isMangaDex = host === 'mangadex.org' || host.endsWith('.mangadex.org') || host.endsWith('.mangadex.network');
        const acceptHdr = (host === 'tapas.io' || host.endsWith('.tapas.io'))
          ? (parsedHop.pathname.includes('/episodes') ? 'application/json, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
          : 'text/html, application/xhtml+xml, application/atom+xml, application/xml, text/xml, application/json, application/epub+zip, application/pdf, image/*, */*';
        const uaHdr = isMangaDex
          ? 'LeitorPortatilOPDS/1.0 (+https://vercel.app)'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';
        res = await fetch(currentUrl, {
          redirect: 'manual',
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8500) : undefined,
          headers: {
            'User-Agent': uaHdr,
            'Accept': acceptHdr,
            ...extraHeaders
          }
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (res.body && typeof res.body.cancel === 'function') {
            res.body.cancel().catch(() => {});
          }
          if (!loc) break;
          currentUrl = await validatePublicUrl(new URL(loc, currentUrl).toString());
          continue;
        }
        break;
      }

      if (res && [502, 503, 504].includes(res.status) && attempt === 0) {
        if (res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(() => {});
        await new Promise(r => setTimeout(r, 350));
        continue;
      }

      if (!res || (!res.ok && res.status !== 206)) {
        return {
          status: res ? res.status : 502,
          contentType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ ok: false, error: `Falha ao acessar catálogo/arquivo remoto (HTTP ${res ? res.status : 502})` }))
        };
      }

      const lenHdr = parseInt(res.headers.get('content-length') || '0', 10);
      if (lenHdr > MAX_BYTES) {
        if (res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(() => {});
        return {
          status: 413,
          contentType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ ok: false, error: 'Arquivo excede o limite de 35 MB por requisição do proxy OPDS. Use Range em blocos.' }))
        };
      }

      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_BYTES) {
        return {
          status: 413,
          contentType: 'application/json',
          buffer: Buffer.from(JSON.stringify({ ok: false, error: 'Arquivo excede o limite de 35 MB por requisição do proxy OPDS.' }))
        };
      }

      return {
        status: res.status === 206 ? 206 : 200,
        contentType: res.headers.get('content-type') || 'application/octet-stream',
        contentRange: res.headers.get('content-range') || '',
        acceptRanges: res.headers.get('accept-ranges') || '',
        finalUrl: currentUrl,
        buffer: Buffer.from(ab)
      };
    } catch (err) {
      if (err && /inválida|permitid|privado|resolver/i.test(err.message || '')) throw err;
      lastNetworkErr = err;
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 350));
        continue;
      }
      throw err;
    }
  }
  throw lastNetworkErr || new Error('Falha de rede no proxy OPDS.');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Final-Url');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  const target = (req.query && req.query.url) || '';
  if (!target) {
    return res.status(400).json({ ok: false, error: 'Parâmetro ?url=... obrigatório.' });
  }

  const rangeHdr = (req.query && req.query.range) || (req.headers && req.headers.range) || '';
  try {
    const out = await fetchRemoteSafe(target, rangeHdr);
    res.setHeader('Content-Type', out.contentType);
    if (out.contentRange) res.setHeader('Content-Range', out.contentRange);
    if (out.acceptRanges) res.setHeader('Accept-Ranges', out.acceptRanges);
    if (out.finalUrl) res.setHeader('X-Final-Url', out.finalUrl);
    if (out.status === 200 || out.status === 206) {
      res.setHeader('Cache-Control', 'public, max-age=60');
    }
    return res.status(out.status).send(out.buffer);
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Erro no proxy OPDS.' });
  }
};

module.exports.fetchRemoteSafe = fetchRemoteSafe;
module.exports.validatePublicUrl = validatePublicUrl;
