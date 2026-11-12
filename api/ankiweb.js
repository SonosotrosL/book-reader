/**
 * Serverless Function (Vercel / Netlify) — Ponte Direta para Conta AnkiWeb
 * Permite autenticar na conta AnkiWeb (ankiweb.net) e adicionar cartões
 * diretamente pelo navegador ou celular sem bloqueio de CORS.
 */

async function handleAnkiWebRequest(body) {
  const { action, username, password, deck = 'Default', front = '', back = '', tags = '' } = body || {};
  if (!username || !password) {
    return { status: 400, data: { ok: false, error: 'Informe e-mail e senha do AnkiWeb.' } };
  }

  // 1. Buscar página de login do AnkiWeb para obter csrf_token e cookies iniciais
  const loginPageRes = await fetch('https://ankiweb.net/account/login', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    }
  });
  const loginHtml = await loginPageRes.text();
  const csrfMatch = loginHtml.match(/name="csrf_token"\s+value="([^"]+)"/i);
  const cookies = (loginPageRes.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0]).join('; ');

  const form = new URLSearchParams();
  form.set('submitted', '1');
  form.set('username', username);
  form.set('password', password);
  if (csrfMatch) form.set('csrf_token', csrfMatch[1]);

  const authRes = await fetch('https://ankiweb.net/account/login', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    },
    body: form.toString()
  });

  const authCookies = [cookies, (authRes.headers.get('set-cookie') || '').split(',').map(c => c.split(';')[0]).join('; ')]
    .filter(Boolean)
    .join('; ');

  const locationHdr = authRes.headers.get('location') || '';
  const isLogged = authRes.status === 302 && !locationHdr.includes('login');

  if (!isLogged && !authCookies.includes('ankiweb=')) {
    return {
      status: 401,
      data: { ok: false, error: 'Credenciais AnkiWeb inválidas ou verificação adicional exigida pelo AnkiWeb.' }
    };
  }

  if (action === 'testLogin') {
    return { status: 200, data: { ok: true, message: 'Login AnkiWeb validado com sucesso!' } };
  }

  // 2. Adicionar cartão na interface de edição do AnkiWeb (/edit/save)
  const addForm = new URLSearchParams();
  addForm.set('data', JSON.stringify([[front, back], tags]));
  addForm.set('deck', deck);

  const saveRes = await fetch('https://ankiuser.net/edit/save', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': authCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    },
    body: addForm.toString()
  });

  if (saveRes.ok) {
    return { status: 200, data: { ok: true, deck } };
  }
  return { status: 500, data: { ok: false, error: `Falha ao salvar cartão no AnkiWeb (HTTP ${saveRes.status})` } };
}

// Formato Vercel Serverless Function (Node.js)
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await handleAnkiWebRequest(body);
    return res.status(result.status).json(result.data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
