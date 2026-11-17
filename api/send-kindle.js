/**
 * Serverless Function (Vercel) — Envio Direto para E-mail @kindle.com
 * Suporta:
 *  1) Gmail Direto (SMTPS TLS porta 465 nativo do Node.js, sem pacotes externos)
 *  2) Brevo API (HTTP, sem precisar de domínio próprio)
 *  3) Resend API (HTTP)
 */
const tls = require('tls');

function wrapBase64(b64) {
  return (String(b64 || '').match(/.{1,76}/g) || []).join('\r\n');
}

function sendViaSmtpTls({ host, port = 465, user, pass, from, to, subject, text, filename, contentBase64 }) {
  return new Promise((resolve, reject) => {
    const okAddr = (a) => /^[^\s<>@]+@[^\s<>@]+$/.test(String(a || ''));
    if (!okAddr(from) || !okAddr(to) || /[\r\n]/.test(String(host || '') + String(user || ''))) {
      reject(new Error('Endereço de e-mail inválido.'));
      return;
    }
    const socket = tls.connect({ host, port, servername: host }, () => {});
    socket.setTimeout(25000);

    let buffer = '';
    let step = 0;
    const boundary = '----=_KindleReader_' + Date.now().toString(16);

    const safeFile = String(filename || 'livro.epub').replace(/[^\x20-\x7E]|["]/g, '_');
    const mimeMsg = [
      `From: "Leitor Portatil" <${from}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      text || 'Livro enviado pelo Leitor Portatil.',
      '',
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${safeFile}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeFile}"`,
      '',
      wrapBase64(contentBase64),
      '',
      `--${boundary}--`,
      '.',
      ''
    ].join('\r\n');

    function fail(msg) {
      try { socket.destroy(); } catch {}
      reject(new Error(msg));
    }

    function sendCmd(cmd) {
      socket.write(cmd + '\r\n');
    }

    socket.on('timeout', () => fail('Tempo esgotado na conexão SMTP com o Gmail.'));
    socket.on('error', (err) => fail('Erro de conexão SMTP: ' + err.message));

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();

      for (const line of lines) {
        if (!line || /^\d{3}-/.test(line)) continue; // esperar linha final (ex: "250 OK")
        const code = parseInt(line.slice(0, 3), 10);

        if (step === 0) {
          if (code !== 220) return fail(`SMTP saudação inesperada: ${line}`);
          step = 1;
          sendCmd('EHLO leitorportatil.local');
        } else if (step === 1) {
          if (code !== 250) return fail(`SMTP EHLO falhou: ${line}`);
          step = 2;
          sendCmd('AUTH LOGIN');
        } else if (step === 2) {
          if (code !== 334) return fail(`SMTP AUTH falhou: ${line}`);
          step = 3;
          sendCmd(Buffer.from(user, 'utf8').toString('base64'));
        } else if (step === 3) {
          if (code !== 334) return fail(`SMTP usuário falhou: ${line}`);
          step = 4;
          sendCmd(Buffer.from(pass, 'utf8').toString('base64'));
        } else if (step === 4) {
          if (code !== 235) {
            return fail('Falha no login do Gmail. Use uma "Senha de App" de 16 letras (não a senha normal do Google). Detalhe: ' + line);
          }
          step = 5;
          sendCmd(`MAIL FROM:<${from}>`);
        } else if (step === 5) {
          if (code !== 250) return fail(`SMTP MAIL FROM falhou: ${line}`);
          step = 6;
          sendCmd(`RCPT TO:<${to}>`);
        } else if (step === 6) {
          if (code !== 250 && code !== 251) return fail(`SMTP RCPT TO falhou (verifique o e-mail @kindle.com): ${line}`);
          step = 7;
          sendCmd('DATA');
        } else if (step === 7) {
          if (code !== 354) return fail(`SMTP DATA falhou: ${line}`);
          step = 8;
          socket.write(mimeMsg);
        } else if (step === 8) {
          if (code !== 250) return fail(`SMTP envio da mensagem falhou: ${line}`);
          step = 9;
          sendCmd('QUIT');
          socket.end();
          resolve({ ok: true, id: 'smtp-sent' });
          return;
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Regras de segurança
//  - O servidor NUNCA aceita host SMTP vindo do cliente (evita roubo de senha).
//  - Envio para Kindle usa SEMPRE as credenciais do próprio usuário; as variáveis
//    de ambiente do servidor nunca são usadas para enviar livros a terceiros.
//  - Destinatário de livro: apenas @kindle.com / @free.kindle.com.
//  - Notificação de sugestão: só usa credenciais do servidor e só envia para
//    OWNER_NOTIFY_EMAIL (definido na Vercel), nunca para um e-mail do cliente.
//  - Todos os campos que vão para cabeçalhos são limpos de CR/LF.
// ---------------------------------------------------------------------------
const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const KINDLE_RE = /^[A-Za-z0-9._%+-]{1,64}@(free\.)?kindle\.com$/i;
const MAX_ATTACHMENT_B64 = 4.4 * 1024 * 1024; // ~3,2 MB reais (limite de corpo da Vercel)

function clean(str, max = 200) {
  return String(str == null ? '' : str).replace(/[\r\n\0]+/g, ' ').trim().slice(0, max);
}

function cleanEmail(str) {
  const v = clean(str, 254).toLowerCase();
  return EMAIL_RE.test(v) ? v : '';
}

function smtpHostFor(sender) {
  const domain = sender.split('@')[1] || '';
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(domain)) return 'smtp-mail.outlook.com';
  return 'smtp.gmail.com'; // Gmail e Google Workspace
}

// Limitador simples por IP (melhor esforço: cada instância serverless tem sua memória)
const hits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

async function sendWithProvider({ provider, sender, secret, to, subject, text, filename, contentBase64 }) {
  if (provider === 'gmail' || provider === 'smtp') {
    return sendViaSmtpTls({
      host: smtpHostFor(sender),
      port: 465,
      user: sender,
      pass: secret.replace(/\s+/g, ''),
      from: sender,
      to,
      subject,
      text,
      filename,
      contentBase64
    });
  }

  if (provider === 'brevo') {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': secret, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: 'Leitor Portátil', email: sender },
        to: [{ email: to }],
        subject,
        textContent: text,
        attachment: [{ name: filename, content: contentBase64 }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `Brevo HTTP ${res.status}`);
    return { ok: true, id: data.messageId || 'sent' };
  }

  if (provider === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: sender || 'onboarding@resend.dev',
        to: [to],
        subject,
        text,
        attachments: [{ filename, content: contentBase64 }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `Resend HTTP ${res.status}`);
    return { ok: true, id: data.id || 'sent' };
  }

  throw new Error('Provedor de e-mail inválido (use gmail, brevo ou resend).');
}

async function handleOwnerNotification(body) {
  const ownerEmail = cleanEmail(process.env.OWNER_NOTIFY_EMAIL);
  const srvUser = cleanEmail(process.env.KINDLE_SMTP_USER);
  const srvSecret = String(process.env.KINDLE_SMTP_PASS || process.env.KINDLE_EMAIL_API_KEY || '').trim();
  const provider = String(process.env.KINDLE_EMAIL_PROVIDER || 'gmail').toLowerCase();
  if (!ownerEmail || !srvSecret || (provider !== 'resend' && !srvUser)) {
    return { status: 200, data: { ok: false, skipped: true, reason: 'Notificação por e-mail não configurada no servidor.' } };
  }
  const bookTitle = clean(body.bookTitle || 'Livro', 120);
  const senderEmail = cleanEmail(body.senderEmail) || 'convidado';
  const syncKey = clean(body.syncKey || 'minha-estante', 60);
  const text = `Um leitor (${senderEmail}) sugeriu o livro "${bookTitle}" para aprovação na estante "${syncKey}". Abra sua Estante para Aprovar ou Recusar.`;
  const result = await sendWithProvider({
    provider,
    sender: srvUser,
    secret: srvSecret,
    to: ownerEmail,
    subject: `Nova sugestão na Estante: ${bookTitle}`,
    text,
    filename: 'sugestao.txt',
    contentBase64: Buffer.from(text, 'utf8').toString('base64')
  });
  return { status: 200, data: result };
}

async function handleSendKindle(body) {
  body = body || {};
  if (body.notifyOwnerSuggestion) return handleOwnerNotification(body);

  const provider = String(body.provider || 'gmail').toLowerCase();
  const kindleEmail = clean(body.kindleEmail, 254).toLowerCase();
  const sender = cleanEmail(body.fromEmail);
  const secret = String(body.apiKey || '').trim();
  const bookTitle = clean(body.bookTitle || 'Livro', 150);
  const filename = clean(body.filename || 'livro.epub', 120).replace(/[^\w.\- ()À-ÿ]/g, '_') || 'livro.epub';
  const contentBase64 = String(body.contentBase64 || '');

  if (!KINDLE_RE.test(kindleEmail)) {
    return { status: 400, data: { ok: false, error: 'Destino inválido: use apenas um endereço @kindle.com.' } };
  }
  if (!contentBase64 || !/^[A-Za-z0-9+/=\s]+$/.test(contentBase64)) {
    return { status: 400, data: { ok: false, error: 'Arquivo do livro ausente ou inválido.' } };
  }
  if (contentBase64.length > MAX_ATTACHMENT_B64) {
    return { status: 413, data: { ok: false, error: 'Livro grande demais para envio pelo servidor (máx. ~3 MB).' } };
  }
  if (!secret) {
    return { status: 400, data: { ok: false, error: 'Informe sua Senha de App do Google (ou a chave Brevo/Resend).' } };
  }
  if (provider !== 'resend' && !sender) {
    return { status: 400, data: { ok: false, error: 'Informe seu e-mail remetente (o mesmo aprovado na Amazon).' } };
  }

  const result = await sendWithProvider({
    provider,
    sender,
    secret,
    to: kindleEmail,
    subject: `Convert: ${bookTitle}`,
    text: `Livro "${bookTitle}" enviado pelo Leitor Portatil.`,
    filename,
    contentBase64
  });
  return { status: 200, data: result };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const ip = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || 'anon').split(',')[0].trim();
    const isNotify = body && body.notifyOwnerSuggestion;
    if (rateLimited(`${isNotify ? 'n' : 'k'}:${ip}`, isNotify ? 5 : 10, 10 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'Muitas solicitações. Tente novamente em alguns minutos.' });
    }
    const result = await handleSendKindle(body);
    return res.status(result.status).json(result.data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: clean(err.message, 300) });
  }
};
module.exports.sendViaSmtpTls = sendViaSmtpTls;
module.exports.handleSendKindle = handleSendKindle;
