import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
🚦 PATRÓN: ROUTER (SWITCH INTELIGENTE)

FLUJO SIMPLE:
1. Usuario hace pregunta
2. ROUTER analiza el tipo de pregunta  
3. ROUTER decide cuál especialista usar
4. ROUTER ejecuta la herramienta correcta

Ejemplo: "¿Cuánto es 5+3?"
Router: "Es matemática" → Usa calculadora
Router: "¿Qué hora es?" → Usa reloj
Router: "¿Cómo está mi CPU?" → Usa monitor sistema
*/

/**
 * ============================
 * 1️⃣ HERRAMIENTAS ESPECIALIZADAS
 * ============================
 */

// Especialista en Matemáticas
const mathTool = tool(
  async ({ operation }) => {
    try {
      // Simple evaluación (¡OJO: Solo para demo, no uses eval en producción!)
      const result = Function(`"use strict"; return (${operation})`)();
      return `🧮 MATEMÁTICAS: ${operation} = ${result}`;
    } catch {
      return `❌ Error en operación matemática: ${operation}`;
    }
  },
  {
    name: "math_specialist",
    description: "Resuelve operaciones matemáticas",
    schema: z.object({
      operation: z.string().describe("Operación matemática a resolver"),
    }),
  }
);

// Especialista en Tiempo
const timeTool = tool(
  async () => {
    const now = new Date();
    return `⏰ TIEMPO: ${now.toLocaleString()} - ${now.toLocaleDateString('es-ES', { weekday: 'long' })}`;
  },
  {
    name: "time_specialist",
    description: "Proporciona información de fecha y hora",
    schema: z.object({}),
  }
);

// Especialista en Sistema
const systemTool = tool(
  async ({ info }) => {
    const os = await import('os');
    
    switch (info.toLowerCase()) {
      case 'memoria':
        const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        return `💾 MEMORIA: ${freeMem}GB libre de ${totalMem}GB total`;
      
      case 'cpu':
        const cpus = os.cpus();
        return `⚙️ CPU: ${cpus[0].model} (${cpus.length} núcleos)`;
      
      default:
        return `🖥️ SISTEMA: ${os.platform()} ${os.release()}`;
    }
  },
  {
    name: "system_specialist",
    description: "Obtiene información del sistema operativo",
    schema: z.object({
      info: z.string().describe("Tipo de información del sistema"),
    }),
  }
);

// Especialista en Conversación General
const chatTool = tool(
  async ({ message }) => {
    const responses = [
      "💬 ¡Hola! Me alegra poder ayudarte hoy.",
      "😊 Entiendo, ¿hay algo específico en lo que pueda asistirte?", 
      "🤝 Estoy aquí para lo que necesites.",
      "✨ ¡Excelente pregunta! Me gusta cuando me hacen pensar."
    ];
    
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];
    return `${randomResponse}\n\nTu mensaje: "${message}"`;
  },
  {
    name: "chat_specialist", 
    description: "Maneja conversación general y saludos",
    schema: z.object({
      message: z.string().describe("Mensaje del usuario para responder"),
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
  temperature: 0.3,
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 3️⃣ CREAR ROUTER AGENT
 * ============================
 */
async function main() {
  console.log("🚦 INICIANDO PATRÓN ROUTER (SWITCH INTELIGENTE)");
  console.log("=" .repeat(55));
  
  const tools = [mathTool, timeTool, systemTool, chatTool];

  const agent = createAgent({
    model: llm,
    tools,
  });

  // Prompt del sistema que actúa como "router inteligente"
  const routerPrompt = `Eres un ROUTER INTELIGENTE que decide cuál especialista usar:

📊 MATEMÁTICAS: Para cálculos, operaciones, números → math_specialist
⏰ TIEMPO: Para hora, fecha, calendario → time_specialist  
🖥️ SISTEMA: Para info de CPU, memoria, OS → system_specialist
💬 CHAT: Para saludos, conversación general → chat_specialist

Analiza la pregunta del usuario y elige la herramienta correcta.`;

  // Pruebas con diferentes tipos de preguntas
  const testQuestions = [
    "¿Cuánto es 25 + 17?",
    "¿Qué hora es?", 
    "¿Cómo está mi memoria RAM?",
    "¡Hola! ¿Cómo estás?"
  ];

  for (const question of testQuestions) {
    console.log(`\n🔍 PREGUNTA: ${question}`);
    console.log("-".repeat(30));
    
    const response = await agent.invoke({
      messages: [
        { role: "system", content: routerPrompt },
        { role: "user", content: question }
      ],
    });

    console.log("📡 RESPUESTA:", response.messages[response.messages.length - 1].content);
  }
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario hace pregunta: "¿Cuánto es 5+3?"
2. LLM (Router) analiza: "Esto es matemáticas"
3. LLM decide: "Necesito usar math_specialist"
4. Llama a mathTool con los parámetros correctos
5. Tool ejecuta y devuelve: "🧮 MATEMÁTICAS: 5+3 = 8" 
6. LLM presenta resultado final

El ROUTER actúa como un switch inteligente:

User Input → LLM Router Analysis → Tool Selection → Tool Execution → Result

Es como tener múltiples especialistas y un gerente inteligente que decide 
cuál usar según el tipo de pregunta. ¡Súper eficiente!
*/