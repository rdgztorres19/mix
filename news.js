// .env (create this file in your project root)
// ------------------------------------------
// FINNHUB_API_KEY=your_finnhub_api_key_here
// OPENAI_API_KEY=your_openai_api_key_here

/* package.json (for reference)
{
  "name": "stock-news-sentiment",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "dotenv": "^10.0.0",
    "openai": "^4.0.0",
    "ws": "^8.0.0"
  }
}
*/

// index.js
// require('dotenv').config();
const WebSocket = require('ws');
const { Configuration, OpenAIApi } = require('openai');

// Load API keys from .env
const FINNHUB_API_KEY = "d2389shr01qgiro2fd9gd2389shr01qgiro2fda0";
const OPENAI_API_KEY = "sdfsdf";

if (!FINNHUB_API_KEY || !OPENAI_API_KEY) {
  console.error('Error: Missing FINNHUB_API_KEY or OPENAI_API_KEY in .env');
  process.exit(1);
}

// Initialize OpenAI client
// const openai = new OpenAIApi(new Configuration({
//   apiKey: OPENAI_API_KEY
// }));

// Connect to Finnhub WebSocket for news
const socket = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);

socket.on('open', () => {
  console.log('🔌 Connected to Finnhub WebSocket');
  // Subscribe to generic 'news' channel to get all stock news
  //socket.send(JSON.stringify({ type: 'subscribe', symbol: 'BINANCE:BTCUSDT' }));
  socket.send(JSON.stringify({ type: 'subscribe-news', symbol: 'news' }));
});

socket.on('message', async (data) => {
  try {
    const msg = JSON.parse(data);

    console.log(msg);
    // Process only news messages
    if (msg.type === 'news' && Array.isArray(msg.data)) {
      for (const article of msg.data) {
        const timestamp = new Date(article.datetime * 1000).toISOString();
        const text = `${article.headline}\n${article.summary || ''}`;
        const tickers = extractTickers(text);
        if (tickers.size === 0) continue; // Skip if no tickers found

        // const sentiment = await analyzeSentiment(text);
        // console.log(`[${timestamp}] [${[...tickers].join(', ')}] ${article.headline} - ${sentiment.sentiment} (${sentiment.score})`);
      }
    }
  } catch (err) {
    console.error('Error processing message:', err);
  }
});

socket.on('error', (err) => console.error('❌ WebSocket error:', err));
socket.on('close', () => console.log('🔒 WebSocket connection closed'));

/**
 * Extracts cashtags ($AAPL, $TSLA, etc.) from text and returns a Set of tickers
 */
function extractTickers(text) {
  const matches = text.match(/\$[A-Z]{1,5}\b/g) || [];
  return new Set(matches.map(s => s.slice(1)));
}

/**
 * Calls OpenAI to analyze sentiment, expects a JSON response
 */
async function analyzeSentiment(text) {
  const prompt = `
Eres un analizador de sentimiento financiero. Devuelve únicamente un JSON con:
{
  "sentiment": "positive"|"neutral"|"negative",
  "score": número entre -1 y +1
}

Noticia:
${text}
  `.trim();

  try {
    const res = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      temperature: 0,
      messages: [
        { role: 'system', content: 'Analiza sentimiento de noticias financieras.' },
        { role: 'user', content: prompt }
      ]
    });
    return JSON.parse(res.data.choices[0].message.content.trim());
  } catch (error) {
    console.error('Error analyzing sentiment:', error);
    return { sentiment: 'neutral', score: 0 };
  }
}
