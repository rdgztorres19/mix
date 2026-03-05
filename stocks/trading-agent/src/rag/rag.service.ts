import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIEmbeddings } from '@langchain/openai';
import { Estrategia } from './knowledge-chunks';

export interface RagResult {
  chunk_id: string;
  text: string;
  estrategia: Estrategia;
  sesiones: string[];
  tipo: string;
  score: number;
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private qdrant: QdrantClient;
  private embeddings: OpenAIEmbeddings;
  private collection: string = '';

  onModuleInit() {
    this.qdrant = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
    });
    this.embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.collection = process.env.QDRANT_COLLECTION || 'trading_knowledge';
    this.logger.log(`RAG Service initialized. Collection: ${this.collection}`);
  }

  /**
   * Search for knowledge filtered by a specific trading strategy.
   * Returns the most relevant chunks for that strategy + query.
   */
  async searchByStrategy(
    query: string,
    estrategia: Estrategia,
    limit = 3,
  ): Promise<RagResult[]> {
    const [vector] = await this.embeddings.embedDocuments([query]);

    const response = await this.qdrant.search(this.collection, {
      vector,
      limit,
      filter: {
        must: [
          {
            key: 'estrategia',
            match: { value: estrategia },
          },
        ],
      },
      with_payload: true,
    });

    return response.map((r) => ({
      chunk_id: r.payload['chunk_id'] as string,
      text: r.payload['text'] as string,
      estrategia: r.payload['estrategia'] as Estrategia,
      sesiones: r.payload['sesiones'] as string[],
      tipo: r.payload['tipo'] as string,
      score: r.score,
    }));
  }

  /**
   * General semantic search without strategy filter.
   * Good for broad questions or when strategy is unknown.
   */
  async searchGeneral(query: string, limit = 4): Promise<RagResult[]> {
    const [vector] = await this.embeddings.embedDocuments([query]);

    const response = await this.qdrant.search(this.collection, {
      vector,
      limit,
      with_payload: true,
    });

    return response.map((r) => ({
      chunk_id: r.payload['chunk_id'] as string,
      text: r.payload['text'] as string,
      estrategia: r.payload['estrategia'] as Estrategia,
      sesiones: r.payload['sesiones'] as string[],
      tipo: r.payload['tipo'] as string,
      score: r.score,
    }));
  }

  /**
   * Search filtered by session time (open, late_morning, midday, close).
   */
  async searchBySession(
    query: string,
    sesion: string,
    limit = 4,
  ): Promise<RagResult[]> {
    const [vector] = await this.embeddings.embedDocuments([query]);

    const response = await this.qdrant.search(this.collection, {
      vector,
      limit,
      filter: {
        must: [
          {
            key: 'sesiones',
            match: { any: [sesion, 'all'] },
          },
        ],
      },
      with_payload: true,
    });

    return response.map((r) => ({
      chunk_id: r.payload['chunk_id'] as string,
      text: r.payload['text'] as string,
      estrategia: r.payload['estrategia'] as Estrategia,
      sesiones: r.payload['sesiones'] as string[],
      tipo: r.payload['tipo'] as string,
      score: r.score,
    }));
  }

  /**
   * Format RAG results into a readable string for the LLM context.
   */
  formatResultsForLLM(results: RagResult[]): string {
    if (!results.length) return 'No relevant knowledge found.';

    return results
      .map(
        (r, i) =>
          `[Knowledge ${i + 1} | Strategy: ${r.estrategia} | Type: ${r.tipo} | Score: ${r.score.toFixed(2)}]\n${r.text}`,
      )
      .join('\n\n---\n\n');
  }
}
