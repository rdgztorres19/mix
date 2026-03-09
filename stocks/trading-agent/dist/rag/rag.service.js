"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RagService", {
    enumerable: true,
    get: function() {
        return RagService;
    }
});
const _common = require("@nestjs/common");
const _jsclientrest = require("@qdrant/js-client-rest");
const _openai = require("@langchain/openai");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for(var i = decorators.length - 1; i >= 0; i--)if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let RagService = class RagService {
    onModuleInit() {
        this.qdrant = new _jsclientrest.QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333'
        });
        this.embeddings = new _openai.OpenAIEmbeddings({
            model: 'text-embedding-3-small',
            apiKey: process.env.OPENAI_API_KEY
        });
        this.collection = process.env.QDRANT_COLLECTION || 'trading_knowledge';
        this.logger.log(`RAG Service initialized. Collection: ${this.collection}`);
    }
    /**
   * Search for knowledge filtered by a specific trading strategy.
   * Returns the most relevant chunks for that strategy + query.
   */ async searchByStrategy(query, estrategia, limit = 3) {
        const [vector] = await this.embeddings.embedDocuments([
            query
        ]);
        const response = await this.qdrant.search(this.collection, {
            vector,
            limit,
            filter: {
                must: [
                    {
                        key: 'estrategia',
                        match: {
                            value: estrategia
                        }
                    }
                ]
            },
            with_payload: true
        });
        return response.map((r)=>({
                chunk_id: r.payload['chunk_id'],
                text: r.payload['text'],
                estrategia: r.payload['estrategia'],
                sesiones: r.payload['sesiones'],
                tipo: r.payload['tipo'],
                score: r.score
            }));
    }
    /**
   * General semantic search without strategy filter.
   * Good for broad questions or when strategy is unknown.
   */ async searchGeneral(query, limit = 4) {
        const [vector] = await this.embeddings.embedDocuments([
            query
        ]);
        const response = await this.qdrant.search(this.collection, {
            vector,
            limit,
            with_payload: true
        });
        return response.map((r)=>({
                chunk_id: r.payload['chunk_id'],
                text: r.payload['text'],
                estrategia: r.payload['estrategia'],
                sesiones: r.payload['sesiones'],
                tipo: r.payload['tipo'],
                score: r.score
            }));
    }
    /**
   * Search filtered by session time (open, late_morning, midday, close).
   */ async searchBySession(query, sesion, limit = 4) {
        const [vector] = await this.embeddings.embedDocuments([
            query
        ]);
        const response = await this.qdrant.search(this.collection, {
            vector,
            limit,
            filter: {
                must: [
                    {
                        key: 'sesiones',
                        match: {
                            any: [
                                sesion,
                                'all'
                            ]
                        }
                    }
                ]
            },
            with_payload: true
        });
        return response.map((r)=>({
                chunk_id: r.payload['chunk_id'],
                text: r.payload['text'],
                estrategia: r.payload['estrategia'],
                sesiones: r.payload['sesiones'],
                tipo: r.payload['tipo'],
                score: r.score
            }));
    }
    /**
   * Format RAG results into a readable string for the LLM context.
   */ formatResultsForLLM(results) {
        if (!results.length) return 'No relevant knowledge found.';
        return results.map((r, i)=>`[Knowledge ${i + 1} | Strategy: ${r.estrategia} | Type: ${r.tipo} | Score: ${r.score.toFixed(2)}]\n${r.text}`).join('\n\n---\n\n');
    }
    constructor(){
        this.logger = new _common.Logger(RagService.name);
        this.collection = '';
    }
};
RagService = _ts_decorate([
    (0, _common.Injectable)()
], RagService);

//# sourceMappingURL=rag.service.js.map