import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";

/**
 * ⚡ EXECUTOR AGENT
 * ================
 * 
 * FUNCIÓN: Recibe un plan del Planner Agent y lo ejecuta paso a paso
 * PATRÓN: Planner → Executor
 * 
 * UNDER THE HOOD:
 * 1. Parsea el plan estructurado del Planner
 * 2. Ejecuta cada paso secuencialmente
 * 3. Verifica criterios de éxito de cada paso
 * 4. Reporta progreso y maneja errores
 * 5. Genera deliverables finales
 */

export class ExecutorAgent {
  constructor() {
    this.llm = new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.1, // Muy determinístico para ejecución precisa
      apiKey: process.env.OPENAI_API_KEY
    });

    this.executionState = {
      currentPlan: null,
      currentStep: 0,
      completedSteps: [],
      errors: [],
      startTime: null,
      logs: []
    };

    this.setupTools();
    this.createAgent();
  }

  setupTools() {
    // Tool para ejecutar un paso específico del plan
    this.executeStepTool = tool(
      async ({ stepDescription, stepNumber, expectedOutcome, tools }) => {
        const systemPrompt = `Eres un EXECUTOR EXPERTO que implementa pasos específicos de un plan.

Tu trabajo es:
1. Ejecutar exactamente lo que se describe en el paso
2. Usar las herramientas/recursos indicados
3. Verificar que el resultado cumple con el criterio de éxito
4. Documentar el proceso y resultado

IMPORTANTE: 
- Sé preciso y metódico
- Si algo no es claro, pide aclaración específica
- Si encuentras un problema, describe exactamente qué pasó
- Documenta todos los pasos intermedios`;

        const userPrompt = `Ejecuta este paso del plan:

📋 PASO ${stepNumber}: ${stepDescription}

🎯 RESULTADO ESPERADO: ${expectedOutcome || 'Cumplir con la descripción del paso'}

🛠️ HERRAMIENTAS DISPONIBLES: ${tools || 'Herramientas estándar de desarrollo'}

INSTRUCCIONES:
1. Analiza qué necesitas hacer exactamente
2. Ejecuta el paso de manera sistemática
3. Verifica que el resultado sea correcto
4. Proporciona un reporte detallado

Formato de respuesta:
✅ EJECUTADO: [Descripción de lo realizado]
📊 RESULTADO: [Resultado específico obtenido]
✓ VERIFICACIÓN: [Cómo verificaste que está correcto]
📝 NOTAS: [Observaciones importantes]`;

        try {
          const response = await this.llm.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]);

          return this.formatStepResult(stepNumber, response.content);
        } catch (error) {
          return this.handleStepError(stepNumber, error);
        }
      },
      {
        name: "execute_plan_step",
        description: "Ejecuta un paso específico del plan de manera detallada",
        schema: z.object({
          stepDescription: z.string().describe("Descripción completa del paso a ejecutar"),
          stepNumber: z.number().describe("Número del paso en el plan"),
          expectedOutcome: z.string().optional().describe("Resultado esperado del paso"),
          tools: z.string().optional().describe("Herramientas específicas a usar")
        })
      }
    );

    // Tool para verificar el progreso general
    this.checkProgressTool = tool(
      async ({ completedSteps, totalSteps, currentStep }) => {
        const percentage = Math.round((completedSteps / totalSteps) * 100);
        
        const progressReport = `
📊 REPORTE DE PROGRESO
${'='.repeat(40)}

📈 Progreso General: ${completedSteps}/${totalSteps} pasos (${percentage}%)
🎯 Paso Actual: ${currentStep}
⏱️ Tiempo Transcurrido: ${this.getElapsedTime()}

${'█'.repeat(Math.floor(percentage/5))}${'░'.repeat(20 - Math.floor(percentage/5))} ${percentage}%

${this.executionState.completedSteps.length > 0 ? '✅ PASOS COMPLETADOS:\n' + this.executionState.completedSteps.map(step => `  • Paso ${step.number}: ${step.summary}`).join('\n') : ''}

${this.executionState.errors.length > 0 ? '\n⚠️ PROBLEMAS ENCONTRADOS:\n' + this.executionState.errors.map(error => `  • ${error.step}: ${error.message}`).join('\n') : ''}

💡 ESTADO: ${percentage === 100 ? '🎉 ¡COMPLETADO!' : percentage > 80 ? '🚀 Casi terminado' : percentage > 50 ? '⚡ Progreso sólido' : percentage > 20 ? '🔄 En desarrollo' : '🚧 Iniciando'}
`;
        return progressReport;
      },
      {
        name: "check_progress",
        description: "Genera un reporte de progreso del plan en ejecución",
        schema: z.object({
          completedSteps: z.number().describe("Número de pasos completados"),
          totalSteps: z.number().describe("Número total de pasos"),
          currentStep: z.number().describe("Paso actual en ejecución")
        })
      }
    );

    // Tool para generar reporte final
    this.generateReportTool = tool(
      async ({ planSummary, results, issues, recommendations }) => {
        const reportPrompt = `Genera un REPORTE FINAL profesional de la ejecución del plan:

PLAN EJECUTADO: ${planSummary}
RESULTADOS OBTENIDOS: ${results}
PROBLEMAS ENCONTRADOS: ${issues || 'Ninguno'}
RECOMENDACIONES: ${recommendations || 'N/A'}

El reporte debe incluir:
1. Resumen ejecutivo
2. Objetivos cumplidos vs planificados  
3. Métricas de éxito
4. Lecciones aprendidas
5. Próximos pasos recomendados

Mantén un tono profesional pero accesible.`;

        try {
          const response = await this.llm.invoke([
            { role: "user", content: reportPrompt }
          ]);

          return this.formatFinalReport(response.content);
        } catch (error) {
          return this.generateBasicReport();
        }
      },
      {
        name: "generate_final_report",
        description: "Genera un reporte final completo de la ejecución",
        schema: z.object({
          planSummary: z.string().describe("Resumen del plan ejecutado"),
          results: z.string().describe("Resultados principales obtenidos"),
          issues: z.string().optional().describe("Problemas o desafíos encontrados"),
          recommendations: z.string().optional().describe("Recomendaciones para el futuro")
        })
      }
    );
  }

  async createAgent() {
    const tools = [this.executeStepTool, this.checkProgressTool, this.generateReportTool];
    
    this.agent = createAgent({
      model: this.llm,
      tools: tools,
    });

    console.log("⚡ Executor Agent inicializado con herramientas de ejecución");
  }

  /**
   * Método principal para ejecutar un plan completo
   */
  async executePlan(plan, options = {}) {
    try {
      console.log("⚡ [EXECUTOR] Iniciando ejecución del plan");
      
      this.initializeExecution(plan);
      const steps = this.parsePlanSteps(plan);
      
      console.log(`📋 [EXECUTOR] Plan parseado: ${steps.length} pasos identificados`);
      
      const results = [];
      
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        this.executionState.currentStep = i + 1;
        
        console.log(`⚡ [EXECUTOR] Ejecutando paso ${i + 1}/${steps.length}`);
        
        try {
          const stepResult = await this.executeStepTool.invoke({
            stepDescription: step.description,
            stepNumber: i + 1,
            expectedOutcome: step.expectedOutcome,
            tools: step.tools
          });
          
          results.push(stepResult);
          this.executionState.completedSteps.push({
            number: i + 1,
            description: step.description,
            result: stepResult,
            summary: this.extractSummary(stepResult)
          });

          // Mostrar progreso cada pocos pasos
          if ((i + 1) % 2 === 0 || i === steps.length - 1) {
            const progress = await this.checkProgressTool.invoke({
              completedSteps: i + 1,
              totalSteps: steps.length,
              currentStep: i + 1
            });
            console.log(progress);
          }

        } catch (error) {
          console.error(`❌ [EXECUTOR] Error en paso ${i + 1}:`, error);
          this.executionState.errors.push({
            step: i + 1,
            message: error.message,
            timestamp: new Date().toISOString()
          });
          
          if (!options.continueOnError) {
            throw error;
          }
        }
      }

      // Generar reporte final
      const finalReport = await this.generateFinalReport(plan, results);
      
      console.log("✅ [EXECUTOR] Plan ejecutado completamente");
      
      return {
        success: true,
        results: results,
        report: finalReport,
        executionStats: this.getExecutionStats(),
        completedSteps: this.executionState.completedSteps.length,
        totalSteps: steps.length
      };

    } catch (error) {
      console.error("❌ [EXECUTOR] Error durante ejecución:", error);
      return {
        success: false,
        error: error.message,
        partialResults: this.executionState.completedSteps,
        executionStats: this.getExecutionStats()
      };
    }
  }

  /**
   * Parsear pasos del plan
   */
  parsePlanSteps(plan) {
    const steps = [];
    const stepRegex = /Paso (\d+):\s*([^\n]+)\n([\s\S]*?)(?=Paso \d+:|$)/g;
    let match;

    while ((match = stepRegex.exec(plan)) !== null) {
      const stepNumber = parseInt(match[1]);
      const description = match[2].trim();
      const details = match[3].trim();
      
      // Extraer información adicional del detalle
      const toolMatch = details.match(/Herramienta\/Recurso:\s*([^\n]+)/);
      const outcomeMatch = details.match(/Criterio de éxito:\s*([^\n]+)/);
      
      steps.push({
        number: stepNumber,
        description: description,
        details: details,
        tools: toolMatch ? toolMatch[1].trim() : null,
        expectedOutcome: outcomeMatch ? outcomeMatch[1].trim() : null
      });
    }

    return steps.length > 0 ? steps : this.createFallbackSteps(plan);
  }

  /**
   * Inicializar estado de ejecución
   */
  initializeExecution(plan) {
    this.executionState = {
      currentPlan: plan,
      currentStep: 0,
      completedSteps: [],
      errors: [],
      startTime: new Date(),
      logs: []
    };
  }

  /**
   * Formatear resultado de paso
   */
  formatStepResult(stepNumber, content) {
    return `
⚡ RESULTADO DEL PASO ${stepNumber}
${'='.repeat(40)}
${content}
${'='.repeat(40)}
⏱️ Completado: ${new Date().toLocaleString()}
`;
  }

  /**
   * Manejar errores en pasos
   */
  handleStepError(stepNumber, error) {
    return `❌ ERROR EN PASO ${stepNumber}
${'='.repeat(40)}
Error: ${error.message}
Timestamp: ${new Date().toLocaleString()}

🔧 POSIBLES SOLUCIONES:
1. Verificar que los recursos necesarios estén disponibles
2. Revisar la descripción del paso por ambigüedades
3. Considerar enfoques alternativos
4. Contactar al Planner para aclaración

⚠️ ACCIÓN REQUERIDA: Revisa este paso antes de continuar.`;
  }

  /**
   * Generar reporte final
   */
  async generateFinalReport(plan, results) {
    const summary = this.extractPlanSummary(plan);
    const resultsSummary = results.join('\n\n');
    const issues = this.executionState.errors.length > 0 ? 
      this.executionState.errors.map(e => `Paso ${e.step}: ${e.message}`).join('; ') : null;
    
    return await this.generateReportTool.invoke({
      planSummary: summary,
      results: resultsSummary,
      issues: issues,
      recommendations: "Continuar con monitoreo y optimización según sea necesario"
    });
  }

  /**
   * Utilidades auxiliares
   */
  getElapsedTime() {
    if (!this.executionState.startTime) return "N/A";
    const elapsed = Date.now() - this.executionState.startTime.getTime();
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  extractSummary(stepResult) {
    const lines = stepResult.split('\n');
    for (const line of lines) {
      if (line.includes('EJECUTADO:') || line.includes('RESULTADO:')) {
        return line.substring(line.indexOf(':') + 1).trim().substring(0, 50) + '...';
      }
    }
    return "Completado";
  }

  extractPlanSummary(plan) {
    const lines = plan.split('\n');
    for (const line of lines) {
      if (line.includes('TAREA ORIGINAL:') || line.includes('TAREA:')) {
        return line.substring(line.indexOf(':') + 1).trim();
      }
    }
    return "Plan ejecutado";
  }

  getExecutionStats() {
    return {
      startTime: this.executionState.startTime,
      endTime: new Date(),
      duration: this.getElapsedTime(),
      totalSteps: this.executionState.completedSteps.length,
      errors: this.executionState.errors.length,
      successRate: this.executionState.completedSteps.length > 0 ? 
        ((this.executionState.completedSteps.length - this.executionState.errors.length) / this.executionState.completedSteps.length * 100).toFixed(2) + '%' : '0%'
    };
  }

  createFallbackSteps(plan) {
    return [
      {
        number: 1,
        description: "Analizar el plan proporcionado",
        details: "Revisar y entender todos los componentes del plan",
        tools: "Análisis manual",
        expectedOutcome: "Comprensión completa del plan"
      },
      {
        number: 2,
        description: "Ejecutar componentes principales del plan",
        details: "Implementar los elementos centrales identificados",
        tools: "Herramientas apropiadas según contexto",
        expectedOutcome: "Componentes principales implementados"
      }
    ];
  }

  formatFinalReport(content) {
    return `
⚡ REPORTE FINAL DE EJECUCIÓN
${'='.repeat(60)}
${content}
${'='.repeat(60)}
🤖 Generado por: Executor Agent (Patrón Planner → Executor)
📊 Estadísticas: ${JSON.stringify(this.getExecutionStats(), null, 2)}
`;
  }

  generateBasicReport() {
    return `
⚡ REPORTE FINAL BÁSICO
${'='.repeat(40)}

✅ RESUMEN: Plan ejecutado con ${this.executionState.completedSteps.length} pasos completados
⏱️ DURACIÓN: ${this.getElapsedTime()}
📊 ERRORES: ${this.executionState.errors.length}

🎯 ESTADO FINAL: ${this.executionState.errors.length === 0 ? 'EXITOSO' : 'COMPLETADO CON OBSERVACIONES'}
`;
  }
}

// Ejemplo de uso completo del patrón
export async function demonstratePlannerExecutor() {
  console.log("🔄 DEMOSTRACIÓN: PATRÓN PLANNER → EXECUTOR");
  console.log("=".repeat(60));
  
  // Importar Planner
  const { PlannerAgent } = await import('./planner.js');
  
  const planner = new PlannerAgent();
  const executor = new ExecutorAgent();
  
  // Fase 1: Planner crea el plan
  console.log("🧠 FASE 1: PLANIFICACIÓN\n");
  const planResult = await planner.planTask(
    "Implementar sistema de autenticación para aplicación web",
    {
      complexity: "Media",
      deadline: "1 semana",
      resources: "JWT, bcrypt, Express.js, MongoDB"
    }
  );
  
  if (planResult.success) {
    console.log(planResult.plan);
    
    // Fase 2: Executor ejecuta el plan
    console.log("\n⚡ FASE 2: EJECUCIÓN\n");
    const executionResult = await executor.executePlan(planResult.plan, {
      continueOnError: true
    });
    
    console.log(executionResult.report || executionResult.error);
  }
}

// Ejecutar demostración si se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstratePlannerExecutor();
}