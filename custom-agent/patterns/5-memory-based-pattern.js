import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
🧠 PATRÓN: MEMORY-BASED (PERSISTENT MEMORY)

FLUJO SIMPLE:
1. Usuario habla con el agente
2. AGENTE guarda información importante en memoria
3. En conversaciones futuras, AGENTE recuerda contexto previo
4. AGENTE usa memoria para dar respuestas más personalizadas

Ejemplo:
Conversación 1: "Me llamo Juan y trabajo en marketing"
Agente: [Guarda: nombre=Juan, trabajo=marketing]

Conversación 2: "¿Qué cursos me recomiendas?"  
Agente: [Busca memoria: Juan, marketing] 
Respuesta: "Juan, para marketing te recomiendo..."

¡Como tener memoria a largo plazo!
*/

/**
 * ============================
 * 1️⃣ SIMULACIÓN DE BASE DE DATOS
 * ============================
 */
// En producción, esto sería Redis, MySQL, etc.
// Aquí usamos memoria simple para demostración
const memoryDB = {
  conversations: new Map(),
  userProfiles: new Map(),
  preferences: new Map(),
  facts: new Map()
};

let conversationCounter = 0;

/**
 * ============================
 * 2️⃣ HERRAMIENTAS DE MEMORIA
 * ============================
 */

// 💾 GUARDAR en memoria
const saveMemoryTool = tool(
  async ({ type, key, data, importance }) => {
    const timestamp = new Date().toISOString();
    const memoryEntry = {
      data: data,
      timestamp: timestamp,
      importance: importance || 'normal',
      accessCount: 0
    };

    // Guardar en el tipo de memoria apropiado
    switch (type) {
      case 'conversation':
        memoryDB.conversations.set(key, memoryEntry);
        break;
      case 'profile':
        memoryDB.userProfiles.set(key, memoryEntry);
        break;
      case 'preference':
        memoryDB.preferences.set(key, memoryEntry);
        break;
      case 'fact':
        memoryDB.facts.set(key, memoryEntry);
        break;
    }

    return `💾 MEMORIA GUARDADA:
Tipo: ${type}
Clave: ${key}
Datos: ${data}
Importancia: ${importance}
Timestamp: ${timestamp}

✅ Almacenado exitosamente en memoria ${type}`;
  },
  {
    name: "save_to_memory",
    description: "Guarda información importante en memoria persistente",
    schema: z.object({
      type: z.enum(['conversation', 'profile', 'preference', 'fact']).describe("Tipo de memoria"),
      key: z.string().describe("Clave única para identificar la información"),
      data: z.string().describe("Información a guardar"),
      importance: z.enum(['low', 'normal', 'high', 'critical']).optional().describe("Nivel de importancia"),
    }),
  }
);

// 🔍 BUSCAR en memoria
const searchMemoryTool = tool(
  async ({ query, type, limit }) => {
    let results = [];
    const searchLimit = limit || 5;
    
    // Función para buscar en un Map específico
    const searchInMap = (map, mapType) => {
      for (const [key, entry] of map.entries()) {
        const searchText = `${key} ${entry.data}`.toLowerCase();
        const queryLower = query.toLowerCase();
        
        if (searchText.includes(queryLower)) {
          // Incrementar contador de acceso
          entry.accessCount++;
          
          results.push({
            type: mapType,
            key: key,
            data: entry.data,
            relevance: this.calculateRelevance(searchText, queryLower),
            importance: entry.importance,
            timestamp: entry.timestamp,
            accessCount: entry.accessCount
          });
        }
      }
    };

    // Buscar en el tipo específico o en todos
    if (type) {
      const targetMap = memoryDB[type + 's'] || memoryDB[type];
      if (targetMap) searchInMap(targetMap, type);
    } else {
      searchInMap(memoryDB.conversations, 'conversation');
      searchInMap(memoryDB.userProfiles, 'profile');
      searchInMap(memoryDB.preferences, 'preference');
      searchInMap(memoryDB.facts, 'fact');
    }

    // Ordenar por relevancia e importancia
    results.sort((a, b) => {
      const scoreA = (a.relevance * 0.6) + (a.importance === 'critical' ? 1 : a.importance === 'high' ? 0.8 : 0.5) * 0.4;
      const scoreB = (b.relevance * 0.6) + (b.importance === 'critical' ? 1 : b.importance === 'high' ? 0.8 : 0.5) * 0.4;
      return scoreB - scoreA;
    });

    results = results.slice(0, searchLimit);

    if (results.length === 0) {
      return `🔍 BÚSQUEDA EN MEMORIA:
Query: "${query}"
Resultados: 0 encontrados

❌ No se encontró información relevante en la memoria.
Considera que esta podría ser información nueva para recordar.`;
    }

    let response = `🔍 BÚSQUEDA EN MEMORIA:
Query: "${query}"
Resultados: ${results.length} encontrados

`;

    results.forEach((result, index) => {
      response += `${index + 1}. 📄 ${result.type.toUpperCase()}
   Clave: ${result.key}
   Información: ${result.data}
   Importancia: ${result.importance} | Accesos: ${result.accessCount}
   Fecha: ${result.timestamp.split('T')[0]}

`;
    });

    return response;
  },
  {
    name: "search_memory",
    description: "Busca información relevante en la memoria almacenada",
    schema: z.object({
      query: z.string().describe("Término de búsqueda o contexto"),
      type: z.enum(['conversation', 'profile', 'preference', 'fact']).optional().describe("Tipo específico de memoria a buscar"),
      limit: z.number().optional().describe("Número máximo de resultados"),
    }),
  }
);

// 📊 ESTADÍSTICAS de memoria
const memoryStatsTool = tool(
  async () => {
    const stats = {
      conversations: memoryDB.conversations.size,
      profiles: memoryDB.userProfiles.size, 
      preferences: memoryDB.preferences.size,
      facts: memoryDB.facts.size,
      total: memoryDB.conversations.size + memoryDB.userProfiles.size + memoryDB.preferences.size + memoryDB.facts.size
    };

    // Calcular memoria más accedida
    let mostAccessed = { type: 'none', key: '', count: 0 };
    
    for (const [mapName, map] of Object.entries(memoryDB)) {
      for (const [key, entry] of map.entries()) {
        if (entry.accessCount > mostAccessed.count) {
          mostAccessed = { type: mapName, key: key, count: entry.accessCount };
        }
      }
    }

    return `📊 ESTADÍSTICAS DE MEMORIA:

💾 Almacenamiento actual:
• Conversaciones: ${stats.conversations}
• Perfiles: ${stats.profiles}
• Preferencias: ${stats.preferences}
• Datos/Hechos: ${stats.facts}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Total entradas: ${stats.total}

🔥 Más accedida: ${mostAccessed.type}:"${mostAccessed.key}" (${mostAccessed.count} veces)

💡 Estado: ${stats.total > 0 ? '🟢 Memoria activa' : '🔴 Memoria vacía'}`;
  },
  {
    name: "memory_stats",
    description: "Muestra estadísticas de uso de la memoria",
    schema: z.object({}),
  }
);

// 🗑️ LIMPIAR memoria (opcional)
const clearMemoryTool = tool(
  async ({ type, confirm }) => {
    if (!confirm || confirm.toLowerCase() !== 'yes') {
      return "⚠️ LIMPIEZA CANCELADA: Se requiere confirmación explícita (confirm: 'yes')";
    }

    let cleared = 0;
    
    if (type === 'all') {
      cleared = memoryDB.conversations.size + memoryDB.userProfiles.size + memoryDB.preferences.size + memoryDB.facts.size;
      memoryDB.conversations.clear();
      memoryDB.userProfiles.clear();
      memoryDB.preferences.clear();
      memoryDB.facts.clear();
    } else {
      const targetMap = memoryDB[type + 's'] || memoryDB[type];
      if (targetMap) {
        cleared = targetMap.size;
        targetMap.clear();
      }
    }

    return `🗑️ MEMORIA LIMPIADA:
Tipo: ${type}
Entradas eliminadas: ${cleared}

✅ Memoria ${type === 'all' ? 'completamente' : 'parcialmente'} reiniciada.`;
  },
  {
    name: "clear_memory",
    description: "Limpia la memoria almacenada (usar con precaución)",
    schema: z.object({
      type: z.enum(['conversation', 'profile', 'preference', 'fact', 'all']).describe("Tipo de memoria a limpiar"),
      confirm: z.string().describe("Escribir 'yes' para confirmar la limpieza"),
    }),
  }
);

/**
 * ============================
 * 3️⃣ FUNCIÓN AUXILIAR
 * ============================
 */
function calculateRelevance(text, query) {
  // Algoritmo simple de relevancia
  const words = query.split(' ');
  let matches = 0;
  
  words.forEach(word => {
    if (text.includes(word)) matches++;
  });
  
  return matches / words.length;
}

/**
 * ============================
 * 4️⃣ MODELO LLM
 * ============================
 */
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.3,
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 5️⃣ CREAR MEMORY AGENT
 * ============================
 */
async function simulateConversations() {
  console.log("🧠 INICIANDO PATRÓN MEMORY-BASED (PERSISTENT MEMORY)");
  console.log("=" .repeat(60));
  
  const tools = [saveMemoryTool, searchMemoryTool, memoryStatsTool, clearMemoryTool];

  const agent = createAgent({
    model: llm,
    tools,
  });

  const memoryPrompt = `Eres un asistente con MEMORIA PERSISTENTE:

COMPORTAMIENTO:
1. SIEMPRE busca primero en tu memoria información relevante sobre el usuario
2. GUARDA información importante que el usuario comparta (nombre, preferencias, contexto)
3. USA la memoria para personalizar tus respuestas
4. RECUERDA conversaciones previas para continuidad

TIPOS DE INFORMACIÓN A RECORDAR:
- profile: Nombre, trabajo, datos personales del usuario
- preference: Gustos, intereses, preferencias del usuario  
- conversation: Temas importantes de conversaciones previas
- fact: Hechos importantes o datos específicos compartidos

Sé proactivo recordando y usando información previa.`;

  // SIMULACIÓN DE CONVERSACIONES MÚLTIPLES
  
  // 🔵 CONVERSACIÓN 1: Primera interacción
  console.log("\n🔵 CONVERSACIÓN 1 (Primera vez):");
  console.log("-".repeat(40));
  
  const conv1 = await agent.invoke({
    messages: [
      { role: "system", content: memoryPrompt },
      { role: "user", content: "¡Hola! Soy María, soy diseñadora gráfica y me encanta el café. ¿Podrías recomendarme un buen curso de UX/UI design?" }
    ],
  });
  
  console.log("🤖 AGENTE:", conv1.messages[conv1.messages.length - 1].content.substring(0, 300) + "...");
  
  // Esperar un poco para simular tiempo entre conversaciones
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 🟢 CONVERSACIÓN 2: Usando memoria
  console.log("\n🟢 CONVERSACIÓN 2 (Con memoria):");
  console.log("-".repeat(40));
  
  const conv2 = await agent.invoke({
    messages: [
      { role: "system", content: memoryPrompt },
      { role: "user", content: "Hola de nuevo, ¿recuerdas algún lugar bueno para trabajar desde laptop?" }
    ],
  });
  
  console.log("🤖 AGENTE:", conv2.messages[conv2.messages.length - 1].content.substring(0, 300) + "...");
  
  // 🟡 CONVERSACIÓN 3: Contexto más complejo
  console.log("\n🟡 CONVERSACIÓN 3 (Contexto complejo):");
  console.log("-".repeat(40));
  
  const conv3 = await agent.invoke({
    messages: [
      { role: "system", content: memoryPrompt },
      { role: "user", content: "¿Qué opinas sobre combinar mi trabajo de diseño gráfico con lo que estoy aprendiendo?" }
    ],
  });
  
  console.log("🤖 AGENTE:", conv3.messages[conv3.messages.length - 1].content.substring(0, 400) + "...");
}

// Función principal
async function main() {
  await simulateConversations();
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario: "Soy María, diseñadora, me gusta el café"

2. LLM analiza: "Información personal importante"
   → Llama save_to_memory(type: 'profile', key: 'user_maria', data: 'nombre: María, trabajo: diseñadora gráfica')
   → Llama save_to_memory(type: 'preference', key: 'maria_drinks', data: 'le gusta el café')

3. Conversación 2: "¿recuerdas lugares para trabajar con laptop?"
   
4. LLM: "Necesito recordar información sobre este usuario"
   → Llama search_memory(query: 'usuario trabajo laptop')
   → Encuentra: "María, diseñadora, le gusta café"
   → Respuesta personalizada: "¡Hola María! Como diseñadora que ama el café, te recomiendo..."

5. MEMORIA PERSISTENTE:
   User Input → Search Memory → Use Context → Save New Info → Personalized Response

El patrón permite:
• Continuidad entre conversaciones
• Personalización incremental  
• Contexto acumulativo
• Relaciones a largo plazo

¡Como tener un asistente que realmente te conoce!

CASOS DE USO:
- Asistentes personales
- Customer service  
- Tutores educativos
- Coaches/mentores
- Aplicaciones de productividad

La memoria convierte un agente stateless en uno con historia y personalidad.
*/