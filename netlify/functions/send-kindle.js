const vercelHandler = require('../../api/send-kindle');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'Use POST' }) };
  }

  let statusCode = 200;
  let bodyObj = {};
  const mockRes = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(data) { bodyObj = data; return this; },
    end() { return this; }
  };

  await vercelHandler({ method: 'POST', body: event.body }, mockRes);
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(bodyObj)
  };
};
