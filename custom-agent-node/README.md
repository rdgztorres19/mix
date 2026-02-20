# 🤖 Patrones de Agentes con LangChain + OpenAI

Una implementación educativa de los **7 patrones más importantes** para crear agentes inteligentes usando LangChain y OpenAI.

## 📚 Tabla de Contenido

- [🎯 ¿Qué son los Patrones de Agentes?](#-qué-son-los-patrones-de-agentes)
- [🛠️ Instalación y Configuración](#️-instalación-y-configuración)
- [📋 Patrones Implementados](#-patrones-implementados)
  - [1️⃣ Planner → Executor Pattern](#1️⃣-planner--executor-pattern)
  - [2️⃣ Router Pattern](#2️⃣-router-pattern-switch-inteligente)
  - [3️⃣ Multi-Agent Collaboration](#3️⃣-multi-agent-collaboration)
  - [4️⃣ Reflection Pattern](#4️⃣-reflection-pattern-self-critique)
  - [5️⃣ Memory-Based Pattern](#5️⃣-memory-based-pattern)
  - [6️⃣ RAG Pattern](#6️⃣-rag-pattern-retrieval-augmented-generation)
  - [7️⃣ Graph Orchestration](#7️⃣-graph-orchestration-langgraph)
- [🔍 Cómo Funcionan "Under the Hood"](#-cómo-funcionan-under-the-hood)
- [🚀 Ejecutar los Ejemplos](#-ejecutar-los-ejemplos)
- [📖 Casos de Uso](#-casos-de-uso)
- [🤝 Contribuir](#-contribuir)

---

## 🎯 ¿Qué son los Patrones de Agentes?

Los **patrones de agentes** son arquitecturas probadas para crear sistemas de IA que pueden:

- 🧠 **Pensar** antes de actuar (planificación)
- 🔄 **Colaborar** entre múltiples especialistas
- 🪞 **Auto-mejorarse** mediante reflexión
- 🧠 **Recordar** contexto de conversaciones
- 📚 **Consultar** bases de conocimiento
- 🕸️ **Ejecutar** flujos complejos y adaptativos

Cada patrón resuelve un problema específico y puede combinarse con otros para crear sistemas más sofisticados.

---

## 🛠️ Instalación y Configuración

### Requisitos
- Node.js 18+ 
- Una API key de OpenAI

### 1. Instalar dependencias
\`\`\`bash
cd custom-agent
npm install
\`\`\`

### 2. Configurar OpenAI API Key

Opción 1: Variable de entorno
\`\`\`bash
export OPENAI_API_KEY="tu-api-key-aqui"
\`\`\`

Opción 2: Editar directamente en los archivos
Los archivos ya incluyen la API key hardcodeada para facilitar las pruebas.

### 3. Ejecutar un patrón
\`\`\`bash
node patterns/1-planner-executor.js
\`\`\`

---

## 📋 Patrones Implementados

### 1️⃣ Planner → Executor Pattern

**🎯 Problema**: Tareas complejas que necesitan descomponerse en pasos.

**💡 Solución**: Un agente planifica, otro ejecuta paso a paso.

**🔀 Flujo**:
\`\`\`
Usuario: "Crear app web de tareas"
     ↓
🧠 PLANNER: Divide en pasos
  1. Setup inicial
  2. Backend API  
  3. Frontend UI
  4. Testing
     ↓
⚡ EXECUTOR: Ejecuta cada paso
  ✅ Paso 1 completado
  ✅ Paso 2 completado
  ✅ Paso 3 completado
  ✅ Paso 4 completado
\`\`\`

**📁 Archivo**: [`patterns/1-planner-executor.js`](patterns/1-planner-executor.js)

**🚀 Casos de uso**:
- Automatización de proyectos
- Workflows de desarrollo
- Procesos empresariales complejos

---

### 2️⃣ Router Pattern (Switch Inteligente)

**🎯 Problema**: Diferentes tipos de consultas necesitan especialistas diferentes.

**💡 Solución**: Un router inteligente que decide qué especialista usar.

**🔀 Flujo**:
\`\`\`
Usuario: "¿Cuánto es 5+3?"
     ↓
🚦 ROUTER: Analiza tipo de consulta
     ↓
"Es matemáticas" → 🧮 Especialista Matemático
     ↓
Resultado: "5+3 = 8"

Usuario: "¿Qué hora es?"  
     ↓
🚦 ROUTER: Analiza consulta
     ↓  
"Es tiempo" → ⏰ Especialista Tiempo
     ↓
Resultado: "Son las 14:30"
\`\`\`

**📁 Archivo**: [`patterns/2-router-pattern.js`](patterns/2-router-pattern.js)

**🚀 Casos de uso**:
- Chatbots multidominio
- Sistemas de soporte técnico
- Asistentes virtuales generales

---

### 3️⃣ Multi-Agent Collaboration

**🎯 Problema**: Tareas que requieren múltiples tipos de expertise.

**💡 Solución**: Varios agentes especializados colaboran secuencialmente.

**🔀 Flujo**:
\`\`\`
Usuario: "Escribe email profesional"
     ↓
🎯 COORDINADOR: Planifica colaboración
     ↓
📝 ESCRITOR: Crea borrador
     ↓
✏️ EDITOR: Revisa y mejora  
     ↓
🎨 FORMATEADOR: Da formato final
     ↓
📧 Email profesional listo
\`\`\`

**📁 Archivo**: [`patterns/3-multi-agent-collaboration.js`](patterns/3-multi-agent-collaboration.js)

**🚀 Casos de uso**:
- Creación de contenido
- Procesos de revisión
- Pipelines de producción

---

### 4️⃣ Reflection Pattern (Self-Critique)

**🎯 Problema**: Las respuestas iniciales pueden no ser de la mejor calidad.

**💡 Solución**: El agente se auto-critica y mejora iterativamente.

**🔀 Flujo**:
\`\`\`
Usuario: "Explica la IA"
     ↓
📝 GENERADOR: Crea respuesta inicial
     ↓
🪞 CRÍTICO: "Muy básico, falta profundidad"
     ↓  
🔧 MEJORADOR: Crea versión mejorada
     ↓
🪞 CRÍTICO: "Mejor, pero falta ejemplos"
     ↓
🔧 MEJORADOR: Agrega ejemplos
     ↓
✅ EVALUADOR: "Listo para entrega"
\`\`\`

**📁 Archivo**: [`patterns/4-reflection-pattern.js`](patterns/4-reflection-pattern.js)

**🚀 Casos de uso**:
- Generación de contenido de alta calidad
- Escritura académica/profesional  
- Análisis crítico automatizado

---

### 5️⃣ Memory-Based Pattern

**🎯 Problema**: Los agentes no recuerdan conversaciones previas.

**💡 Solución**: Memoria persistente que almacena y recupera contexto.

**🔀 Flujo**:
\`\`\`
Conversación 1:
Usuario: "Soy María, diseñadora, me gusta el café"
Agente: [💾 Guarda en memoria] "¡Hola María!"

Conversación 2:  
Usuario: "Recomiéndame lugares para trabajar"
Agente: [🔍 Busca memoria: "María, diseñadora, café"]
        "¡Hola María! Como diseñadora que ama el café..."
\`\`\`

**📁 Archivo**: [`patterns/5-memory-based-pattern.js`](patterns/5-memory-based-pattern.js)

**🚀 Casos de uso**:
- Asistentes personales
- Customer service personalizado
- Tutores educativos adaptativos

---

### 6️⃣ RAG Pattern (Retrieval-Augmented Generation)

**🎯 Problema**: El agente necesita información específica de documentos/bases de datos.

**💡 Solución**: Busca información relevante y la usa para generar respuestas informadas.

**🔀 Flujo**:
\`\`\`
Usuario: "¿Cómo funcionan los JWT?"
     ↓
🔍 RETRIEVER: Busca en base de conocimiento
     "Encontrado: documento JWT-001"
     ↓
🔄 AUGMENTOR: Combina pregunta + documento  
     ↓
🤖 GENERATOR: "Basándome en la documentación..."
\`\`\`

**📁 Archivo**: [`patterns/6-rag-pattern.js`](patterns/6-rag-pattern.js)

**🚀 Casos de uso**:
- Chatbots de documentación  
- Q&A sobre bases de conocimiento
- Asistentes especializados por dominio

---

### 7️⃣ Graph Orchestration (LangGraph)

**🎯 Problema**: Flujos complejos con múltiples rutas condicionales.

**💡 Solución**: Grafo de nodos especializados con enrutamiento dinámico.

**🔀 Flujo**:
\`\`\`
Usuario: "Analiza este código JavaScript"
     ↓
🎯 CLASIFICADOR: "Es código" 
     ↓
💻 ANALIZADOR DE CÓDIGO: Análisis técnico
     ↓  
🎯 SINTETIZADOR: Resultado final

VS.

Usuario: "Analiza estos datos: 1,2,3,4,5"
     ↓
🎯 CLASIFICADOR: "Son datos"
     ↓
📊 ANALIZADOR DE DATOS: Análisis estadístico  
     ↓
🎯 SINTETIZADOR: Resultado final
\`\`\`

**📁 Archivo**: [`patterns/7-graph-orchestration.js`](patterns/7-graph-orchestration.js)

**🚀 Casos de uso**:
- Pipelines de procesamiento adaptativos
- Workflows empresariales complejos
- Sistemas de análisis especializados

---

## 🔍 Cómo Funcionan "Under the Hood"

Todos los patrones están construidos sobre el **Tool-Calling Loop** de LangChain:

### 🔄 Tool-Calling Loop Básico
\`\`\`
1. Usuario envía mensaje
2. LLM decide si necesita herramientas
3. Si SÍ: Llama herramienta → Recibe resultado → Analiza
4. Repite hasta tener respuesta completa
5. Envía respuesta final al usuario
\`\`\`

### 🛠️ Implementación Técnica

Cada patrón usa:

1. **Tools**: Funciones especializadas que el LLM puede llamar
\`\`\`javascript
const plannerTool = tool(
  async ({ task }) => {
    return "Plan: 1) Paso 1 2) Paso 2 ...";
  },
  {
    name: "create_plan",
    description: "Crea un plan para una tarea",
    schema: z.object({
      task: z.string().describe("Tarea a planificar")
    })
  }
);
\`\`\`

2. **Agent**: Coordinador que decide qué tools usar
\`\`\`javascript
const agent = createAgent({
  model: llm,
  tools: [plannerTool, executorTool],
});
\`\`\`

3. **Invocation**: Ejecución del flujo completo
\`\`\`javascript
const response = await agent.invoke({
  messages: [{ role: "user", content: "Planifica crear una app" }],
});
\`\`\`

### 🧠 ¿Por qué funciona tan bien?

- **Modularidad**: Cada tool hace una cosa específica
- **Composabilidad**: Los tools se pueden combinar
- **Adaptabilidad**: El LLM decide dinámicamente qué usar
- **Escalabilidad**: Fácil agregar nuevos tools/capacidades

---

## 🚀 Ejecutar los Ejemplos

### Ejecución Individual
\`\`\`bash
# Planner-Executor
node patterns/1-planner-executor.js

# Router Pattern  
node patterns/2-router-pattern.js

# Multi-Agent Collaboration
node patterns/3-multi-agent-collaboration.js

# Reflection Pattern
node patterns/4-reflection-pattern.js

# Memory-Based Pattern
node patterns/5-memory-based-pattern.js

# RAG Pattern
node patterns/6-rag-pattern.js

# Graph Orchestration
node patterns/7-graph-orchestration.js
\`\`\`

### Ejecutar Todos
\`\`\`bash
# Crear script para ejecutar todos
for file in patterns/*.js; do
  echo "🚀 Ejecutando $file"
  node "$file"
  echo "✅ Completado\n"
done
\`\`\`

### Modificar para tus Casos de Uso

1. **Cambiar API Key**: Edita la línea de \`apiKey\` en cada archivo
2. **Personalizar Prompts**: Modifica las instrucciones de sistema
3. **Agregar Tools**: Crea nuevas herramientas específicas
4. **Combinar Patrones**: Usa múltiples patrones en un solo sistema

---

## 📖 Casos de Uso

### 🏢 **Empresariales**
- **Automatización de procesos** (Planner-Executor)
- **Customer Service inteligente** (Router + Memory)
- **Generación de reportes** (Multi-Agent + Reflection)
- **Gestión de conocimiento** (RAG)

### 🎓 **Educativos**  
- **Tutores personalizados** (Memory + Reflection)
- **Sistemas de evaluación** (Multi-Agent)
- **Chatbots de documentación** (RAG + Router)

### 💻 **Técnicos**
- **Code review automatizado** (Graph Orchestration)
- **Análisis de datos** (Router + RAG)
- **Generación de documentación** (Planner-Executor + Reflection)

### 🎨 **Creativos**
- **Escritura colaborativa** (Multi-Agent)
- **Generación de contenido** (Reflection + Memory)
- **Asistentes creativos** (Graph Orchestration)

---

## 🔮 Próximos Pasos

### 🔧 **Mejoras Técnicas**
- [ ] Implementar persistencia real (Redis/MongoDB)
- [ ] Agregar vectorización para RAG mejorado
- [ ] Implementar métricas y monitoreo
- [ ] Crear interfaz web interactiva

### 🧠 **Nuevos Patrones**
- [ ] **Chain-of-Thought Pattern**
- [ ] **Tree-of-Thoughts Pattern** 
- [ ] **Constitutional AI Pattern**
- [ ] **Self-Consistency Pattern**

### 📚 **Recursos Adicionales**
- [ ] Tutorial paso a paso para cada patrón
- [ ] Ejemplos con casos de uso reales
- [ ] Comparación de performance entre patrones
- [ ] Guía de combinación de patrones

---

## 🤝 Contribuir

¿Quieres mejorar estos patrones o agregar nuevos?

1. Fork el proyecto
2. Crea una rama para tu feature (\`git checkout -b feature/nuevo-patron\`)
3. Commit tus cambios (\`git commit -am 'Agregar nuevo patrón'\`)
4. Push a la rama (\`git push origin feature/nuevo-patron\`)
5. Crea un Pull Request

---

## 📚 Referencias y Inspiración

- **[LangChain Documentation](https://js.langchain.com/docs/)**
- **[OpenAI API Reference](https://platform.openai.com/docs/api-reference)**
- **[LangGraph](https://langchain-ai.github.io/langgraph/)**
- **[Anthropic Constitutional AI](https://www.anthropic.com/news/constitutional-ai-harmlessness-from-ai-feedback)**
- **[Microsoft Agent Patterns](https://github.com/microsoft/semantic-kernel)**

---

## ⚖️ Licencia

MIT License - Siéntete libre de usar, modificar y distribuir este código para aprender y crear sistemas increíbles.

---

## 🙋‍♂️ Soporte

¿Preguntas? ¿Ideas? ¿Problemas?

- 🐛 **Issues**: Para reportar bugs o sugerir mejoras
- 💡 **Discussions**: Para preguntas y compartir ideas
- 📧 **Email**: Para consultas específicas

---

**¡Esperamos que estos patrones te inspiren a crear agentes increíbles! 🚀🤖**