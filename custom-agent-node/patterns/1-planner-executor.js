import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/*
🧠 PATRÓN: PLANNER → EXECUTOR

FLUJO SIMPLE:
1. Usuario da tarea compleja
2. PLANNER la divide en pasos
3. EXECUTOR ejecuta paso por paso

Ejemplo: "Haz una pizza"
Planner: 1) Conseguir ingredientes 2) Hacer masa 3) Armar pizza 4) Hornear
Executor: Ejecuta cada paso uno por uno
*/

/**
 * ============================
 * 1️⃣ PLANNER TOOL
 * ============================
 */
const plannerTool = tool(
  async ({ task }) => {
    return `📋 PLAN PARA: ${task}

Paso 1: Preparar los materiales necesarios
Paso 2: Hacer la parte principal de la tarea  
Paso 3: Revisar que todo esté correcto
Paso 4: Finalizar y limpiar

✅ Plan listo para ejecutar`;
  },
  {
    name: "create_plan",
    description: "Convierte una tarea compleja en pasos simples",
    schema: z.object({
      task: z.string().describe("La tarea que necesita ser planificada"),
    }),
  }
);

/**
 * ============================
 * 2️⃣ EXECUTOR TOOL  
 * ============================
 */
const executorTool = tool(
  async ({ plan }) => {
    // Simular ejecución paso a paso
    const steps = plan.match(/Paso \d+:[^\n]*/g) || [];
    
    let result = "⚡ EJECUTANDO PLAN:\n\n";
    
    steps.forEach((step, index) => {
      result += `✅ ${step} - COMPLETADO\n`;
    });
    
    result += "\n🎉 ¡Todos los pasos ejecutados exitosamente!";
    
    return result;
  },
  {
    name: "execute_plan", 
    description: "Ejecuta un plan paso a paso",
    schema: z.object({
      plan: z.string().describe("El plan que se va a ejecutar"),
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
  temperature: 0,
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 4️⃣ CREAR AGENTE
 * ============================
 */
async function main() {
  console.log("🧠 INICIANDO PATRÓN PLANNER → EXECUTOR");
  console.log("="  .repeat(50));
  
  const tools = [plannerTool, executorTool];

  const agent = createAgent({
    model: llm,
    tools,
  });

  // El agente automáticamente decidirá:
  // 1. Llamar al planner primero
  // 2. Luego al executor con el plan
  const response = await agent.invoke({
    messages: [{ 
      role: "user", 
      content: "Necesito hacer una presentación sobre inteligencia artificial. Ayúdame a planificar y ejecutar esta tarea." 
    }],
  });

  console.log("\n📌 RESULTADO FINAL:");
  console.log(response.messages[response.messages.length - 1].content);
}

main();

/*
🔍 CÓMO FUNCIONA "UNDER THE HOOD" EN LANGCHAIN:

1. Usuario envía mensaje complejo
2. LLM analiza y decide: "Necesito planificar primero"
3. Llama a plannerTool -> Recibe plan estructurado
4. LLM analiza el plan y decide: "Ahora necesito ejecutar"  
5. Llama a executorTool con el plan -> Simula ejecución
6. LLM presenta resultado final al usuario

El patrón Tool-Calling Loop de LangChain maneja la secuencia automáticamente:
User Input → Tool Call 1 (Planner) → Tool Call 2 (Executor) → Final Answer

¡Es como tener DOS AGENTES especializados trabajando en secuencia!
*/