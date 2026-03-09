"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RagService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagService = void 0;
const common_1 = require("@nestjs/common");
const js_client_rest_1 = require("@qdrant/js-client-rest");
const openai_1 = require("@langchain/openai");
let RagService = RagService_1 = class RagService {
    constructor() {
        this.logger = new common_1.Logger(RagService_1.name);
        this.collection = '';
    }
    onModuleInit() {
        this.qdrant = new js_client_rest_1.QdrantClient({
            url: process.env.QDRANT_URL || 'http://localhost:6333',
        });
        this.embeddings = new openai_1.OpenAIEmbeddings({
            model: 'text-embedding-3-small',
            apiKey: process.env.OPENAI_API_KEY,
        });
        this.collection = process.env.QDRANT_COLLECTION || 'trading_knowledge';
        this.logger.log(`RAG Service initialized. Collection: ${this.collection}`);
    }
    async searchByStrategy(query, estrategia, limit = 3) {
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
            chunk_id: r.payload['chunk_id'],
            text: r.payload['text'],
            estrategia: r.payload['estrategia'],
            sesiones: r.payload['sesiones'],
            tipo: r.payload['tipo'],
            score: r.score,
        }));
    }
    async searchGeneral(query, limit = 4) {
        const [vector] = await this.embeddings.embedDocuments([query]);
        const response = await this.qdrant.search(this.collection, {
            vector,
            limit,
            with_payload: true,
        });
        return response.map((r) => ({
            chunk_id: r.payload['chunk_id'],
            text: r.payload['text'],
            estrategia: r.payload['estrategia'],
            sesiones: r.payload['sesiones'],
            tipo: r.payload['tipo'],
            score: r.score,
        }));
    }
    async searchBySession(query, sesion, limit = 4) {
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
            chunk_id: r.payload['chunk_id'],
            text: r.payload['text'],
            estrategia: r.payload['estrategia'],
            sesiones: r.payload['sesiones'],
            tipo: r.payload['tipo'],
            score: r.score,
        }));
    }
    formatResultsForLLM(results) {
        if (!results.length)
            return 'No relevant knowledge found.';
        return results
            .map((r, i) => `[Knowledge ${i + 1} | Strategy: ${r.estrategia} | Type: ${r.tipo} | Score: ${r.score.toFixed(2)}]\n${r.text}`)
            .join('\n\n---\n\n');
    }
};
exports.RagService = RagService;
exports.RagService = RagService = RagService_1 = __decorate([
    (0, common_1.Injectable)()
], RagService);
//# sourceMappingURL=rag.service.js.map