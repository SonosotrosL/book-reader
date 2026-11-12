/**
 * Serverless Function (Vercel) — Configuração Pública Automática do Supabase/Nuvem
 * Define SUPABASE_URL e SUPABASE_ANON_KEY nas Environment Variables da Vercel
 * para que qualquer dispositivo já abra pré-conectado ao seu backend.
 */
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    provider: 'supabase',
    url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
    bucket: (process.env.SUPABASE_BUCKET || 'books').trim() || 'books',
    gdriveClientId: (process.env.GDRIVE_CLIENT_ID || '').trim(),
    onedriveClientId: (process.env.ONEDRIVE_CLIENT_ID || '').trim()
  });
};
