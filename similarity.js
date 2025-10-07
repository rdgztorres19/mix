// // palabras-sim.js
// const natural = require('natural');

// // Coseno "seguro" (si algún vector es cero, devuelve 0)
// function cosineSafe(a, b) {
//   const dot = a.reduce((s, x, i) => s + x * b[i], 0);
//   const na = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
//   const nb = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
//   return na && nb ? dot / (na * nb) : 0;
// }

// // Vector TF-IDF de una palabra respecto al corpus (dimensión = #docs)
// function tfidfVector(tfidf, word) {
//   const v = [];
//   tfidf.tfidfs(word.toLowerCase(), (_i, measure) => v.push(measure));
//   return v;
// }

// // ==== 1) Corpus pequeño (sinónimos en el mismo doc) ====
// const corpus = [
//   // Doc 0: sinónimos de "carro"
//   "car auto automobile vehicle",
//   // Doc 1: sinónimos de "perro"
//   "dog puppy canine pet",
//   // Doc 2 y 3: dos sentidos de "bank"
//   "bank money finance",
//   "bank river water"
// ];

// // ==== 2) Construir TF-IDF ====
// const tfidf = new natural.TfIdf();
// corpus.forEach(d => tfidf.addDocument(d));

// // ==== 3) Comparaciones de ejemplo ====
// function sim(a, b) {
//   const v1 = tfidfVector(tfidf, a);
//   const v2 = tfidfVector(tfidf, b);
//   return cosineSafe(v1, v2);
// }

// console.log('car vs automobile  ->', sim('car', 'automobile').toFixed(4)); // ≈ 1.0000 (muy alto)
// console.log('dog vs puppy       ->', sim('dog', 'puppy').toFixed(4));       // ≈ 1.0000 (muy alto)
// console.log('car vs dog         ->', sim('car', 'dog').toFixed(4));         // ≈ 0.0000 (bajo)
// console.log('bank vs finance    ->', sim('bank', 'finance').toFixed(4));    // alto (comparten Doc 2)
// console.log('bank vs river      ->', sim('bank', 'river').toFixed(4));      // alto (comparten Doc 3)
// console.log('finance vs river   ->', sim('finance', 'river').toFixed(4));   // ≈ 0.0000 (bajo)

// const natural = require('natural');
// const wordnet = new natural.WordNet();

// wordnet.lookup('pressure', (results) => {
//   results.forEach(result => {
//     console.log(result.synonyms);
//   });
// });

// const synonyms = require('synonyms');

// console.log(synonyms('pressure')); 

// const WordNet = require('node-wordnet');
// const wordnet = new WordNet();

// wordnet.lookup('temperature', (results) => {
//   results.forEach(result => {
//     console.log(result.synonyms);
//   });
// });

// embeddings.js
import { pipeline, env } from '@xenova/transformers';

// Modelo pequeño tipo Sentence-BERT (MiniLM 384 dimensiones)
const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

console.log('Ruta de cache:', env.cacheDir);

function cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main() {
    console.time("similarity");
    // 1) Cargar pipeline (la primera vez descarga el modelo)
    const extractor = await pipeline('feature-extraction', MODEL_ID);

    // 2) Textos a comparar
    const texts = ['car', 'automobile', 'dog', 'animal', "temperature", "weather", "heat", "motor", "engine", "big", "large", "small", "tiny", "apple", "banana", "orange", "grape", "lemon", "lime", "cherry", "peach", "pear", "plum", "mango", "pineapple", "strawberry", "blueberry", "raspberry", "blackberry", "watermelon", "cantaloupe", "honeydew", "apricot", "kiwi", "papaya", "pomegranate", "fig", "date",
        "dog", "cat", "horse", "cow", "sheep", "goat", "pig", "chicken", "duck", "goose", "turkey", "rabbit", "deer", "bear", "lion", "tiger", "leopard", "cheetah", "wolf", "fox", "zebra", "giraffe", "elephant", "monkey", "gorilla",
        "table", "chair", "desk", "sofa", "bed", "lamp", "pillow", "blanket", "curtain", "rug", "mirror", "window", "door", "cabinet", "shelf", "book", "pen", "pencil", "notebook", "backpack", "suitcase", "clock", "watch", "phone", "laptop",
        "run", "walk", "jump", "swim", "fly", "read", "write", "speak", "listen", "think", "build", "create", "design", "test", "deploy", "learn", "teach", "drive", "cook", "bake", "wash", "clean", "open", "close", "sleep",
        "big", "small", "large", "tiny", "fast", "slow", "hot", "cold", "warm", "cool", "bright", "dark", "light", "heavy", "simple", "complex", "modern", "ancient", "noisy", "quiet", "early", "late", "soft", "hard", "sharp",
        "server", "client", "database", "query", "index", "cache", "memory", "storage", "network", "packet", "protocol", "router", "switch", "firewall", "browser", "cookie", "session", "token", "queue", "thread", "process", "kernel", "module", "library", "framework",
        "mountain", "valley", "river", "lake", "ocean", "sea", "beach", " island", "forest", "jungle", "desert", "prairie", "canyon", "glacier", "volcano", "hill", "meadow", "swamp", "reef", "shore", "coast", "cliff", "cave", "spring", "waterfall",
        "hammer", "screwdriver", "wrench", "pliers", "drill", "saw", "nail", "screw", "bolt", "tape", "glue", "paint", "brush", "broom", "mop", "bucket", "soap", "sponge", "detergent", "towel", "toaster", "kettle", "oven", "fridge", "freezer",
        "freedom", "justice", "honor", "courage", "wisdom", "patience", "kindness", "empathy", "love", "trust", "hope", "faith", "charity", "loyalty", "integrity", "ambition", "success", "failure", "progress", "change", "strategy", "vision", "mission", "value", "culture",
        "music", "movie", "theater", "concert", "festival", "market", "bakery", "cafe", "restaurant", "school", "college", "library", "museum", "hospital", "airport", "station", "highway", "bridge", "tunnel", "park", "garden", "stadium", "arena", "office", "factory"];

    // 3) Generar embeddings normalizados
    const opts = { pooling: 'mean', normalize: true };
    const embeddings = {};
    for (const t of texts) {
        const out = await extractor(t, opts);
        embeddings[t] = out.data;
        console.log(`"${t}" → vector de dimensión: ${out.data.length}`);
    }

    // 4) Comparar similitud
    console.log('\nSimilitudes coseno:');
    console.log('car ~ automobile =', cosineSimilarity(embeddings['car'], embeddings['automobile']).toFixed(4));
    console.log('dog ~ animal     =', cosineSimilarity(embeddings['dog'], embeddings['animal']).toFixed(4));
    console.log('temperature ~ weather     =', cosineSimilarity(embeddings['big'], embeddings['small']).toFixed(4));
    console.timeEnd("similarity");

    //   const classify = await pipeline('text-classification', 'Xenova/distilbert-base-uncased-finetuned-sst-2-english');
    //   console.log(await classify('I love this product!'));

    // const qa = await pipeline('question-answering', 'Xenova/distilbert-base-cased-distilled-squad');
    // console.log(await qa({ question: 'Who founded SpaceX?', context: 'Elon Musk founded SpaceX in 2002.' }));
}

main();
