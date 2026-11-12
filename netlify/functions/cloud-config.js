exports.handler = async () => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify({
      provider: 'supabase',
      url: (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
      apiKey: (process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim(),
      bucket: (process.env.SUPABASE_BUCKET || 'books').trim() || 'books',
      gdriveClientId: (process.env.GDRIVE_CLIENT_ID || '').trim(),
      onedriveClientId: (process.env.ONEDRIVE_CLIENT_ID || '').trim()
    })
  };
};
