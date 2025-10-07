const OAuth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');
const https = require('https');

// Desactivar verificación SSL solo para esta petición
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const oauth = OAuth({
  consumer: {
    key: '0064c2d0-2d05-11e8-8de6-d9a2dedb594a',
    secret: '0064c2d1-2d05-11e8-b084-8e856d579c14',
  },
  signature_method: 'HMAC-SHA1',
  hash_function(base_string, key) {
    return crypto.createHmac('sha1', key).update(base_string).digest('base64');
  },
});

const requestData = {
  url: 'https://api.sorbasoft.net/clients/collectors/collectors/a1ef8f04-05b1-46b4-9dfc-9cc1da29325f/collector-stats',
  method: 'GET',
};

const token = {};
const authHeader = oauth.toHeader(oauth.authorize(requestData, token));

async function fetchCollectorStats() {
  try {
    const response = await axios.get(requestData.url, {
      httpsAgent,               // <-- aquí usamos el agente que ignora SSL
      headers: {
        ...authHeader,
        Accept: 'application/json',
      },
    });
    console.log('Datos recibidos:', response.data);
  } catch (err) {
    console.error('Error al obtener datos:', err.response?.status, err.response?.data || err.message);
  }
}

fetchCollectorStats();