/**
 * Serverless Function (Vercel / Netlify) — Envio Direto para E-mail @kindle.com
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

async function handleSendKindle(body) {
  const {
    provider = process.env.KINDLE_EMAIL_PROVIDER || 'gmail',
    apiKey = '',
    fromEmail = '',
    kindleEmail,
    bookTitle = 'Livro',
    filename = 'livro.epub',
    contentBase64,
    smtpHost,
    notifyOwnerSuggestion = false,
    senderEmail = '',
    syncKey = 'minha-estante'
  } = body || {};

  if (notifyOwnerSuggestion) {
    const ownerEmail = (process.env.OWNER_NOTIFY_EMAIL || kindleEmail || '').trim();
    const srvUser = (process.env.KINDLE_SMTP_USER || fromEmail || '').trim();
    const srvSecret = (process.env.KINDLE_SMTP_PASS || process.env.KINDLE_EMAIL_API_KEY || apiKey || '').trim();
    if (!ownerEmail || !ownerEmail.includes('@') || !srvSecret) {
      return { status: 200, data: { ok: false, skipped: true, reason: 'Notificação por e-mail opcional não configurada no servidor.' } };
    }
    const textMsg = `Um leitor (${senderEmail || 'convidado'}) sugeriu o livro "${bookTitle}" para aprovação na estante "${syncKey}". Abra sua Estante para Aprovar ou Recusar com 1 clique.`;
    const b64Msg = Buffer.from(textMsg, 'utf8').toString('base64');
    if (provider === 'gmail' || provider === 'smtp') {
      if (!srvUser || !srvUser.includes('@')) {
        return { status: 200, data: { ok: false, skipped: true, reason: 'KINDLE_SMTP_USER ausente.' } };
      }
      const host = smtpHost || (srvUser.endsWith('@outlook.com') || srvUser.endsWith('@hotmail.com') ? 'smtp-mail.outlook.com' : 'smtp.gmail.com');
      const result = await sendViaSmtpTls({
        host,
        port: 465,
        user: srvUser,
        pass: srvSecret.replace(/\s+/g, ''),
        from: srvUser,
        to: ownerEmail,
        subject: `Nova sugestão na Estante: ${bookTitle}`,
        text: textMsg,
        filename: 'sugestao.txt',
        contentBase64: b64Msg
      });
      return { status: 200, data: result };
    }
    // Resend / Brevo fallthrough using ownerEmail
    return await handleSendKindle({
      provider,
      apiKey: srvSecret,
      fromEmail: srvUser,
      kindleEmail: ownerEmail,
      bookTitle: `Sugestão: ${bookTitle}`,
      filename: 'sugestao.txt',
      contentBase64: b64Msg
    });
  }

  if (!kindleEmail || !kindleEmail.includes('@')) {
    return { status: 400, data: { ok: false, error: 'Informe um endereço @kindle.com válido.' } };
  }
  if (!contentBase64) {
    return { status: 400, data: { ok: false, error: 'Arquivo do livro ausente para anexo.' } };
  }

  const resolvedSender = (fromEmail || process.env.KINDLE_SMTP_USER || '').trim();
  const resolvedSecret = (apiKey || process.env.KINDLE_SMTP_PASS || process.env.KINDLE_EMAIL_API_KEY || '').trim();

  if (provider === 'gmail' || provider === 'smtp') {
    if (!resolvedSender || !resolvedSender.includes('@')) {
      return { status: 400, data: { ok: false, error: 'Informe seu Gmail remetente (o mesmo aprovado na Amazon).' } };
    }
    if (!resolvedSecret) {
      return { status: 400, data: { ok: false, error: 'Informe a Senha de App de 16 letras do Google.' } };
    }
    const cleanPass = resolvedSecret.replace(/\s+/g, '');
    const host = smtpHost || (resolvedSender.endsWith('@outlook.com') || resolvedSender.endsWith('@hotmail.com') ? 'smtp-mail.outlook.com' : 'smtp.gmail.com');
    const result = await sendViaSmtpTls({
      host,
      port: 465,
      user: resolvedSender,
      pass: cleanPass,
      from: resolvedSender,
      to: kindleEmail,
      subject: `Convert: ${bookTitle}`,
      text: `Livro "${bookTitle}" enviado pelo Leitor Portatil.`,
      filename,
      contentBase64
    });
    return { status: 200, data: result };
  }

  if (!resolvedSecret) {
    return { status: 400, data: { ok: false, error: 'Informe a API Key do provedor de envio (Brevo ou Resend).' } };
  }

  if (provider === 'brevo') {
    if (!resolvedSender || !resolvedSender.includes('@')) {
      return { status: 400, data: { ok: false, error: 'Na Brevo, informe seu e-mail remetente verificado na Amazon e na Brevo.' } };
    }
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': resolvedSecret,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: 'Leitor Portátil', email: resolvedSender },
        to: [{ email: kindleEmail }],
        subject: `Convert: ${bookTitle}`,
        textContent: `Livro "${bookTitle}" enviado pelo Leitor Portátil.`,
        attachment: [{ name: filename, content: contentBase64 }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: res.status, data: { ok: false, error: data.message || `Brevo HTTP ${res.status}` } };
    }
    return { status: 200, data: { ok: true, id: data.messageId || 'sent' } };
  }

  // Resend API
  const resendSender = resolvedSender && resolvedSender.includes('@') ? resolvedSender : 'onboarding@resend.dev';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resolvedSecret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: resendSender,
      to: [kindleEmail],
      subject: `Convert: ${bookTitle}`,
      text: `Livro "${bookTitle}" enviado para o seu Kindle.`,
      attachments: [{ filename, content: contentBase64 }]
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { status: res.status, data: { ok: false, error: data.message || data.error || `Resend HTTP ${res.status}` } };
  }
  return { status: 200, data: { ok: true, id: data.id || 'sent' } };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const result = await handleSendKindle(body);
    return res.status(result.status).json(result.data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
module.exports.sendViaSmtpTls = sendViaSmtpTls;
