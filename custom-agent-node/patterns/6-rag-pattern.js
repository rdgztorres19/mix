import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
📚 PATRÓN: RAG (RETRIEVAL-AUGMENTED GENERATION)

FLUJO SIMPLE:
1. Usuario hace pregunta
2. RETRIEVER busca documentos relevantes en la base de conocimiento  
3. AUGMENTOR combina la pregunta + documentos encontrados
4. GENERATOR crea respuesta basada en esa información específica

Ejemplo: "¿Cómo funciona JWT?"
Retriever: Busca docs sobre JWT → Encuentra 3 documentos relevantes
Augmentor: Combina pregunta + contenido de esos 3 docs
Generator: "Basándome en la documentación, JWT funciona así..."

¡Como tener una biblioteca personal que el agente consulta!
*/

/**
 * ============================
 * 1️⃣ BASE DE CONOCIMIENTO SIMULADA
 * ============================
 */
// En producción sería Pinecone, Weaviate, ElasticSearch, etc.
const knowledgeBase = [
  {
    id: "jwt-001",
    title: "JSON Web Tokens - Guía Básica",
    content: `JWT (JSON Web Token) es un estándar abierto (RFC 7519) para transmitir información de forma segura entre partes como un objeto JSON compacto y autónomo. Los JWT constan de tres partes separadas por puntos: header.payload.signature. Son útiles para autenticación y intercambio de información seguro.`,
    tags: ["jwt", "autenticación", "seguridad", "tokens"],
    category: "seguridad"
  },
  {
    id: "react-001", 
    title: "React Hooks - useState y useEffect",
    content: `React Hooks permiten usar estado y otras características de React sin escribir clases. useState retorna un array con el valor actual del estado y una función para actualizarlo. useEffect ejecuta efectos secundarios en componentes funcionales y puede limpiar recursos cuando el componente se desmonta.`,
    tags: ["react", "hooks", "usestate", "useeffect", "javascript"],
    category: "frontend"
  },
  {
    id: "node-001",
    title: "Node.js - Event Loop y Asíncronia", 
    content: `Node.js utiliza un event loop de un solo hilo para manejar operaciones asíncronas. Cuando se ejecuta código asíncrono, se delega a APIs del sistema operativo o thread pools, permitiendo que el hilo principal continúe procesando otras tareas. Los callbacks se ejecutan cuando las operaciones async se completan.`,
    tags: ["nodejs", "eventloop", "async", "javascript", "backend"],
    category: "backend"
  },
  {
    id: "ai-001",
    title: "Inteligencia Artificial - Machine Learning Basics",
    content: `El Machine Learning es una rama de la IA que permite a las máquinas aprender patrones de datos sin ser programadas explícitamente. Incluye aprendizaje supervisado (con datos etiquetados), no supervisado (encontrando patrones ocultos) y por refuerzo (aprendiendo mediante recompensas). Los algoritmos comunes incluyen regresión, árboles de decisión y redes neuronales.`,
    tags: ["ai", "machine learning", "algoritmos", "datos", "patrones"],
    category: "ia"
  },
  {
    id: "db-001",
    title: "Bases de Datos - SQL vs NoSQL", 
    content: `Las bases de datos SQL (relacionales) usan estructura de tablas con schemas fijos y ACID compliance. NoSQL incluye documentos (MongoDB), clave-valor (Redis), columnares (Cassandra) y grafos (Neo4j). SQL es mejor para transacciones complejas y relaciones, NoSQL para escalabilidad horizontal y datos semi-estructurados.`,
    tags: ["database", "sql", "nosql", "mongodb", "mysql", "datos"],
    category: "database"
  },
  {
    id: "api-001",
    title: "APIs RESTful - Principios y Mejores Prácticas",
    content: `REST (Representational State Transfer) es un estilo arquitectónico para servicios web. Usa métodos HTTP estándar (GET, POST, PUT, DELETE), es stateless, cacheable y tiene interfaz uniforme. Las URLs deben ser descriptivas (/users/123), usar códigos de estado HTTP apropiados y retornar JSON. Incluir versionado (/v1/api) y documentación clara.`,
    tags: ["api", "rest", "http", "web services", "json"],
    category: "backend"
  }
];

/**
 * ============================
 * 2️⃣ HERRAMIENTAS RAG
 * ============================
 */

// 🔍 RETRIEVER: Busca documentos relevantes
const retrieverTool = tool(
  async ({ query, limit, category }) => {
    const searchLimit = limit || 3;
    const queryLower = query.toLowerCase();
    
    // Calcular relevancia para cada documento
    let results = knowledgeBase.map(doc => {
      let score = 0;
      
      // Búsqueda en título (peso alto)
      if (doc.title.toLowerCase().includes(queryLower)) score += 10;
      
      // Búsqueda en contenido (peso medio)  
      const contentWords = queryLower.split(' ');
      contentWords.forEach(word => {
        if (doc.content.toLowerCase().includes(word)) score += 3;
      });
      
      // Búsqueda en tags (peso alto)
      doc.tags.forEach(tag => {
        if (tag.toLowerCase().includes(queryLower) || queryLower.includes(tag.toLowerCase())) {
          score += 8;
        }
      });
      
      // Filtro por categoría si se especifica
      if (category && doc.category !== category.toLowerCase()) score = 0;
      
      return {
        ...doc,
        relevanceScore: score
      };
    });
    
    // Filtrar y ordenar por relevancia
    results = results
      .filter(doc => doc.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, searchLimit);
    
    if (results.length === 0) {
      return `🔍 RETRIEVAL RESULT:
Query: "${query}"
Documentos encontrados: 0

❌ No se encontraron documentos relevantes en la base de conocimiento.
Considera reformular la pregunta o usar términos más generales.`;
    }
    
    let response = `🔍 RETRIEVAL RESULT:
Query: "${query}"
Documentos encontrados: ${results.length}

`;
    
    results.forEach((doc, index) => {
      response += `📄 DOCUMENTO ${index + 1} (Score: ${doc.relevanceScore})
Título: ${doc.title}
Categoría: ${doc.category}
Contenido: ${doc.content}
Tags: ${doc.tags.join(', ')}

---

`;
    });
    
    return response;
  },
  {
    name: "retrieve_documents",
    description: "Busca y recupera documentos relevantes de la base de conocimiento",
    schema: z.object({
      query: z.string().describe("Consulta de búsqueda para encontrar documentos relevantes"),
      limit: z.number().optional().describe("Número máximo de documentos a recuperar (default: 3)"),
      category: z.string().optional().describe("Filtrar por categoría específica"),
    }),
  }
);

// 🔄 AUGMENTOR: Combina pregunta con documentos
const augmentorTool = tool(
  async ({ originalQuery, retrievedDocs }) => {
    const augmentedPrompt = `CONTEXTO ESPECÍFICO DE LA BASE DE CONOCIMIENTO:
${retrievedDocs}

PREGUNTA ORIGINAL DEL USUARIO:
"${originalQuery}"

INSTRUCCIONES PARA LA RESPUESTA:
- Basa tu respuesta PRINCIPALMENTE en la información proporcionada arriba
- Si la información es insuficiente, menciona qué aspectos necesitan más detalle
- Cita o referencia los documentos cuando sea apropiado
- Mantén la respuesta enfocada y precisa
- Si hay múltiples documentos relevantes, sintetiza la información`;

    return augmentedPrompt;
  },
  {
    name: "augment_context",
    description: "Combina la pregunta original con documentos recuperados para crear contexto enriquecido",
    schema: z.object({
      originalQuery: z.string().describe("Pregunta original del usuario"),
      retrievedDocs: z.string().describe("Documentos recuperados del retriever"),
    }),
  }
);

// 📊 KNOWLEDGE BASE STATS: Estadísticas de la base de conocimiento
const kbStatsTool = tool(
  async () => {
    const totalDocs = knowledgeBase.length;
    const categories = [...new Set(knowledgeBase.map(doc => doc.category))];
    const allTags = knowledgeBase.flatMap(doc => doc.tags);
    const uniqueTags = [...new Set(allTags)];
    
    let categoryCount = {};
    categories.forEach(cat => {
      categoryCount[cat] = knowledgeBase.filter(doc => doc.category === cat).length;
    });
    
    return `📊 ESTADÍSTICAS DE LA BASE DE CONOCIMIENTO:

📚 Total de documentos: ${totalDocs}

🗂️ Por categoría:
${Object.entries(categoryCount).map(([cat, count]) => `• ${cat}: ${count} documentos`).join('\n')}

🏷️ Tags únicos: ${uniqueTags.length} (${uniqueTags.join(', ')})

📈 Estado: ${totalDocs > 0 ? '🟢 Base de conocimiento activa' : '🔴 Sin documentos'}

💡 Cobertura: Programación web, IA, bases de datos, seguridad`;
  },
  {
    name: "knowledge_base_stats",
    description: "Muestra estadísticas de la base de conocimiento disponible",
    schema: z.object({}),
  }
);

/**
 * ============================
 * 3️⃣ MODELO LLM
 * ============================
 */
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.1, // Muy bajo para ser fiel a los documentos
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 4️⃣ CREAR RAG AGENT
 * ============================
 */
async function main() {
  console.log("📚 INICIANDO PATRÓN RAG (RETRIEVAL-AUGMENTED GENERATION)");
  console.log("=" .repeat(65));
  
  const tools = [retrieverTool, augmentorTool, kbStatsTool];

  const agent = createAgent({
    model: llm,
    tools,
  });

  const ragPrompt = `Eres un asistente especializado en RAG (Retrieval-Augmented Generation):

PROCESO RAG:
1. Para CADA pregunta, SIEMPRE busca primero documentos relevantes con retrieve_documents
2. USA la información encontrada como base principal para tu respuesta  
3. Si necesitas más contexto, usa augment_context para estructurar mejor la información
4. Cita o menciona las fuentes cuando sea apropiado
5. Si no hay información suficiente en la base de conocimiento, dilo claramente

IMPORTANTE: Tu conocimiento debe provenir PRINCIPALMENTE de los documentos recuperados.`;

  // EJEMPLOS DE CONSULTAS RAG
  const testQueries = [
    "¿Cómo funcionan los JWT y por qué son seguros?",
    "Explícame la diferencia entre useState y useEffect en React",
    "¿Cuál es la diferencia entre SQL y NoSQL?",
    "¿Cómo funciona el event loop en Node.js?"
  ];

  for (const query of testQueries) {
    console.log(`\n🔍 CONSULTA RAG: ${query}`);
    console.log("-".repeat(50));
    
    const response = await agent.invoke({
      messages: [
        { role: "system", content: ragPrompt },
        { role: "user", content: query }
      ],
    });

    console.log("🤖 RESPUESTA:", response.messages[response.messages.length - 1].content.substring(0, 400) + "...\n");
    
    // Pequeña pausa entre consultas
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Mostrar estadísticas de la base de conocimiento
  console.log("\n📊 ESTADÍSTICAS FINALES:");
  console.log("-".repeat(30));
  
  const statsResponse = await agent.invoke({
    messages: [
      { role: "system", content: ragPrompt },
      { role: "user", content: "Muéstrame las estadísticas de la base de conocimiento" }
    ],
  });
  
  console.log(statsResponse.messages[statsResponse.messages.length - 1].content);
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario: "¿Cómo funcionan los JWT?"

2. RAG PIPELINE:
   → LLM decide: "Necesito buscar información sobre JWT"
   → Llama retrieve_documents(query: "JWT", limit: 3)
   → Retriever busca y encuentra: Documento "JWT-001" con score alto
   → LLM recibe: Info completa sobre JWT del documento

3. AUGMENTATION:
   → LLM usa augment_context para combinar pregunta + documento
   → Crea contexto enriquecido con información específica

4. GENERATION:
   → LLM genera respuesta basándose EN LOS DOCUMENTOS encontrados
   → Resultado: "Basándome en la documentación, JWT es un estándar..."

5. FLUJO COMPLETO:
   User Query → Document Retrieval → Context Augmentation → Knowledge-Grounded Response

VENTAJAS DEL RAG:
✅ Respuestas basadas en fuentes confiables
✅ Información actualizada (según los documentos)  
✅ Trazabilidad (se puede citar la fuente)
✅ Reducción de alucinaciones del LLM
✅ Especialización en dominios específicos

CASOS DE USO:
• Chatbots de soporte técnico
• Asistentes de documentación  
• Q&A sobre bases de conocimiento corporativas
• Análisis de documentos legales/médicos
• Sistemas de recomendación basados en contenido

¡RAG convierte cualquier colección de documentos en un asistente experto!
*/