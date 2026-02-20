import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
🪞 PATRÓN: REFLECTION (SELF-CRITIQUE)

FLUJO SIMPLE:
1. Usuario pide algo
2. GENERADOR crea respuesta inicial
3. CRÍTICO analiza la respuesta y encuentra problemas
4. MEJORADOR toma críticas y hace una mejor versión
5. Repite hasta estar satisfecho

Ejemplo: "Escribe un párrafo sobre IA"
Generador: [párrafo básico]
Crítico: "Muy simple, falta detalle técnico, gramática OK"
Mejorador: [párrafo más detallado y técnico]
Crítico: "Mejor, pero demasiado técnico para audiencia general"
Mejorador: [párrafo balanceado]
*/

/**
 * ============================
 * 1️⃣ GENERADOR: Crea respuesta inicial
 * ============================
 */
const generatorTool = tool(
  async ({ request, context }) => {
    return `📝 RESPUESTA INICIAL:

En relación a "${request}":

Esta es mi primera aproximación al tema. He considerado los aspectos más básicos y obvios. La respuesta cumple con lo mínimo solicitado pero probablemente se puede mejorar significativamente con más análisis y refinamiento.

[STATUS: BORRADOR - NECESITA REVISIÓN]`;
  },
  {
    name: "initial_generator",
    description: "Genera una primera versión de respuesta a la solicitud",
    schema: z.object({
      request: z.string().describe("La solicitud original del usuario"),
      context: z.string().optional().describe("Contexto adicional si lo hay"),
    }),
  }
);

/**
 * ============================
 * 2️⃣ CRÍTICO: Analiza y encuentra problemas
 * ============================
 */
const criticTool = tool(
  async ({ content, criteria }) => {
    // Simular análisis crítico sistemático
    let critiques = [];
    
    // Análisis de longitud
    if (content.length < 200) {
      critiques.push("❌ LONGITUD: Respuesta muy breve, necesita más desarrollo");
    } else if (content.length > 1000) {
      critiques.push("⚠️ LONGITUD: Quizás demasiado extenso, considerar concisión");
    } else {
      critiques.push("✅ LONGITUD: Adecuada");
    }
    
    // Análisis de profundidad
    if (content.includes("básicos") || content.includes("mínimo")) {
      critiques.push("❌ PROFUNDIDAD: Muy superficial, falta análisis profundo");
    } else {
      critiques.push("✅ PROFUNDIDAD: Nivel apropiado");
    }
    
    // Análisis de estructura
    if (content.includes("[STATUS: BORRADOR")) {
      critiques.push("❌ FINALIZACIÓN: Aún está en borrador, necesita completar");
    }
    
    // Análisis de claridad
    const sentences = content.split('.').length;
    if (sentences < 3) {
      critiques.push("⚠️ CLARIDAD: Necesita más explicación y ejemplos");
    }
    
    return `🪞 ANÁLISIS CRÍTICO:

${critiques.join('\n')}

📊 PUNTUACIÓN GENERAL: ${critiques.filter(c => c.includes('✅')).length}/${critiques.length} aspectos correctos

💡 RECOMENDACIONES ESPECÍFICAS:
• Expandir puntos principales con más detalle
• Agregar ejemplos concretos si es relevante  
• Mejorar la conclusión
• Verificar que responde completamente la pregunta original

🎯 PRIORIDAD DE MEJORA: ${critiques.filter(c => c.includes('❌')).length > 0 ? 'ALTA - Requiere mejoras significativas' : 'MEDIA - Refinamientos menores'}`;
  },
  {
    name: "self_critic",
    description: "Analiza críticamente el contenido y identifica áreas de mejora",
    schema: z.object({
      content: z.string().describe("Contenido a analizar críticamente"),
      criteria: z.string().optional().describe("Criterios específicos de evaluación"),
    }),
  }
);

/**
 * ============================
 * 3️⃣ MEJORADOR: Aplica críticas y mejora
 * ============================
 */
const improverTool = tool(
  async ({ originalContent, critiques, targetQuality }) => {
    // Extraer las críticas específicas
    const hasCritiques = critiques.includes('❌');
    const needsDepth = critiques.includes('PROFUNDIDAD');
    const needsLength = critiques.includes('LONGITUD');
    const needsFinalization = critiques.includes('FINALIZACIÓN');
    
    let improvedContent = originalContent.replace('[STATUS: BORRADOR - NECESITA REVISIÓN]', '');
    
    if (needsDepth) {
      improvedContent = `🔍 RESPUESTA MEJORADA:

En relación a "${originalContent.match(/En relación a "(.+)"/)?.[1] || 'la solicitud'}":

Después de un análisis más profundo, puedo proporcionar una perspectiva más completa:

**Aspectos Fundamentales:**
- Componente principal que responde directamente a la solicitud
- Consideraciones importantes que añaden valor  
- Implicaciones y consecuencias relevantes

**Análisis Detallado:**
La cuestión planteada requiere un enfoque multifacético. Los elementos clave incluyen tanto los aspectos técnicos como las consideraciones prácticas del contexto específico.

**Ejemplos Prácticos:**
Para ilustrar mejor el punto, considere situaciones donde estos principios se aplican efectivamente en escenarios reales.

**Conclusión:**
Esta respuesta mejorada proporciona un marco más robusto y aplicable para entender y actuar sobre la solicitud original.`;
    }
    
    if (needsFinalization) {
      improvedContent += `\n\n✅ [VERSIÓN COMPLETADA - LISTA PARA ENTREGA]`;
    }
    
    return improvedContent;
  },
  {
    name: "content_improver", 
    description: "Mejora el contenido basándose en las críticas recibidas",
    schema: z.object({
      originalContent: z.string().describe("Contenido original a mejorar"),
      critiques: z.string().describe("Críticas y sugerencias de mejora"),
      targetQuality: z.string().optional().describe("Nivel de calidad objetivo"),
    }),
  }
);

/**
 * ============================
 * 4️⃣ EVALUADOR FINAL: Confirma si está listo
 * ============================
 */
const finalEvaluatorTool = tool(
  async ({ content }) => {
    const isComplete = !content.includes('BORRADOR');
    const hasGoodLength = content.length > 300;
    const hasStructure = content.includes('**') || content.includes('###');
    const hasConclusion = content.includes('Conclusión') || content.includes('COMPLETADA');
    
    const score = [isComplete, hasGoodLength, hasStructure, hasConclusion].filter(Boolean).length;
    
    if (score >= 3) {
      return `✅ EVALUACIÓN FINAL: APROBADO

📊 Puntuación: ${score}/4 criterios cumplidos
🎯 Estado: LISTO PARA ENTREGA
💬 Comentario: La respuesta cumple con los estándares de calidad requeridos.

No se necesitan más iteraciones de mejora.`;
    } else {
      return `⚠️ EVALUACIÓN FINAL: REQUIERE MÁS TRABAJO

📊 Puntuación: ${score}/4 criterios cumplidos  
🎯 Estado: NECESITA OTRA ITERACIÓN
💬 Comentario: La respuesta aún puede beneficiarse de mejoras adicionales.

Recomiendo una ronda más de reflexión y mejora.`;
    }
  },
  {
    name: "final_evaluator",
    description: "Evaluación final para determinar si el contenido está listo",
    schema: z.object({
      content: z.string().describe("Contenido a evaluar finalmente"),
    }),
  }
);

/**
 * ============================
 * 5️⃣ MODELO LLM
 * ============================
 */
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.2, // Bajo para ser más consistente en el análisis
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 6️⃣ CREAR REFLECTION AGENT
 * ============================
 */
async function main() {
  console.log("🪞 INICIANDO PATRÓN REFLECTION (SELF-CRITIQUE)");
  console.log("=" .repeat(55));
  
  const tools = [generatorTool, criticTool, improverTool, finalEvaluatorTool];

  const agent = createAgent({
    model: llm,
    tools,
  });

  const systemPrompt = `Eres un agente REFLEXIVO que mejora continuamente su trabajo:

PROCESO DE REFLEXIÓN:
1. Genera respuesta inicial con initial_generator
2. Analiza críticamente con self_critic
3. Mejora basándote en críticas con content_improver
4. Evalúa si está listo con final_evaluator
5. Si no está listo, repite desde paso 2

Continúa hasta lograr calidad excelente.`;

  // El agente ejecutará múltiples ciclos de mejora automáticamente
  const response = await agent.invoke({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Explícame qué es la inteligencia artificial y por qué es importante en el mundo actual." }
    ],
  });

  console.log("\n📌 RESULTADO FINAL DESPUÉS DE REFLEXIÓN:");
  console.log(response.messages[response.messages.length - 1].content);
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario: "Explica qué es la IA"

2. LLM ejecuta CICLO DE REFLEXIÓN:
   
   ITERACIÓN 1:
   → Llama initial_generator → Genera respuesta básica
   → Llama self_critic → Encuentra problemas ("muy básico", "falta profundidad")
   → Llama content_improver → Mejora con más detalle
   → Llama final_evaluator → "Aún necesita trabajo"
   
   ITERACIÓN 2:
   → Llama self_critic otra vez → Menos problemas
   → Llama content_improver → Refina más
   → Llama final_evaluator → "Listo para entrega"

3. LLM presenta versión final pulida

El patrón Tool-Calling Loop permite múltiples iteraciones automáticas:
User Input → Generate → Critique → Improve → Evaluate → (Repeat if needed) → Final Result

¡Como tener un editor personal interno que nunca se conforma con "suficientemente bueno"!

VENTAJAS:
• Auto-mejora continua
• Calidad consistentemente alta  
• Detecta errores propios
• Refina automáticamente

Es el patrón perfecto para tareas que requieren alta calidad y precisión.
*/