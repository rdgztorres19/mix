// wordnet-lesk.js
const natural = require('natural');
const { removeStopwords } = require('stopword');

const wordnet = new natural.WordNet();

// --- utilidades de texto ---
function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')               // quita acentos
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // deja solo letras/números/espacios
    .split(/\s+/)
    .filter(Boolean);
}

function bag(text) {
  return new Set(removeStopwords(tokenize(text)));
}

function overlapScore(bagA, bagB) {
  let score = 0;
  for (const w of bagA) if (bagB.has(w)) score++;
  return score;
}

// --- LESK simplificado: elige el mejor sentido del target según el contexto ---
async function leskDisambiguate(target, context, pos /* opcional: 'n','v','a','r' */) {
  const senses = await lookupAsync(target, pos);
  if (senses.length === 0) return null;

  const contextBag = bag(context + ' ' + target); // incluimos el target

  let best = null;
  let bestScore = -1;

  for (const s of senses) {
    // Construimos bolsa con info semántica del sentido
    const def = s.gloss || '';
    const ex = (s.examples || []).join(' ');
    const syns = (s.synonyms || []).join(' ');
    const senseBag = bag(def + ' ' + ex + ' ' + syns);

    const score = overlapScore(contextBag, senseBag);
    if (score > bestScore) {
      bestScore = score;
      best = s; // objeto sense de natural
    }
  }

  return best; // contiene .synsetOffset, .pos, .lemma, .synonyms, .gloss, etc.
}

// --- lookup promisificado ---
function lookupAsync(word, pos) {
  return new Promise((resolve, reject) => {
    const handle = (results) => {
      if (pos) results = results.filter(r => r.pos === pos);
      resolve(results);
    };
    try {
      wordnet.lookup(word, handle);
    } catch (e) {
      reject(e);
    }
  });
}

// --- ¿Comparten algún synset? (sin contexto) ---
async function shareSynset(wordA, wordB, pos /* opcional */) {
  const [sa, sb] = await Promise.all([lookupAsync(wordA, pos), lookupAsync(wordB, pos)]);
  if (sa.length === 0 || sb.length === 0) return false;

  // Coincidencia por "synsetOffset + pos" (identifica el synset)
  const idsA = new Set(sa.map(s => `${s.synsetOffset}:${s.pos}`));
  return sb.some(s => idsA.has(`${s.synsetOffset}:${s.pos}`));
}

// --- ¿Son sinónimos considerando el contexto? ---
async function areSynonyms(wordA, wordB, contextA = '', contextB = '', pos /* opcional */) {
  // 1) Intento rápido: comparten synset sin contexto
  if (await shareSynset(wordA, wordB, pos)) return true;

  // 2) Con contexto: desambiguamos ambos y comparamos synset
  const [bestA, bestB] = await Promise.all([
    leskDisambiguate(wordA, contextA || `${wordA} ${wordB}`, pos),
    leskDisambiguate(wordB, contextB || `${wordA} ${wordB}`, pos),
  ]);

  if (!bestA || !bestB) return false;
  return (bestA.synsetOffset === bestB.synsetOffset) && (bestA.pos === bestB.pos);
}

// --- exportaciones ---
module.exports = {
  leskDisambiguate,
  shareSynset,
  areSynonyms,
};
