import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
🕸️ PATRÓN: GRAPH ORCHESTRATION (LANGGRAPH)

FLUJO COMPLEJO (NO LINEAL):
1. INPUT → Nodo Clasificador
2. Clasificador decide ruta:
   ├─ Si es TEXTO → Nodo Analizador de Texto
   ├─ Si es CÓDIGO → Nodo Analizador de Código  
   ├─ Si es DATOS → Nodo Analizador de Datos
   └─ Si es MIXTO → Múltiples nodos en paralelo
3. Todos convergen → Nodo Sintetizador Final

Ejemplo: "Analiza este código JavaScript"
Clasificador: "Es CÓDIGO" → Analizador de Código → Sintetizador
VS: "Analiza este párrafo y estos datos"  
Clasificador: "Es MIXTO" → Texto + Datos → Sintetizador

¡Como un workflow inteligente con decisiones dinámicas!
*/

/**
 * ============================
 * 1️⃣ ESTADO DEL GRAFO
 * ============================
 */
class GraphState {
  constructor() {
    this.currentNode = 'start';
    this.input = '';
    this.contentType = '';
    this.analysis = [];
    this.route = [];
    this.finalResult = '';
    this.metadata = {
      startTime: new Date(),
      nodesVisited: [],
      decisions: []
    };
  }

  addNodeVisit(nodeName, result) {
    this.metadata.nodesVisited.push({
      node: nodeName,
      timestamp: new Date(),
      result: result.substring(0, 100) + '...'
    });
  }

  addDecision(fromNode, toNode, reason) {
    this.metadata.decisions.push({
      from: fromNode,
      to: toNode,
      reason: reason,
      timestamp: new Date()
    });
  }
}

/**
 * ============================
 * 2️⃣ NODOS DEL GRAFO
 * ============================
 */

// 🎯 NODO CLASIFICADOR: Decide qué tipo de contenido es
const classifierNode = tool(
  async ({ input, state }) => {
    const inputLower = input.toLowerCase();
    let contentType = 'unknown';
    let confidence = 0;
    
    // Reglas de clasificación
    if (inputLower.includes('function') || inputLower.includes('const') || 
        inputLower.includes('import') || inputLower.includes('class') ||
        inputLower.includes('{') && inputLower.includes('}')) {
      contentType = 'code';
      confidence = 0.9;
    } else if (inputLower.includes('datos') || inputLower.includes('tabla') ||
               inputLower.includes('estadística') || inputLower.includes('número') ||
               /\d+/.test(input)) {
      contentType = 'data';
      confidence = 0.8;
    } else if (input.length > 50 && (inputLower.includes('analiza') || 
                                    inputLower.includes('explica') ||
                                    inputLower.includes('describe'))) {
      contentType = 'text';
      confidence = 0.7;
    } else if ((inputLower.includes('código') || inputLower.includes('datos')) && 
               (inputLower.includes('texto') || inputLower.includes('párrafo'))) {
      contentType = 'mixed';
      confidence = 0.85;
    }

    const result = `🎯 NODO CLASIFICADOR ACTIVADO

📊 ANÁLISIS DE CONTENIDO:
Input recibido: "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"

🔍 CLASIFICACIÓN:
Tipo detectado: ${contentType.toUpperCase()}
Confianza: ${Math.round(confidence * 100)}%

🚏 PRÓXIMA RUTA:
${contentType === 'code' ? '→ Enviando a Analizador de Código' : 
  contentType === 'data' ? '→ Enviando a Analizador de Datos' :
  contentType === 'text' ? '→ Enviando a Analizador de Texto' :
  contentType === 'mixed' ? '→ Enviando a Procesamiento Múltiple' :
  '→ Enviando a Procesamiento Genérico'}

✅ Clasificación completada`;

    return { contentType, confidence, result };
  },
  {
    name: "classifier_node",
    description: "Clasifica el tipo de contenido para determinar la ruta del grafo",
    schema: z.object({
      input: z.string().describe("Contenido a clasificar"),
      state: z.string().optional().describe("Estado actual del grafo"),
    }),
  }
);

// 💻 NODO ANALIZADOR DE CÓDIGO
const codeAnalyzerNode = tool(
  async ({ code, context }) => {
    const analysis = {
      language: 'unknown',
      complexity: 'medium',
      issues: [],
      suggestions: []
    };

    // Detectar lenguaje
    if (code.includes('import') && (code.includes('from') || code.includes('{'))) {
      analysis.language = code.includes('react') ? 'javascript/react' : 'javascript';
    } else if (code.includes('def ') || code.includes('import ')) {
      analysis.language = 'python';
    } else if (code.includes('public class') || code.includes('System.out')) {
      analysis.language = 'java';
    }

    // Análisis de complejidad
    const braces = (code.match(/{/g) || []).length;
    if (braces > 5) analysis.complexity = 'high';
    else if (braces < 2) analysis.complexity = 'low';

    // Detectar issues comunes
    if (!code.includes('//') && !code.includes('/*')) {
      analysis.issues.push('Falta documentación/comentarios');
    }
    if (code.length > 200) {
      analysis.suggestions.push('Considerar dividir en funciones más pequeñas');
    }

    const result = `💻 NODO ANALIZADOR DE CÓDIGO ACTIVADO

🔍 ANÁLISIS TÉCNICO:
Lenguaje detectado: ${analysis.language}
Complejidad: ${analysis.complexity}
Líneas aproximadas: ${code.split('\n').length}

⚠️ ISSUES IDENTIFICADOS:
${analysis.issues.length > 0 ? analysis.issues.map(issue => `• ${issue}`).join('\n') : '• Ningún issue crítico detectado'}

💡 SUGERENCIAS:
${analysis.suggestions.length > 0 ? analysis.suggestions.map(s => `• ${s}`).join('\n') : '• Código parece bien estructurado'}

✅ Análisis de código completado`;

    return { analysis, result };
  },
  {
    name: "code_analyzer_node",
    description: "Analiza código fuente para detectar patrones, issues y sugerencias",
    schema: z.object({
      code: z.string().describe("Código fuente a analizar"),
      context: z.string().optional().describe("Contexto adicional del análisis"),
    }),
  }
);

// 📊 NODO ANALIZADOR DE DATOS
const dataAnalyzerNode = tool(
  async ({ data, context }) => {
    const numbers = data.match(/\d+(\.\d+)?/g) || [];
    const analysis = {
      numberCount: numbers.length,
      dataPoints: numbers.map(n => parseFloat(n)),
      insights: []
    };

    if (analysis.dataPoints.length > 0) {
      const sum = analysis.dataPoints.reduce((a, b) => a + b, 0);
      const avg = sum / analysis.dataPoints.length;
      const max = Math.max(...analysis.dataPoints);
      const min = Math.min(...analysis.dataPoints);

      analysis.insights.push(`Promedio: ${avg.toFixed(2)}`);
      analysis.insights.push(`Rango: ${min} - ${max}`);
      analysis.insights.push(`Total valores: ${analysis.numberCount}`);
    }

    const result = `📊 NODO ANALIZADOR DE DATOS ACTIVADO

🔢 ANÁLISIS ESTADÍSTICO:
Números encontrados: ${analysis.numberCount}
${analysis.dataPoints.length > 0 ? `Valores: [${analysis.dataPoints.slice(0, 5).join(', ')}${analysis.dataPoints.length > 5 ? '...' : ''}]` : 'Sin valores numéricos válidos'}

📈 INSIGHTS:
${analysis.insights.length > 0 ? analysis.insights.map(i => `• ${i}`).join('\n') : '• Sin insights estadísticos disponibles'}

💡 RECOMENDACIONES:
• ${analysis.numberCount > 0 ? 'Considerar visualización gráfica' : 'Agregar más datos cuantitativos'}
• ${analysis.dataPoints.length > 10 ? 'Datos suficientes para análisis profundo' : 'Considerar recolectar más muestras'}

✅ Análisis de datos completado`;

    return { analysis, result };
  },
  {
    name: "data_analyzer_node",
    description: "Analiza datos numéricos y estadísticos",
    schema: z.object({
      data: z.string().describe("Datos a analizar"),
      context: z.string().optional().describe("Contexto del análisis"),
    }),
  }
);

// 📝 NODO ANALIZADOR DE TEXTO  
const textAnalyzerNode = tool(
  async ({ text, context }) => {
    const analysis = {
      wordCount: text.split(' ').length,
      sentences: text.split(/[.!?]+/).length - 1,
      readability: 'medium',
      topics: []
    };

    // Análisis de legibilidad simple
    const avgWordsPerSentence = analysis.wordCount / Math.max(analysis.sentences, 1);
    if (avgWordsPerSentence > 20) analysis.readability = 'complex';
    else if (avgWordsPerSentence < 10) analysis.readability = 'simple';

    // Detectar temas comunes
    const topics = ['tecnología', 'programación', 'datos', 'inteligencia artificial', 'web', 'desarrollo'];
    topics.forEach(topic => {
      if (text.toLowerCase().includes(topic)) {
        analysis.topics.push(topic);
      }
    });

    const result = `📝 NODO ANALIZADOR DE TEXTO ACTIVADO

📖 ANÁLISIS TEXTUAL:
Palabras: ${analysis.wordCount}
Oraciones: ${analysis.sentences}
Promedio palabras/oración: ${Math.round(avgWordsPerSentence)}

📊 MÉTRICAS:
Legibilidad: ${analysis.readability}
Longitud: ${analysis.wordCount < 100 ? 'corto' : analysis.wordCount > 500 ? 'largo' : 'medio'}

🏷️ TEMAS IDENTIFICADOS:
${analysis.topics.length > 0 ? analysis.topics.map(t => `• ${t}`).join('\n') : '• Temas generales/no especializados'}

✅ Análisis de texto completado`;

    return { analysis, result };
  },
  {
    name: "text_analyzer_node",
    description: "Analiza contenido textual para métricas y temas",
    schema: z.object({
      text: z.string().describe("Texto a analizar"),
      context: z.string().optional().describe("Contexto del análisis"),
    }),
  }
);

// 🎯 NODO SINTETIZADOR FINAL: Combina todos los resultados
const synthesizerNode = tool(
  async ({ analyses, contentType, originalInput }) => {
    const summary = `🎯 NODO SINTETIZADOR FINAL ACTIVADO

📋 RESUMEN DEL ANÁLISIS COMPLETO:
Input original: "${originalInput.substring(0, 100)}${originalInput.length > 100 ? '...' : ''}"
Tipo identificado: ${contentType.toUpperCase()}

🔍 RESULTADOS PROCESADOS:
${analyses}

🎯 SÍNTESIS FINAL:
El contenido ha sido procesado exitosamente a través del grafo de orquestación. 
${contentType === 'code' ? 'Se realizó análisis técnico especializado del código.' :
  contentType === 'data' ? 'Se ejecutó análisis estadístico de los datos.' :
  contentType === 'text' ? 'Se completó análisis textual y temático.' :
  contentType === 'mixed' ? 'Se aplicaron múltiples tipos de análisis especializados.' :
  'Se realizó procesamiento general del contenido.'}

✨ CONCLUSIÓN:
El patrón Graph Orchestration permitió enrutar inteligentemente el contenido 
al nodo especializado apropiado, maximizando la calidad del análisis.

🏁 Procesamiento del grafo completado exitosamente`;

    return summary;
  },
  {
    name: "synthesizer_node",
    description: "Sintetiza y combina resultados de todos los nodos del grafo",
    schema: z.object({
      analyses: z.string().describe("Resultados de análisis previos"),
      contentType: z.string().describe("Tipo de contenido clasificado"),
      originalInput: z.string().describe("Input original del usuario"),
    }),
  }
);

/**
 * ============================
 * 3️⃣ MODELO LLM
 * ============================
 */
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.2,
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 4️⃣ CREAR GRAPH ORCHESTRATION AGENT
 * ============================
 */
async function main() {
  console.log("🕸️ INICIANDO PATRÓN GRAPH ORCHESTRATION (LANGGRAPH)");
  console.log("=" .repeat(65));
  
  const tools = [classifierNode, codeAnalyzerNode, dataAnalyzerNode, textAnalyzerNode, synthesizerNode];

  const agent = createAgent({
    model: llm,
    tools,
  });

  const graphPrompt = `Eres un orquestador de GRAFO INTELIGENTE:

FLUJO DE GRAFO:
1. SIEMPRE inicia con classifier_node para determinar tipo de contenido
2. Según el tipo clasificado, ejecuta el nodo especializado:
   - code → code_analyzer_node  
   - data → data_analyzer_node
   - text → text_analyzer_node
   - mixed → múltiples nodos según corresponda
3. SIEMPRE termina con synthesizer_node para combinar resultados

IMPORTANTE: 
- Sigue el flujo del grafo estrictamente
- Cada nodo debe procesar y pasar información al siguiente
- El resultado final debe mostrar toda la ruta tomada`;

  // EJEMPLOS DE DIFERENTES RUTAS DEL GRAFO
  const testCases = [
    {
      name: "RUTA DE CÓDIGO",
      input: "Analiza este código JavaScript: function calcular(a, b) { return a + b; }"
    },
    {
      name: "RUTA DE DATOS", 
      input: "Analiza estos datos de ventas: 150, 200, 175, 225, 180. ¿Qué insights puedes dar?"
    },
    {
      name: "RUTA DE TEXTO",
      input: "Analiza este párrafo sobre inteligencia artificial: La IA está transformando múltiples industrias mediante el aprendizaje automático y la automatización de procesos complejos."
    },
    {
      name: "RUTA MIXTA",
      input: "Analiza este código y también los datos que genera: const ventas = [100, 150, 200]; console.log('Promedio:', ventas.reduce((a,b) => a+b)/ventas.length);"
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🚀 EJECUTANDO: ${testCase.name}`);
    console.log("-".repeat(50));
    console.log(`📥 INPUT: ${testCase.input}`);
    console.log();

    const response = await agent.invoke({
      messages: [
        { role: "system", content: graphPrompt },
        { role: "user", content: testCase.input }
      ],
    });

    console.log("🕸️ RESULTADO DEL GRAFO:");
    console.log(response.messages[response.messages.length - 1].content);
    console.log("\n" + "=".repeat(65));
    
    // Pausa entre ejecuciones
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario: "Analiza este código JavaScript: function test() {...}"

2. GRAPH ORCHESTRATION FLOW:
   
   NODO 1 - CLASSIFIER:
   → LLM llama classifier_node(input: "código javascript...")
   → Retorna: { contentType: "code", confidence: 0.9 }
   → Estado del grafo actualizado: route = ["classifier → code_analyzer"]

   NODO 2 - CODE ANALYZER:  
   → LLM decide: "Es código, necesito code_analyzer_node"
   → Llama code_analyzer_node(code: "function test...", context: "javascript")
   → Retorna análisis técnico especializado
   → Estado actualizado: analysis = [código_analysis]

   NODO 3 - SYNTHESIZER:
   → LLM llama synthesizer_node con todos los resultados
   → Combina clasificación + análisis + contexto original
   → Genera reporte final completo

3. FLUJO DINÁMICO:
   User Input → Classifier Node → Conditional Routing → Specialized Node(s) → Synthesizer → Final Result

CARACTERÍSTICAS CLAVE:
✅ Flujo no lineal (condicional)
✅ Nodos especializados según tipo de contenido  
✅ Estado compartido entre nodos
✅ Decisiones dinámicas de enrutamiento
✅ Procesamiento paralelo (para contenido mixto)

VENTAJAS DEL GRAPH ORCHESTRATION:
• Flujos complejos y adaptativos
• Especialización por dominio
• Reutilización de nodos
• Escalabilidad del pipeline
• Trazabilidad del flujo

CASOS DE USO:
- Pipelines de procesamiento de contenido
- Workflows de aprobación multietapa  
- Sistemas de análisis especializados
- Chatbots con flujos conversacionales complejos
- Automatización de procesos empresariales

¡Graph Orchestration permite workflows tan complejos como necesites!
*/