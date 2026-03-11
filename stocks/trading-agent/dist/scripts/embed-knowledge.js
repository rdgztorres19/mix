"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const js_client_rest_1 = require("@qdrant/js-client-rest");
const openai_1 = require("@langchain/openai");
const knowledge_chunks_1 = require("../src/rag/knowledge-chunks");
dotenv.config({ path: path.join(__dirname, '../.env') });
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'trading_knowledge';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const VECTOR_SIZE = 1536;
async function main() {
    console.log('🚀 Starting knowledge embedding process...\n');
    const qdrant = new js_client_rest_1.QdrantClient({ url: QDRANT_URL });
    const embeddings = new openai_1.OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
    });
    try {
        const collections = await qdrant.getCollections();
        const exists = collections.collections.some((c) => c.name === COLLECTION_NAME);
        if (exists) {
            console.log(`⚠️  Collection "${COLLECTION_NAME}" already exists. Deleting and recreating...`);
            await qdrant.deleteCollection(COLLECTION_NAME);
        }
        await qdrant.createCollection(COLLECTION_NAME, {
            vectors: {
                size: VECTOR_SIZE,
                distance: 'Cosine',
            },
        });
        console.log(`✅ Collection "${COLLECTION_NAME}" created.\n`);
    }
    catch (err) {
        console.error('Error setting up Qdrant collection:', err);
        process.exit(1);
    }
    console.log(`📚 Embedding ${knowledge_chunks_1.KNOWLEDGE_CHUNKS.length} knowledge chunks...\n`);
    const points = [];
    for (let i = 0; i < knowledge_chunks_1.KNOWLEDGE_CHUNKS.length; i++) {
        const chunk = knowledge_chunks_1.KNOWLEDGE_CHUNKS[i];
        process.stdout.write(`  [${i + 1}/${knowledge_chunks_1.KNOWLEDGE_CHUNKS.length}] ${chunk.id}... `);
        try {
            const [vector] = await embeddings.embedDocuments([chunk.text]);
            points.push({
                id: i + 1,
                vector,
                payload: {
                    chunk_id: chunk.id,
                    text: chunk.text,
                    estrategia: chunk.estrategia,
                    sesiones: chunk.sesiones,
                    tipo: chunk.tipo,
                },
            });
            console.log('✓');
        }
        catch (err) {
            console.log(`❌ Error: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    await qdrant.upsert(COLLECTION_NAME, { points });
    console.log(`\n✅ Successfully embedded ${points.length} chunks into Qdrant.`);
    console.log(`📊 Collection: ${COLLECTION_NAME} | URL: ${QDRANT_URL}`);
    console.log('\nDone! Your knowledge base is ready. Start the API with: npm run start:dev');
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=embed-knowledge.js.map