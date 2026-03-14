"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreHeadlines = scoreHeadlines;
exports.fetchYahooNews = fetchYahooNews;
exports.fetchFinvizNews = fetchFinvizNews;
exports.createNewsTool = createNewsTool;
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
const openai_1 = require("@langchain/openai");
const axios_1 = __importDefault(require("axios"));
const STRONG_KEYWORDS = [
    'fda approv', 'approved', 'buyout', 'acquisition', 'merger', 'takeover',
    'earnings beat', 'beat estimates', 'short squeeze', 'halted', 'resumed trading',
    'contract award', 'government contract', 'breakthrough', 'trial success',
    'nasdaq uplisting', 'nyse uplisting', 'phase 3', 'pivotal trial',
    'major partnership', 'exclusive deal', 'quarterly results beat',
];
const WEAK_KEYWORDS = [
    'analyst downgrade', 'price target lowered', 'concerns', 'uncertainty',
    'investigation', 'sec', 'lawsuit', 'dilution', 'offering', 'secondary',
    'loss', 'miss', 'disappointing', 'weak guidance',
];
const DILUTIVE_KEYWORDS = [
    'offering', 'dilution', 'shares offered', 'secondary offering', 'atm offering',
    'registered direct', 'public offering', 'shelf registration',
];
function getLLM() {
    return new openai_1.ChatOpenAI({
        model: 'gpt-4o-mini',
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    });
}
async function evaluateLatestHeadline(headline) {
    const prompt = `Eres un analista de noticias para day trading. Evalúa SOLO esta noticia reciente (la última del día):

HEADLINE: "${headline.title}"

REFERENCIA — Conceptos típicamente BULLISH (STRONG):
${STRONG_KEYWORDS.join(', ')}

REFERENCIA — Conceptos típicamente BEARISH o negativos (WEAK):
${WEAK_KEYWORDS.join(', ')}

Responde EXACTAMENTE en este formato, una sola línea:
STRENGTH|catalyst_type

Donde STRENGTH es uno de: STRONG, MODERATE, WEAK, NONE
y catalyst_type es una frase corta (ej: "Government contract", "Negative earnings", "Product launch").

Ejemplos válidos:
STRONG|Government contract award
MODERATE|Partnership announcement
WEAK|Analyst downgrade
NONE|Routine / no clear catalyst`;
    try {
        const res = await getLLM().invoke(prompt);
        const text = (typeof res.content === 'string' ? res.content : '').trim();
        for (const line of text.split('\n')) {
            const match = line.trim().match(/^(STRONG|MODERATE|WEAK|NONE)\s*[|:]\s*(.+)$/i);
            if (match) {
                return {
                    strength: match[1].toUpperCase(),
                    catalyst_type: match[2].trim().slice(0, 80) || 'Unknown',
                };
            }
        }
    }
    catch {
    }
    return { strength: 'MODERATE', catalyst_type: 'General news (AI fallback)' };
}
function getLatestHeadline(headlines) {
    if (!headlines.length)
        return null;
    const today = headlines.filter((h) => h.age_minutes < 24 * 60);
    const pool = today.length ? today : headlines;
    return pool.sort((a, b) => a.age_minutes - b.age_minutes)[0] ?? null;
}
async function scoreHeadlines(headlines) {
    const latest = getLatestHeadline(headlines);
    if (!latest) {
        return { strength: 'NONE', catalyst_type: 'No news found', is_dilutive: false, justifies_move: false };
    }
    const text = latest.title.toLowerCase();
    const is_dilutive = DILUTIVE_KEYWORDS.some((k) => text.includes(k));
    if (is_dilutive) {
        return {
            strength: 'WEAK',
            catalyst_type: 'Dilutive event (offering/secondary) — DANGER',
            is_dilutive: true,
            justifies_move: false,
        };
    }
    const { strength, catalyst_type } = await evaluateLatestHeadline(latest);
    return {
        strength,
        catalyst_type,
        is_dilutive: false,
        justifies_move: strength === 'STRONG',
    };
}
async function fetchYahooNews(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=10&enableFuzzyQuery=false&lang=en-US`;
        const res = await axios_1.default.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Accept: 'application/json',
            },
        });
        const news = res.data?.news || [];
        const now = Date.now();
        return news.map((item) => {
            const publishedMs = (item.providerPublishTime || 0) * 1000;
            const age_minutes = Math.floor((now - publishedMs) / 60000);
            return {
                title: item.title || '',
                publisher: item.publisher || 'Unknown',
                published_at: publishedMs ? new Date(publishedMs).toISOString() : 'Unknown',
                url: item.link || '',
                age_minutes,
            };
        });
    }
    catch {
        return [];
    }
}
async function fetchFinvizNews(ticker) {
    try {
        const url = `https://momoscreener.com/api/p/ticker/news?q=${ticker}`;
        const res = await axios_1.default.get(url, { timeout: 6000 });
        if (res.data?.news && Array.isArray(res.data.news)) {
            const now = Date.now();
            return res.data.news.map((item) => {
                const publishedMs = item.timestamp ? item.timestamp * 1000 : Date.now();
                return {
                    title: item.title || '',
                    publisher: item.source || 'momoscreener',
                    published_at: new Date(publishedMs).toISOString(),
                    url: item.url || '',
                    age_minutes: Math.floor((now - publishedMs) / 60000),
                };
            });
        }
    }
    catch {
    }
    return [];
}
function createNewsTool() {
    return (0, tools_1.tool)(async ({ ticker }) => {
        ticker = ticker.toUpperCase();
        let headlines = await fetchYahooNews(ticker);
        if (!headlines.length) {
            headlines = await fetchFinvizNews(ticker);
        }
        const { strength, catalyst_type, is_dilutive, justifies_move } = await scoreHeadlines(headlines);
        const recentCount = headlines.filter((h) => h.age_minutes < 60).length;
        const confidence = strength === 'NONE'
            ? 0.1
            : strength === 'WEAK'
                ? 0.3
                : strength === 'MODERATE'
                    ? 0.6
                    : recentCount > 0
                        ? 0.9
                        : 0.7;
        let trade_implication = '';
        if (is_dilutive) {
            trade_implication =
                '⛔ AVOID LONG — Dilutive event detected (offering/secondary). Stock likely to sell off. Short setup possible.';
        }
        else if (strength === 'STRONG') {
            trade_implication =
                '✅ STRONG CATALYST — Move is justified. Look for bull flag, ABCD, or ORB setup to enter on a pullback. High conviction day-trade candidate.';
        }
        else if (strength === 'MODERATE') {
            trade_implication =
                '⚠️ MODERATE CATALYST — Move has some basis but take smaller size. Wait for clean technical setup (VWAP reclaim or flag). Risk of reversal.';
        }
        else if (strength === 'WEAK') {
            trade_implication =
                '🔶 WEAK/NEGATIVE NEWS — Be cautious with longs. News may cap upside or cause sell-the-news. Consider fade setups.';
        }
        else {
            trade_implication =
                '❓ NO NEWS CATALYST — Pure technical / social-media-driven move. High risk of sudden reversal. If trading, use very tight stops and small size.';
        }
        const headlineLines = headlines
            .slice(0, 6)
            .map((h) => {
            const age = h.age_minutes < 60
                ? `${h.age_minutes}min ago`
                : `${Math.floor(h.age_minutes / 60)}h ago`;
            return `  [${age}] ${h.title} — ${h.publisher}`;
        })
            .join('\n');
        const strengthEmoji = {
            STRONG: '🟢',
            MODERATE: '🟡',
            WEAK: '🔴',
            NONE: '⚪',
        }[strength];
        const latestH = getLatestHeadline(headlines);
        const evaluatedLine = latestH
            ? `Headline evaluada (última de hoy): "${latestH.title.slice(0, 80)}${latestH.title.length > 80 ? '…' : ''}"`
            : '';
        return `NEWS CATALYST ANALYSIS: ${ticker}
─────────────────────────────────────────
Catalyst Strength: ${strengthEmoji} ${strength}
Catalyst Type: ${catalyst_type}
Justifies the Move: ${justifies_move ? 'YES ✅' : 'NO ❌'}
Confidence: ${(confidence * 100).toFixed(0)}%
Dilutive Risk: ${is_dilutive ? 'YES ⛔' : 'No'}${evaluatedLine ? `\n${evaluatedLine}` : ''}
─────────────────────────────────────────
Recent Headlines (${headlines.length} found):
${headlineLines || '  No headlines found.'}
─────────────────────────────────────────
Trade Implication:
${trade_implication}`;
    }, {
        name: 'analyze_news_catalyst',
        description: 'Fetches recent news for a stock ticker and categorizes the catalyst strength. ' +
            'Returns: headline list, catalyst type (FDA approval / earnings / offering / etc.), ' +
            'strength rating (STRONG/MODERATE/WEAK/NONE), whether the news justifies the price move, ' +
            'and a trade implication based on the strategy knowledge base. ' +
            'ALWAYS call this tool before deciding to trade — no-catalyst moves are dangerous.',
        schema: zod_1.z.object({
            ticker: zod_1.z.string().describe('Stock ticker symbol, e.g. NVDA, TSLA, AAPL'),
        }),
    });
}
//# sourceMappingURL=news.tool.js.map