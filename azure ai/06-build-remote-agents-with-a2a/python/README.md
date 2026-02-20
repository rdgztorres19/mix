# 🤖 Sistema A2A (Agent-to-Agent) - Agentes Distribuidos con Azure AI Foundry

Un sistema completo de agentes distribuidos que pueden comunicarse entre sí usando el protocolo A2A (Agent-to-Agent), alimentado por **Azure AI Foundry** y construido con **FastAPI**.

## 📚 Tabla de Contenido

- [🎯 ¿Qué es A2A?](#-qué-es-a2a)
- [🏗️ Arquitectura del Sistema](#️-arquitectura-del-sistema)
- [📁 Estructura de Archivos](#-estructura-de-archivos)
- [🔧 Configuración e Instalación](#-configuración-e-instalación)
- [🚀 Cómo Ejecutar el Proyecto](#-cómo-ejecutar-el-proyecto)
- [🔄 Comunicación Entre Agentes](#-comunicación-entre-agentes)
- [🧠 Agentes Implementados](#-agentes-implementados)
- [🔍 Clases y Componentes](#-clases-y-componentes)
- [📊 Flujo de Comunicación](#-flujo-de-comunicación)
- [🛠️ Desarrollo y Extensión](#️-desarrollo-y-extensión)

---

## 🎯 ¿Qué es A2A?

**A2A (Agent-to-Agent)** es un protocolo y framework que permite que múltiples agentes de IA se comuniquen entre sí de manera distribuida. Cada agente es un microservicio independiente con capacidades especializadas que puede recibir tareas de otros agentes y enviar resultados.

### 🌟 Características Clave

- **📡 Comunicación Distribuida**: Agentes en diferentes servidores/puertos
- **🔄 Protocolo Estándar**: API REST consistente para todos los agentes
- **🎯 Especialización**: Cada agente tiene habilidades específicas
- **🔗 Orquestación**: Un agente coordinador (routing) maneja las solicitudes
- **⚡ Asíncrono**: Operaciones no bloqueantes
- **🛡️ Tolerancia a Fallos**: Manejo de errores y reconexión

---

## 🏗️ Arquitectura del Sistema

```
🌍 Usuario
    ↓
🚦 Routing Agent (Puerto 3000)
    ↓
┌─────────────────┬─────────────────┐
│                 │                 │
📝 Title Agent    📋 Outline Agent
  (Puerto 3001)     (Puerto 3002)
```

### 🔄 Flujo de Trabajo

1. **Usuario** envía solicitud al **Routing Agent**
2. **Routing Agent** analiza la solicitud y decide qué agente especializado usar
3. **Routing Agent** envía la tarea al agente especializado vía HTTP
4. **Agente Especializado** procesa la tarea usando Azure AI Foundry
5. **Agente Especializado** devuelve el resultado al Routing Agent
6. **Routing Agent** devuelve la respuesta final al usuario

---

## 📁 **ESTRUCTURA DE ARCHIVOS TÉCNICA**

```
python/
├── 📄 requirements.txt          # Dependencias: fastapi, azure-ai-agents, httpx, etc.
├── 📄 env.example              # Variables: PROJECT_ENDPOINT, MODEL_DEPLOYMENT_NAME, puertos
├── 📄 client.py                # Cliente CLI para testing - envía requests HTTP al routing
├── 📄 run_all.py               # Orquestador: inicia todos los servers concurrentemente
├── 
├── 🚦 routing_agent/           # COORDINADOR PRINCIPAL
│   ├── 📄 agent.py             # RoutingAgent class - lógica de descubrimiento y delegación
│   │                           # • _async_init_components(): descubre agentes vía HTTP GET /agent-card
│   │                           # • send_message(): envía tareas a agentes remotos via A2A
│   │                           # • create_agent(): crea Azure AI Agent con send_message como tool
│   │                           # • process_user_message(): maneja tool calling loop de Azure AI
│   └── 📄 server.py            # FastAPI server (puerto 3000) - expone endpoint POST /message
├── 
├── 📝 title_agent/             # ESPECIALISTA EN TÍTULOS 
│   ├── 📄 agent.py             # TitleAgent class - wrapper de Azure AI Foundry
│   │                           # • create_agent(): crea agente con instrucciones de title generation
│   │                           # • run_conversation(): ejecuta conversación con Azure AI
│   ├── 📄 agent_executor.py    # TitleAgentExecutor class - implementa protocolo A2A
│   │                           # • execute(): procesa MessageSendParams y retorna Task
│   │                           # • _process_request(): convierte A2A request a Azure AI call
│   └── 📄 server.py            # Starlette server (puerto 3001) - expone A2AStarletteApplication
│                               # • GET /agent-card: devuelve capacidades y skills
│                               # • POST /message: recibe tareas A2A y ejecuta con agent_executor
├── 
└── 📋 outline_agent/           # ESPECIALISTA EN OUTLINES
    ├── 📄 agent.py             # OutlineAgent class - similar a TitleAgent pero para outlines
    ├── 📄 agent_executor.py    # OutlineAgentExecutor class - implementa protocolo A2A
    │                           # • Mismo patrón que TitleAgentExecutor pero para outline tasks
    └── 📄 server.py            # Starlette server (puerto 3002) - A2AStarletteApplication
                                # • Expone mismos endpoints A2A que title_agent
```

### 🔍 **EXPLICACIÓN DE CADA COMPONENTE**

#### 📄 **agent.py** (TitleAgent/OutlineAgent)
- **Propósito**: Wrapper de Azure AI Foundry para especialización
- **Responsabilidad**: Crear agente Azure AI con instrucciones específicas
- **Métodos clave**: `create_agent()`, `run_conversation()`

#### 📄 **agent_executor.py** 
- **Propósito**: Implementa protocolo A2A para recibir tareas remotas
- **Responsabilidad**: Convierte `MessageSendParams` → Azure AI call → `Task` response
- **Interface**: Implementa `AgentExecutor` del framework A2A
- **Métodos**: `execute()`, `cancel()`, `_process_request()`

#### 📄 **server.py** 
- **Propósito**: Servidor HTTP que expone el agente via protocolo A2A
- **Framework**: Starlette + A2AStarletteApplication
- **Endpoints**:
  - `GET /agent-card` → retorna `AgentCard` con skills y capacidades
  - `POST /message` → recibe `MessageSendParams`, ejecuta con `agent_executor`
  - `GET /health` → health check

---

## 🔧 Configuración e Instalación

### 1. Prerrequisitos

- **Python 3.8+**
- **Azure AI Foundry** proyecto configurado
- **Azure CLI** instalado y autenticado

### 2. Instalar Dependencias

```bash
pip install -r requirements.txt
```

### 3. Configurar Variables de Entorno

Copia y configura el archivo de entorno:

```bash
cp env.example .env
```

Edita `.env` con tus configuraciones:

```bash
# Azure AI Foundry
PROJECT_ENDPOINT=https://tu-proyecto.cognitiveservices.azure.com/
MODEL_DEPLOYMENT_NAME=tu-modelo-deployment

# Configuración del servidor
SERVER_URL=127.0.0.1
TITLE_AGENT_PORT=3001
OUTLINE_AGENT_PORT=3002
ROUTING_AGENT_PORT=3000
```

### 4. Autenticación con Azure

```bash
# Opción 1: Usando Azure CLI
az login

# Opción 2: Variables de entorno (Service Principal)
export AZURE_CLIENT_ID="tu-client-id"
export AZURE_CLIENT_SECRET="tu-client-secret"  
export AZURE_TENANT_ID="tu-tenant-id"
```

---

## 🚀 Cómo Ejecutar el Proyecto

### Opción A: Ejecutar Todo Automáticamente

```bash
python run_all.py
```

Este script:
1. 🚀 Inicia todos los servidores de agentes
2. ⏳ Espera que estén listos
3. 🖥️ Abre el cliente interactivo

### Opción B: Ejecutar Manualmente

Terminal 1 - Title Agent:
```bash
python -m uvicorn title_agent.server:app --host 127.0.0.1 --port 3001
```

Terminal 2 - Outline Agent:
```bash
python -m uvicorn outline_agent.server:app --host 127.0.0.1 --port 3002
```

Terminal 3 - Routing Agent:
```bash
python -m uvicorn routing_agent.server:app --host 127.0.0.1 --port 3000
```

Terminal 4 - Cliente:
```bash
python client.py
```

### Verificar Estado

```bash
# Verificar que todos los agentes estén funcionando
curl http://127.0.0.1:3001/health  # Title Agent
curl http://127.0.0.1:3002/health  # Outline Agent  
curl http://127.0.0.1:3000/health  # Routing Agent
```

---

## 🔄 **FLUJO TÉCNICO COMPLETO A2A**

### 📡 **1. PROCESO DE DESCUBRIMIENTO DE AGENTES**

#### **Al inicializar el Routing Agent:**

```python
# routing_agent/server.py - Al arrancar el servidor
routing_agent = await RoutingAgent.create([
    "http://127.0.0.1:3001",  # Title Agent URL
    "http://127.0.0.1:3002",  # Outline Agent URL  
])
```

#### **Descubrimiento HTTP automático:**

```python
# routing_agent/agent.py - _async_init_components()
async with httpx.AsyncClient(timeout=30) as client:
    for address in remote_agent_addresses:
        # 🔍 HTTP GET: {address}/agent-card
        card_resolver = A2ACardResolver(client, address)
        card = await card_resolver.get_agent_card()  # ← HTTP call!
        
        # 💾 Almacena capacidades del agente
        self.remote_agent_connections[card.name] = RemoteAgentConnections(card, address)
        self.cards[card.name] = card
```

**Lo que devuelve `/agent-card`:**
```json
{
  "name": "AI Foundry Title Agent",
  "description": "An intelligent title generator agent...",
  "url": "http://127.0.0.1:3001/",
  "skills": [
    {
      "id": "generate_title",
      "name": "Generate Title",
      "description": "Generates compelling titles",
      "examples": ["Can you generate a title for this article?"]
    }
  ]
}
```

### 🧠 **2. CREACIÓN DEL AGENTE AZURE CON HERRAMIENTAS**

```python
# routing_agent/agent.py - create_agent()
functions = FunctionTool({self.send_message})  # ← Registra send_message como tool

self.azure_agent = self.agents_client.create_agent(
    model=os.environ["MODEL_DEPLOYMENT_NAME"],
    instructions=f"""
    You are a Routing Delegator.
    Available Agents: {self.list_remote_agents()}  # ← Ve las capacidades!
    Route requests to appropriate agents using send_message tool.
    """,
    tools=functions.definitions  # ← send_message disponible como herramienta
)
```

### 🎯 **3. PROCESO DE DECISIÓN - ¿Cómo sabe el LLM a quién delegar?**

```python
# Cuando llega mensaje del usuario
async def process_user_message(self, user_message: str):
    # 1. Envía mensaje a Azure AI
    self.agents_client.messages.create(
        thread_id=self.current_thread.id,
        content=user_message  # "Generate a title for my AI article"
    )
    
    # 2. Azure AI ejecuta y DECIDE usar herramientas
    run = self.agents_client.runs.create(...)
    
    # 3. Azure AI retorna: requires_action con tool_call
    if run.status == "requires_action":
        tool_calls = run.required_action.submit_tool_outputs.tool_calls
        # tool_call.function.name = "send_message"  
        # tool_call.function.arguments = {"agent_name": "AI Foundry Title Agent", "task": "..."}
```

**🧠 Azure AI analiza:**
- Ve instrucciones: "Available Agents: [AI Foundry Title Agent: title generator...]"
- Ve mensaje: "Generate a title for my AI article" 
- **DECIDE**: "Usar send_message con agent_name='AI Foundry Title Agent'"

### 📨 **4. COMUNICACIÓN HTTP ENTRE AGENTES**

```python
# routing_agent/agent.py - send_message()
async def send_message(self, agent_name: str, task: str):
    # 1. Obtiene conexión HTTP del agente
    remote_connection = self.remote_agent_connections[agent_name]
    client = remote_connection.agent_client  # A2AClient
    
    # 2. Construye payload A2A
    message_params = MessageSendParams(
        id=str(uuid.uuid4()),
        task_context_id=str(uuid.uuid4()),
        text=task  # "Generate a title for my AI article"
    )
    
    # 3. HTTP POST /message al agente especializado
    request_payload = SendMessageRequest(message=message_params)
    send_response = await client.send_message(request_payload)  # ← HTTP POST!
    
    return send_response.root.result
```

### 🔗 **5. PROTOCOLO HTTP A2A**

#### **POST /message** (Envío de tarea)
```http
POST http://127.0.0.1:3001/message
Content-Type: application/json

{
  "message": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "task_context_id": "550e8400-e29b-41d4-a716-446655440001",
    "text": "Generate a title for my AI article about machine learning in healthcare"
  }
}
```

#### **Respuesta del Agente**
```json
{
  "result": {
    "id": "task-550e8400-e29b-41d4-a716-446655440000",
    "state": "completed",
    "messages": [
      {
        "text": "AI Médica: Cómo el Machine Learning Revoluciona la Salud",
        "context_id": "550e8400-e29b-41d4-a716-446655440001"
      }
    ]
  }
}
```

### 🔧 **COMPONENTES TÉCNICOS**

#### **A2AClient** 
- Maneja comunicación HTTP con agentes remotos
- Envía requests POST /message 
- Deserializa responses JSON

#### **A2ACardResolver**
- Hace HTTP GET /agent-card para descubrimiento
- Parse de capacidades y skills de agentes

#### **RemoteAgentConnections**
- Mantiene conexión HTTP persistente (httpx.AsyncClient)
- Cache de AgentCard con capacidades
- Wrapper para envío de mensajes A2A

---

## 🧠 Agentes Implementados

### 🚦 **Routing Agent** (Puerto 3000)

**Función**: Coordinador principal que recibe solicitudes del usuario y las delega a agentes especializados.

**Capacidades**:
- 🧠 Análisis inteligente de solicitudes del usuario
- 🎯 Selección del agente apropiado
- 📡 Comunicación con agentes remotos
- 🔄 Orquestación de workflows complejos

**Ejemplo de uso**:
```
Usuario: "Necesito un título para un artículo sobre IA"
Routing: Analiza → Delega a Title Agent → Devuelve resultado
```

### 📝 **Title Agent** (Puerto 3001)

**Función**: Especialista en generar títulos llamativos y optimizados para SEO.

**Capacidades**:
- ✨ Generación de títulos creativos
- 📊 Optimización para SEO (< 60 caracteres)
- 🎯 Títulos específicos por contexto/audiencia
- 📝 Múltiples opciones de título

**Ejemplo de uso**:
```
Input: "Artículo sobre beneficios del machine learning en salud"
Output: "IA Médica: Cómo el Machine Learning Revoluciona la Salud"
```

### 📋 **Outline Agent** (Puerto 3002)

**Función**: Especialista en crear estructuras y outlines para contenido.

**Capacidades**:
- 📊 Creación de outlines estructurados
- 🔢 4-6 secciones principales
- 📝 Secciones de 5-10 palabras
- 🎯 Estructura optimizada para blog posts

**Ejemplo de uso**:
```
Input: "IA Médica: Cómo el Machine Learning Revoluciona la Salud"
Output: 
1. Introducción al Machine Learning Médico
2. Diagnósticos más precisos con IA
3. Tratamientos personalizados mediante algoritmos
4. Casos de éxito en hospitales
5. Desafíos éticos y regulatorios
6. Futuro de la medicina inteligente
```

---

## 🔍 **CLASES Y COMPONENTES TÉCNICOS**

### 🚦 **RoutingAgent Class** (`routing_agent/agent.py`)

**Responsabilidad**: Coordinador maestro que descubre agentes y delega tareas

**Propiedades Clave**:
```python
self.agents_client: AgentsClient                    # Cliente Azure AI Foundry  
self.remote_agent_connections: dict[str, RemoteAgentConnections]  # Pool de conexiones HTTP
self.cards: dict[str, AgentCard]                    # Cache de capacidades por agente
self.azure_agent: Agent                             # Instancia Azure AI con tools
self.current_thread: Thread                         # Thread de conversación Azure AI
```

**Flujo de Inicialización**:
1. `create(remote_agent_addresses)` → Factory method asíncrono
2. `_async_init_components()` → HTTP GET /agent-card a cada URL
3. `RemoteAgentConnections()` → Crea pool de conexiones httpx
4. `create_agent()` → Crea Azure AI Agent con `send_message` como tool

**Métodos Críticos**:
- `list_remote_agents()` → String con capacidades para Azure AI prompt
- `send_message(agent_name, task)` → HTTP POST /message via A2A protocol
- `process_user_message()` → Tool calling loop con Azure AI

### 📝 **TitleAgent/OutlineAgent Classes** (`*_agent/agent.py`)

**Responsabilidad**: Wrapper especializado de Azure AI Foundry

**Patrón de Implementación**:
```python
class TitleAgent:
    def __init__(self):
        self.client = AgentsClient(...)  # Azure AI client
        self.agent = None                # Azure AI Agent instance

    async def create_agent(self):
        self.agent = self.client.create_agent(
            model=os.environ["MODEL_DEPLOYMENT_NAME"],
            instructions="You are a title generation expert..."  # ← Especialización
        )
    
    async def run_conversation(self, message: str):
        # Ejecuta thread + run pattern con Azure AI
        return assistant_response
```

### 🔧 **AgentExecutor Classes** (`*_agent/agent_executor.py`)

**Responsabilidad**: Adapter que convierte protocolo A2A → Azure AI calls

**Interface A2A**:
```python
class TitleAgentExecutor(AgentExecutor):
    async def execute(
        self, 
        context: RequestContext,           # Contexto de la request A2A
        event_queue: EventQueue           # Cola de eventos para streaming
    ):
        # 1. Parse MessageSendParams de context
        # 2. Llama a self.agent.run_conversation() 
        # 3. Retorna Task con resultado
```

**Flujo interno**:
1. `execute()` → entry point del protocolo A2A
2. `_process_request()` → extrae texto de MessageSendParams 
3. `agent.run_conversation()` → ejecuta Azure AI Foundry
4. Construye `Task` con estado completed y respuesta

### 🌐 **RemoteAgentConnections Class** (`routing_agent/agent.py`)

**Responsabilidad**: Pool de conexiones HTTP persistentes a agentes remotos

**Arquitectura**:
```python
class RemoteAgentConnections:
    def __init__(self, agent_card: AgentCard, agent_url: str):
        self._httpx_client = httpx.AsyncClient(timeout=30)  # ← Conexión persistente
        self.agent_client = A2AClient(self._httpx_client, agent_card, url=agent_url)
        self.card = agent_card  # Cache de capacidades
```

**Métodos**:
- `get_agent()` → Retorna AgentCard desde cache
- `send_message(request)` → HTTP POST via A2AClient

### 📡 **A2A Framework Classes**

#### **A2AClient**
- Abstrae HTTP communication con agentes remotos
- Serializa/deserializa MessageSendParams ↔ JSON
- Maneja timeouts y errores HTTP

#### **A2ACardResolver** 
- HTTP GET /agent-card para descubrimiento
- Parse AgentCard JSON → Python objects
- Cache de capacidades por URL

#### **A2AStarletteApplication**
- Wrapper Starlette que expone protocolo A2A
- Auto-registra rutas GET /agent-card y POST /message  
- Integra AgentExecutor con HTTP endpoints

### 🔗 **INTEGRACIÓN CON AZURE AI**

**Tool Calling Pattern**:
```python
# Azure AI ve esto como herramientas disponibles:
functions = FunctionTool({self.send_message})

# En las instrucciones del agente:
instructions = f"""
Available Agents: {self.list_remote_agents()}
Use send_message tool to delegate tasks.
"""

# Azure AI automáticamente decide cuándo llamar send_message
# basado en el análisis del mensaje del usuario
```

---

## 📊 Flujo de Comunicación

### 🔄 Flujo Completo de una Solicitud

```mermaid
sequenceDiagram
    participant User as 👤 Usuario
    participant Client as 💻 Cliente
    participant Router as 🚦 Routing Agent
    participant Title as 📝 Title Agent
    
    User->>Client: "Genera título para mi artículo"
    Client->>Router: POST /message
    Router->>Router: Analiza solicitud con Azure AI
    Router->>Router: Decide usar Title Agent
    Router->>Title: POST /message (A2A)
    Title->>Title: Procesa con Azure AI Foundry
    Title->>Router: Respuesta con título
    Router->>Client: Respuesta final
    Client->>User: Muestra título generado
```

### 📋 Tipos de Datos A2A

**AgentCard**:
```python
class AgentCard:
    name: str                    # Nombre del agente
    description: str            # Descripción de capacidades
    url: str                   # URL del agente
    version: str               # Versión del agente
    capabilities: AgentCapabilities
    skills: list[AgentSkill]   # Habilidades específicas
```

**Task**:
```python  
class Task:
    id: str                    # ID único de la tarea
    state: TaskState          # Estado: submitted, working, completed
    messages: list[Message]   # Mensajes de la tarea
```

**MessageSendParams**:
```python
class MessageSendParams:
    id: str                   # ID único del mensaje
    task_context_id: str      # ID de contexto de la tarea
    text: str                 # Contenido del mensaje
```

---

## 🛠️ Desarrollo y Extensión

### 🎯 Crear un Nuevo Agente

1. **Crear estructura de directorios**:
```bash
mkdir new_agent
cd new_agent
```

2. **Implementar la clase del agente** (`agent.py`):
```python
class NewAgent:
    def __init__(self):
        self.client = AgentsClient(...)
        
    async def create_agent(self):
        self.agent = self.client.create_agent(
            model=os.environ['MODEL_DEPLOYMENT_NAME'],
            name='new-agent',
            instructions="Instrucciones específicas..."
        )
        
    async def run_conversation(self, message: str):
        # Implementar lógica de conversación
        pass
```

3. **Implementar el ejecutor A2A** (`agent_executor.py`):
```python
class NewAgentExecutor(AgentExecutor):
    async def execute(self, context: RequestContext, event_queue: EventQueue):
        # Implementar lógica de ejecución A2A
        pass
```

4. **Crear servidor FastAPI** (`server.py`):
```python
# Definir habilidades, tarjeta de agente y aplicación A2A
skills = [AgentSkill(...)]
agent_card = AgentCard(...)
a2a_app = A2AStarletteApplication(...)
```

5. **Registrar en Routing Agent**:
Agregar la URL del nuevo agente en `routing_agent/agent.py`:
```python
remote_agent_addresses=[
    "http://127.0.0.1:3001",  # Title Agent
    "http://127.0.0.1:3002",  # Outline Agent  
    "http://127.0.0.1:3003",  # New Agent ← AGREGAR AQUÍ
]
```

### 🔧 Debugging y Logging

**Ver logs de agentes**:
```bash
# Los logs se muestran automáticamente al ejecutar run_all.py
# O ejecutar cada agente individualmente para ver logs específicos
```

**Endpoints de estado**:
```bash
curl http://127.0.0.1:3000/health  # Routing Agent
curl http://127.0.0.1:3001/health  # Title Agent
curl http://127.0.0.1:3002/health  # Outline Agent
```

**Obtener capacidades**:
```bash
curl http://127.0.0.1:3001/agent-card  # Ver capacidades del Title Agent
```

### 🎯 Casos de Uso Avanzados

#### **Workflow Multi-Agente**:
1. Usuario: "Crea un artículo completo sobre IA"
2. Routing Agent → Title Agent → "Título generado"
3. Routing Agent → Outline Agent → "Outline estructurado"  
4. Routing Agent → Content Agent → "Contenido del artículo"
5. Routing Agent → Review Agent → "Artículo revisado y pulido"

#### **Especialización por Dominio**:
- **Legal Agent**: Documentos legales
- **Medical Agent**: Contenido médico
- **Technical Agent**: Documentación técnica
- **Marketing Agent**: Contenido promocional

---

## 📈 Ventajas del Sistema A2A

### 🎯 **Escalabilidad**
- Cada agente puede ejecutarse en diferentes máquinas
- Fácil agregar nuevos agentes especializados
- Balanceadores de carga por tipo de agente

### 🛡️ **Confiabilidad**
- Si un agente falla, otros siguen funcionando
- Reintentos automáticos de conexión
- Timeout y manejo de errores

### 🔧 **Mantenimiento**
- Actualizar agentes independientemente
- Testing aislado por agente
- Deploy por separado

### 💡 **Flexibilidad**
- Combinar agentes para workflows complejos
- Diferentes modelos de IA por agente
- Especialización profunda por dominio

---

## 🚀 **¡Pruébalo Ahora!**

```bash
# 1. Instalar dependencias
pip install -r requirements.txt

# 2. Configurar .env (copia de env.example)
cp env.example .env
# Edita .env con tus configuraciones de Azure

# 3. Ejecutar sistema completo
python run_all.py

# 4. ¡Empieza a chatear con los agentes!
# Ejemplo: "Genera un título para un artículo sobre machine learning"
```

---

**¡El futuro de la IA es distribuido y colaborativo! 🤖✨**