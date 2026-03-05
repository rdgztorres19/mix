import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings } from '@langchain/openai';
import { KNOWLEDGE_CHUNKS } from '../src/rag/knowledge-chunks';

dotenv.config({ path: path.join(__dirname, '../.env') });

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || 'trading_knowledge';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const VECTOR_SIZE = 1536; // text-embedding-3-small

async function main() {
  console.log('🚀 Starting knowledge embedding process...\n');

  const qdrant = new QdrantClient({ url: QDRANT_URL });
  const embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Check/create collection
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
  } catch (err) {
    console.error('Error setting up Qdrant collection:', err);
    process.exit(1);
  }

  // Embed and upsert all chunks
  console.log(`📚 Embedding ${KNOWLEDGE_CHUNKS.length} knowledge chunks...\n`);

  const points: any[] = [];

  for (let i = 0; i < KNOWLEDGE_CHUNKS.length; i++) {
    const chunk = KNOWLEDGE_CHUNKS[i];
    process.stdout.write(`  [${i + 1}/${KNOWLEDGE_CHUNKS.length}] ${chunk.id}... `);

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
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 300));
  }

  // Upsert all points in one batch
  await qdrant.upsert(COLLECTION_NAME, { points });
  console.log(`\n✅ Successfully embedded ${points.length} chunks into Qdrant.`);
  console.log(`📊 Collection: ${COLLECTION_NAME} | URL: ${QDRANT_URL}`);
  console.log('\nDone! Your knowledge base is ready. Start the API with: npm run start:dev');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
