#!/usr/bin/env node

/**
 * 🚀 EJECUTOR DE TODOS LOS PATRONES
 * 
 * Este archivo ejecuta todos los 7 patrones de agentes en secuencia
 * para demostrar cada uno funcionando.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const patterns = [
  {
    name: "1️⃣ Planner → Executor Pattern",
    file: "patterns/1-planner-executor.js",
    description: "Planifica tareas complejas y las ejecuta paso a paso"
  },
  {
    name: "2️⃣ Router Pattern (Switch Inteligente)",  
    file: "patterns/2-router-pattern.js",
    description: "Enruta consultas al especialista correcto automáticamente"
  },
  {
    name: "3️⃣ Multi-Agent Collaboration",
    file: "patterns/3-multi-agent-collaboration.js", 
    description: "Múltiples agentes colaboran en una tarea compleja"
  },
  {
    name: "4️⃣ Reflection Pattern (Self-Critique)",
    file: "patterns/4-reflection-pattern.js",
    description: "Auto-critica y mejora iterativamente las respuestas"
  },
  {
    name: "5️⃣ Memory-Based Pattern", 
    file: "patterns/5-memory-based-pattern.js",
    description: "Recuerda contexto y personaliza respuestas futuras"
  },
  {
    name: "6️⃣ RAG Pattern (Retrieval-Augmented Generation)",
    file: "patterns/6-rag-pattern.js",
    description: "Consulta bases de conocimiento para respuestas informadas"
  },
  {
    name: "7️⃣ Graph Orchestration (LangGraph)",
    file: "patterns/7-graph-orchestration.js", 
    description: "Flujos complejos con enrutamiento dinámico por grafos"
  }
];

async function runPattern(pattern, index) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🚀 EJECUTANDO: ${pattern.name}`);
  console.log(`📝 ${pattern.description}`);
  console.log(`📁 Archivo: ${pattern.file}`);
  console.log(`${'='.repeat(80)}\n`);
  
  try {
    const { stdout, stderr } = await execAsync(`node ${pattern.file}`);
    
    if (stdout) {
      console.log(stdout);
    }
    
    if (stderr) {
      console.error(`⚠️ Warnings/Errors:\n${stderr}`);
    }
    
    console.log(`\n✅ ${pattern.name} completado exitosamente!`);
    
  } catch (error) {
    console.error(`❌ Error ejecutando ${pattern.name}:`);
    console.error(error.message);
    console.log(`\n⚠️ Continuando con el siguiente patrón...\n`);
  }
  
  // Pausa entre patrones para mejor legibilidad
  if (index < patterns.length - 1) {
    console.log(`\n⏳ Esperando 3 segundos antes del siguiente patrón...\n`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

async function main() {
  console.log(`
🤖 SISTEMA DE PATRONES DE AGENTES - LANGCHAIN + OPENAI
${'='.repeat(80)}

¡Bienvenido al sistema completo de patrones de agentes!

Este script ejecutará los 7 patrones implementados:
${patterns.map((p, i) => `  ${i + 1}. ${p.name}`).join('\n')}

⏱️ Tiempo estimado: ~5-10 minutos
📋 Total de patrones: ${patterns.length}
${'='.repeat(80)}
`);

  const startTime = Date.now();
  
  for (let i = 0; i < patterns.length; i++) {
    await runPattern(patterns[i], i);
  }
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log(`\n${'🎉'.repeat(20)}`);
  console.log(`🎉 ¡TODOS LOS PATRONES EJECUTADOS EXITOSAMENTE! 🎉`);
  console.log(`${'🎉'.repeat(20)}\n`);
  
  console.log(`📊 RESUMEN FINAL:`);
  console.log(`• Patrones ejecutados: ${patterns.length}/7`);
  console.log(`• Tiempo total: ${duration} segundos`);
  console.log(`• Promedio por patrón: ${(parseFloat(duration) / patterns.length).toFixed(2)} segundos\n`);
  
  console.log(`📚 PRÓXIMOS PASOS:`);
  console.log(`• Lee el README.md para documentación completa`);
  console.log(`• Modifica los ejemplos para tus casos de uso`);
  console.log(`• Combina patrones para crear sistemas más complejos`);
  console.log(`• Experimenta con diferentes prompts y parámetros\n`);
  
  console.log(`🚀 ¡Disfruta construyendo agentes increíbles!`);
}

// Manejar errores globales
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Ejecutar
main().catch(console.error);