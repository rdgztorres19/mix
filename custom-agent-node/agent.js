import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import { createAgent } from "langchain";
import { z } from "zod";
import os from "os";
import { execSync } from "child_process";
import dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();


/*
Internamente usa el patrón tool-calling loop.

El flujo real es:

User input
   ↓
LLM decide:
   - Responder directamente
   - Llamar a una tool
   ↓
Si llama tool:
   - Ejecuta tool
   - Recibe resultado
   - Lo analiza
   - Decide si necesita otra tool
   ↓
Repite hasta producir respuesta final

Eso significa que puede hacer:

Tool A

Tool B

Tool A otra vez

Tool C

Final answer

Sin que tú lo programes explícitamente.
*/

/**
 * ============================
 * 1️⃣ DEFINIMOS 2 TOOLS
 * ============================
 */

// Tool 1: sumar números
const sumTool = tool(
  async ({ a, b }) => {
    return `El resultado es ${a + b}`;
  },
  {
    name: "sum_numbers",
    description: "Suma dos números",
    schema: z.object({
      a: z.number().describe("Primer número"),
      b: z.number().describe("Segundo número"),
    }),
  }
);

// Tool 2: obtener hora actual
const timeTool = tool(
  async () => {
    return `La hora actual es ${new Date().toLocaleTimeString()}`;
  },
  {
    name: "get_current_time",
    description: "Devuelve la hora actual del sistema",
    schema: z.object({}),
  }
);

// Tool 3: obtener información del sistema (que el LLM no puede conocer)
const systemInfoTool = tool(
  async ({ infoType }) => {
    try {
      let result = "";
      
      switch (infoType) {
        case "hardware":
          const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
          const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
          const cpus = os.cpus();
          result = `💻 INFORMACIÓN DE HARDWARE:\n` +
                  `• CPU: ${cpus[0].model} (${cpus.length} núcleos)\n` +
                  `• Memoria Total: ${totalMem} GB\n` +
                  `• Memoria Libre: ${freeMem} GB\n` +
                  `• Sistema Operativo: ${os.type()} ${os.release()}\n` +
                  `• Plataforma: ${os.platform()} (${os.arch()})\n` +
                  `• Nombre del Host: ${os.hostname()}`;
          break;
          
        case "network":
          const interfaces = os.networkInterfaces();
          result = "🌐 INTERFACES DE RED:\n";
          for (const [name, nets] of Object.entries(interfaces)) {
            result += `• ${name}:\n`;
            nets?.forEach(net => {
              if (!net.internal) {
                result += `  - IP ${net.family}: ${net.address}\n`;
              }
            });
          }
          break;
          
        case "processes":
          try {
            const processes = execSync('ps aux | head -10', { encoding: 'utf8' });
            result = `⚙️ PROCESOS EN EJECUCIÓN (Top 10):\n${processes}`;
          } catch (error) {
            result = "❌ No se pudo obtener información de procesos";
          }
          break;
          
        case "disk":
          try {
            const diskInfo = execSync('df -h', { encoding: 'utf8' });
            result = `💾 USO DEL DISCO:\n${diskInfo}`;
          } catch (error) {
            result = "❌ No se pudo obtener información del disco";
          }
          break;
          
        case "load":
          const loadavg = os.loadavg();
          const uptime = Math.floor(os.uptime() / 3600);
          result = `📊 CARGA DEL SISTEMA:\n` +
                  `• Carga promedio: ${loadavg.map(l => l.toFixed(2)).join(", ")}\n` +
                  `• Tiempo activo: ${uptime} horas\n` +
                  `• Directorio actual: ${process.cwd()}\n` +
                  `• Versión Node.js: ${process.version}`;
          break;
          
        default:
          result = "❓ Tipo de información no válido. Usa: hardware, network, processes, disk, o load";
      }
      
      return result;
    } catch (error) {
      return `❌ Error obteniendo información del sistema: ${error.message}`;
    }
  },
  {
    name: "get_system_info",
    description: "Obtiene información en tiempo real del sistema local (hardware, red, procesos, disco, carga) que el LLM no puede conocer",
    schema: z.object({
      infoType: z.enum(["hardware", "network", "processes", "disk", "load"])
        .describe("Tipo de información del sistema: hardware, network, processes, disk, o load"),
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
  temperature: 0,
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * ============================
 * 3️⃣ CREAR AGENTE
 * ============================
 */

async function main() {
  const tools = [sumTool, timeTool, systemInfoTool];

  const agent = createAgent({
    model: llm,
    tools,
  });

  const response = await agent.invoke({
    messages: [{ role: "user", content: "¿Cuánto es 15 + 27? Dime la hora actual y también muéstrame información del hardware de mi sistema." }],
  });

  console.log("\n📌 RESPUESTA FINAL:");
  console.log(response.messages[response.messages.length - 1].content);
}

main();