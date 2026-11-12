const { fetchRemoteSafe } = require('../../api/opds-proxy.js');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Final-Url'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: 'Method Not Allowed' })
    };
  }

  const target = (event.queryStringParameters && event.queryStringParameters.url) || '';
  if (!target) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: 'Parâmetro ?url=... obrigatório.' })
    };
  }

  try {
    const rangeHdr = (event.queryStringParameters && event.queryStringParameters.range) || (event.headers && (event.headers.range || event.headers.Range)) || '';
    const out = await fetchRemoteSafe(target, rangeHdr);
    const isText = /^(text\/|application\/(json|atom\+xml|xml|xhtml\+xml))/i.test(out.contentType || '');
    const respHeaders = {
      'Content-Type': out.contentType || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, X-Final-Url',
      'Cache-Control': (out.status === 200 || out.status === 206) ? 'public, max-age=60' : 'no-store'
    };
    if (out.contentRange) respHeaders['Content-Range'] = out.contentRange;
    if (out.acceptRanges) respHeaders['Accept-Ranges'] = out.acceptRanges;
    if (out.finalUrl) respHeaders['X-Final-Url'] = out.finalUrl;
    return {
      statusCode: out.status,
      headers: respHeaders,
      isBase64Encoded: !isText,
      body: isText ? out.buffer.toString('utf8') : out.buffer.toString('base64')
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: err.message || 'Erro no proxy OPDS.' })
    };
  }
};
