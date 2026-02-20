import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/**
 * 🧠 PLANNER AGENT
 * ===============
 * 
 * FUNCIÓN: Recibe una tarea compleja y la descompone en pasos ejecutables
 * PATRÓN: Planner → Executor
 * 
 * UNDER THE HOOD:
 * 1. Analiza la tarea compleja del usuario
 * 2. Descompone en subtareas específicas y ordenadas
 * 3. Identifica las herramientas/recursos necesarios para cada paso
 * 4. Crea un plan estructurado que el Executor puede seguir
 */

export class PlannerAgent {
  constructor() {
    this.llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.3, // Más determinístico para planificación
      apiKey: process.env.OPENAI_API_KEY
    });

    this.setupTools();
    this.createAgent();
  }

  setupTools() {
    // Tool para crear planes estructurados
    this.createPlanTool = tool(
      async ({ task, complexity, deadline, resources }) => {
        const systemPrompt = `Eres un PLANIFICADOR EXPERTO que descompone tareas complejas en pasos ejecutables.

Tu trabajo es crear un PLAN DETALLADO siguiendo esta estructura:

📋 ANÁLISIS DE LA TAREA:
- Complejidad: [Simple/Media/Alta/Muy Alta]
- Tiempo estimado: [Duración total estimada]
- Recursos necesarios: [Lista de recursos/herramientas]

🎯 PLAN DE EJECUCIÓN:
Paso 1: [Descripción clara y específica]
  - Acción: [Qué hacer exactamente]
  - Herramienta/Recurso: [Qué usar]
  - Criterio de éxito: [Cómo saber que está completo]
  - Tiempo estimado: [Duración]

Paso 2: [Siguiente paso...]
  [Misma estructura]

⚠️ CONSIDERACIONES:
- Dependencias entre pasos
- Puntos críticos o riesgos
- Alternativas si algo falla

✅ ENTREGABLES FINALES:
[Lista de lo que se debe entregar al final]

IMPORTANTE: Cada paso debe ser específico, medible y ejecutable por otro agente.`;

        const userPrompt = `Necesito un plan detallado para: "${task}"

CONTEXTO ADICIONAL:
${complexity ? `- Complejidad percibida: ${complexity}` : ''}
${deadline ? `- Fecha límite: ${deadline}` : ''}
${resources ? `- Recursos disponibles: ${resources}` : ''}

Por favor, crea un plan paso a paso que sea claro y ejecutable.`;

        try {
          const response = await this.llm.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]);

          return this.formatPlan(response.content, task);
        } catch (error) {
          console.error("❌ Error creando plan:", error);
          return this.createFallbackPlan(task);
        }
      },
      {
        name: "create_execution_plan",
        description: "Crea un plan detallado y estructurado para ejecutar una tarea compleja",
        schema: z.object({
          task: z.string().describe("La tarea compleja a planificar"),
          complexity: z.string().optional().describe("Nivel de complejidad esperado"),
          deadline: z.string().optional().describe("Fecha límite o tiempo disponible"),
          resources: z.string().optional().describe("Recursos y herramientas disponibles")
        })
      }
    );

    // Tool para validar y refinar planes
    this.validatePlanTool = tool(
      async ({ plan, criteria }) => {
        const validationPrompt = `Eres un REVISOR DE PLANES experto. Evalúa este plan:

${plan}

CRITERIOS DE EVALUACIÓN:
✓ Claridad: ¿Cada paso es claro y específico?
✓ Completitud: ¿Cubre todos los aspectos necesarios?
✓ Viabilidad: ¿Es realista y ejecutable?
✓ Orden lógico: ¿Los pasos siguen una secuencia lógica?
✓ Medible: ¿Se puede verificar el progreso?

${criteria ? `CRITERIOS ADICIONALES: ${criteria}` : ''}

Proporciona:
1. PUNTUACIÓN (1-10) para cada criterio
2. FORTALEZAS del plan
3. DEBILIDADES y áreas de mejora
4. RECOMENDACIONES específicas para optimizar el plan`;

        try {
          const response = await this.llm.invoke([
            { role: "user", content: validationPrompt }
          ]);

          return `🔍 VALIDACIÓN DEL PLAN\n${'='.repeat(50)}\n\n${response.content}`;
        } catch (error) {
          return "❌ Error validando el plan. Revisa manualmente la claridad y completitud.";
        }
      },
      {
        name: "validate_plan",
        description: "Valida y revisa la calidad de un plan de ejecución",
        schema: z.object({
          plan: z.string().describe("El plan a validar"),
          criteria: z.string().optional().describe("Criterios adicionales de validación")
        })
      }
    );
  }

  async createAgent() {
    const tools = [this.createPlanTool, this.validatePlanTool];
    
    this.agent = createAgent({
      model: this.llm,
      tools: tools,
    });

    console.log("🧠 Planner Agent inicializado con herramientas de planificación");
  }

  /**
   * Método principal para crear un plan
   */
  async planTask(task, options = {}) {
    try {
      console.log(`🧠 [PLANNER] Analizando tarea: ${task}`);
      
      const response = await this.agent.invoke({
        messages: [{ 
          role: "user", 
          content: `Necesito que planifiques esta tarea: ${task}${options.complexity ? `. Complejidad: ${options.complexity}` : ''}${options.deadline ? `. Deadline: ${options.deadline}` : ''}${options.resources ? `. Recursos: ${options.resources}` : ''}` 
        }],
      });

      const plan = response.messages[response.messages.length - 1].content;
      console.log("✅ [PLANNER] Plan creado exitosamente");
      
      return {
        success: true,
        plan: plan,
        metadata: {
          task: task,
          createdAt: new Date().toISOString(),
          estimatedSteps: this.extractStepCount(plan),
          complexity: options.complexity || 'No especificada'
        }
      };

    } catch (error) {
      console.error("❌ [PLANNER] Error:", error);
      return {
        success: false,
        error: error.message,
        fallbackPlan: this.createFallbackPlan(task)
      };
    }
  }

  /**
   * Validar un plan existente
   */
  async validatePlan(plan, criteria) {
    try {
      const response = await this.validatePlanTool.invoke({ plan, criteria });
      return response;
    } catch (error) {
      return "❌ Error en validación. Revisa el plan manualmente.";
    }
  }

  /**
   * Formatear el plan con estructura visual
   */
  formatPlan(planContent, originalTask) {
    const header = `
🧠 PLAN GENERADO POR PLANNER AGENT
${'='.repeat(60)}
📌 TAREA ORIGINAL: ${originalTask}
⏰ CREADO: ${new Date().toLocaleString()}
${'='.repeat(60)}

`;

    const footer = `
${'='.repeat(60)}
🤖 Generado por: Planner Agent (Patrón Planner → Executor)
📝 Siguiente paso: Enviar este plan al Executor Agent
`;

    return header + planContent + footer;
  }

  /**
   * Plan de respaldo en caso de error
   */
  createFallbackPlan(task) {
    return `🧠 PLAN DE RESPALDO
${'='.repeat(40)}

📋 TAREA: ${task}

🎯 PLAN BÁSICO:
Paso 1: Investigar y recopilar información sobre la tarea
  - Acción: Buscar recursos y documentación relevante
  - Tiempo: 30 minutos
  
Paso 2: Definir objetivos específicos y alcance
  - Acción: Aclarar qué se necesita exactamente
  - Tiempo: 15 minutos
  
Paso 3: Ejecutar la tarea principal
  - Acción: Realizar el trabajo principal paso a paso
  - Tiempo: Variable según complejidad
  
Paso 4: Revisar y validar resultados
  - Acción: Verificar que todo esté completo y correcto
  - Tiempo: 20 minutos

⚠️ NOTA: Este es un plan genérico. Considera personalizarlo según tus necesidades específicas.`;
  }

  /**
   * Extraer número de pasos del plan
   */
  extractStepCount(plan) {
    const stepMatches = plan.match(/Paso \d+:/g);
    return stepMatches ? stepMatches.length : 0;
  }
}

// Ejemplo de uso
export async function demonstratePlanner() {
  console.log("🧠 DEMOSTRACIÓN: PLANNER AGENT");
  console.log("=".repeat(50));
  
  const planner = new PlannerAgent();
  
  // Ejemplo 1: Tarea simple
  const result1 = await planner.planTask(
    "Crear una aplicación web para gestión de tareas",
    { 
      complexity: "Media",
      deadline: "2 semanas", 
      resources: "React, Node.js, MongoDB" 
    }
  );
  
  console.log(result1.plan || result1.fallbackPlan);
  
  // Ejemplo 2: Validar el plan
  if (result1.success) {
    console.log("\n🔍 VALIDANDO EL PLAN...\n");
    const validation = await planner.validatePlan(result1.plan);
    console.log(validation);
  }
}

// Ejecutar demostración si se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstratePlanner();
}