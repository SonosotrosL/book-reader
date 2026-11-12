const vercelHandler = require('../../api/ankiweb.js');

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
  let statusCode = 200;
  let responseData = {};
  const fakeReq = {
    method: event.httpMethod,
    body: event.body ? JSON.parse(event.body) : {}
  };
  const fakeRes = {
    setHeader: () => {},
    status(code) { statusCode = code; return this; },
    json(obj) { responseData = obj; return this; },
    end() { return this; }
  };
  await vercelHandler(fakeReq, fakeRes);
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(responseData)
  };
};
