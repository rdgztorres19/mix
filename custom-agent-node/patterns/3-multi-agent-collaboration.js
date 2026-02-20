import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
🤝 PATRÓN: MULTI-AGENT COLLABORATION

FLUJO SIMPLE:
1. Usuario pide algo complejo
2. COORDINADOR decide qué agentes necesita
3. AGENTE A hace su parte → pasa resultado a AGENTE B
4. AGENTE B usa resultado de A para hacer su parte
5. COORDINADOR combina todo

Ejemplo: "Escribe un email profesional"
Coordinador: Necesito Writer + Editor + Formatter
Writer: Escribe borrador → Editor: Corrige errores → Formatter: Da formato final
*/

/**
 * ============================
 * 1️⃣ AGENTES ESPECIALIZADOS (simulados como tools)
 * ============================
 */

// 📝 ESCRITOR: Crea contenido original
const writerAgent = tool(
  async ({ topic, style }) => {
    const styles = {
      profesional: "Estimado/a,\n\nMe dirijo a usted para informarle sobre",
      casual: "¡Hola!\n\nTe escribo para contarte que",
      formal: "Por medio de la presente, me permito comunicarle",
      amigable: "¡Hola! ¿Cómo estás?\n\nQuería comentarte sobre"
    };
    
    const intro = styles[style] || styles.profesional;
    
    return `✍️ BORRADOR CREADO:

${intro} ${topic}.

Este tema es muy importante y me gustaría que consideraras los siguientes puntos:
- Punto principal sobre el tema
- Beneficios que esto puede traer
- Próximos pasos sugeridos

Espero tu respuesta.

[NECESITA REVISIÓN DE EDITOR]`;
  },
  {
    name: "writer_agent",
    description: "Agente escritor que crea contenido original",
    schema: z.object({
      topic: z.string().describe("Tema sobre el que escribir"),
      style: z.string().describe("Estilo: profesional, casual, formal, amigable"),
    }),
  }
);

// ✏️ EDITOR: Revisa y mejora el contenido
const editorAgent = tool(
  async ({ content }) => {
    // Simular correcciones de editor
    let editedContent = content
      .replace("[NECESITA REVISIÓN DE EDITOR]", "")
      .replace("Este tema es muy importante y me gustaría que consideraras", 
               "Considero importante que analices")
      .replace("Punto principal sobre el tema", 
               "Aspecto fundamental del asunto")
      .replace("Espero tu respuesta", 
               "Quedo a la espera de tu retroalimentación");
    
    return `✏️ CONTENIDO EDITADO:

${editedContent}

[CORRECCIONES APLICADAS]
• Mejorada fluidez del texto
• Refinado vocabulario
• Estructura optimizada

[LISTO PARA FORMATO FINAL]`;
  },
  {
    name: "editor_agent",
    description: "Agente editor que revisa y mejora textos",
    schema: z.object({
      content: z.string().describe("Contenido a editar y revisar"),
    }),
  }
);

// 🎨 FORMATEADOR: Da formato final profesional
const formatterAgent = tool(
  async ({ editedContent, format }) => {
    const cleanContent = editedContent
      .replace(/\[.*?\]/g, "")
      .trim();
    
    const formats = {
      email: `
📧 EMAIL PROFESIONAL
${'='.repeat(50)}
${cleanContent}

Saludos cordiales,
[Tu nombre]
[Tu cargo]
[Empresa]
${'='.repeat(50)}`,
      
      carta: `
📜 CARTA FORMAL
${'='.repeat(50)}
Fecha: ${new Date().toLocaleDateString()}

${cleanContent}

Atentamente,

_____________________
[Firma]
${'='.repeat(50)}`,
      
      memo: `
📋 MEMORÁNDUM
${'='.repeat(50)}
PARA: Destinatario
DE: Remitente  
FECHA: ${new Date().toLocaleDateString()}
ASUNTO: [Tema]

${cleanContent}
${'='.repeat(50)}`
    };
    
    return formats[format] || formats.email;
  },
  {
    name: "formatter_agent",
    description: "Agente formateador que da presentación final",
    schema: z.object({
      editedContent: z.string().describe("Contenido editado para formatear"),
      format: z.string().describe("Formato deseado: email, carta, memo"),
    }),
  }
);

// 🎯 COORDINADOR: Orquesta el trabajo de todos
const coordinatorAgent = tool(
  async ({ task, agents_needed }) => {
    return `🎯 PLAN DE COLABORACIÓN ACTIVADO

TAREA: ${task}
AGENTES REQUERIDOS: ${agents_needed}

FLUJO DE TRABAJO:
1. 📝 Writer Agent → Crear borrador inicial
2. ✏️ Editor Agent → Revisar y mejorar contenido  
3. 🎨 Formatter Agent → Aplicar formato final

⚡ Iniciando colaboración secuencial...`;
  },
  {
    name: "coordinator_agent",
    description: "Coordina el trabajo entre múltiples agentes",
    schema: z.object({
      task: z.string().describe("Tarea a coordinar"),
      agents_needed: z.string().describe("Lista de agentes necesarios"),
    }),
  }
);

/**
 * ============================
 * 2️⃣ MODELO LLM
 * ============================
 */
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.4,
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 3️⃣ CREAR MULTI-AGENT SYSTEM
 * ============================
 */
async function main() {
  console.log("🤝 INICIANDO PATRÓN MULTI-AGENT COLLABORATION");
  console.log("=" .repeat(60));
  
  const tools = [writerAgent, editorAgent, formatterAgent, coordinatorAgent];

  const agent = createAgent({
    model: llm,
    tools,
  });

  // El LLM automáticamente coordinará y usará los agentes en secuencia
  const response = await agent.invoke({
    messages: [{ 
      role: "user", 
      content: "Necesito escribir un email profesional para mi jefe sobre mi propuesta de proyecto de automatización. Que sea formal pero no muy rígido." 
    }],
  });

  console.log("\n📌 RESULTADO DE COLABORACIÓN:");
  console.log(response.messages[response.messages.length - 1].content);
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario: "Escribe email profesional sobre proyecto"

2. LLM decide: "Necesito múltiples agentes trabajando juntos"
   → Llama coordinatorAgent

3. Coordinador: "Necesito Writer → Editor → Formatter"  

4. SECUENCIA DE COLABORACIÓN:
   → LLM llama writerAgent(topic: "proyecto", style: "profesional")
   → Writer devuelve borrador
   → LLM llama editorAgent(content: borrador)  
   → Editor devuelve versión mejorada
   → LLM llama formatterAgent(editedContent: mejorado, format: "email")
   → Formatter devuelve versión final

5. LLM presenta resultado final unificado

El patrón Tool-Calling Loop maneja toda la orquestación:
User Input → Coordinator → Agent A → Agent B → Agent C → Final Result

¡Como tener un EQUIPO COMPLETO trabajando en tu tarea!
*/