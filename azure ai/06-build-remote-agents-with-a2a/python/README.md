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

## 📁 Estructura de Archivos

```
python/
├── 📄 requirements.txt          # Dependencias de Python
├── 📄 env.example              # Variables de entorno de ejemplo
├── 📄 client.py                # Cliente para interactuar con el sistema
├── 📄 run_all.py               # Script para ejecutar todos los servicios
├── 
├── 🚦 routing_agent/
│   ├── 📄 agent.py             # Lógica principal del agente de enrutamiento
│   └── 📄 server.py            # Servidor FastAPI del routing agent
├── 
├── 📝 title_agent/
│   ├── 📄 agent.py             # Agente especializado en generar títulos
│   ├── 📄 agent_executor.py    # Ejecutor que maneja las tareas A2A
│   └── 📄 server.py            # Servidor FastAPI del title agent
├── 
└── 📋 outline_agent/
    ├── 📄 agent.py             # Agente especializado en generar outlines
    ├── 📄 agent_executor.py    # Ejecutor que maneja las tareas A2A
    └── 📄 server.py            # Servidor FastAPI del outline agent
```

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

## 🔄 Comunicación Entre Agentes

### 📡 Protocolo A2A

Los agentes se comunican usando el protocolo A2A sobre HTTP/REST:

#### 1. **Descubrimiento de Agentes**
```http
GET /agent-card
```
Devuelve información sobre las capacidades del agente.

#### 2. **Envío de Mensajes**
```http
POST /message
Content-Type: application/json

{
  "message": {
    "id": "uuid",
    "task_context_id": "uuid", 
    "text": "Genera un título para: contenido aquí"
  }
}
```

#### 3. **Respuesta del Agente**
```json
{
  "result": {
    "id": "task-uuid",
    "state": "completed",
    "messages": [
      {
        "text": "Título generado aquí",
        "context_id": "uuid"
      }
    ]
  }
}
```

### 🔗 Clases de Comunicación

#### **A2AClient**
Cliente que maneja la comunicación HTTP con otros agentes.

#### **A2ACardResolver**  
Resuelve y obtiene las "tarjetas" (capabilities) de agentes remotos.

#### **MessageSendParams**
Parámetros del mensaje a enviar a otro agente.

#### **SendMessageRequest/Response**
Request/Response wrapper para el protocolo A2A.

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

## 🔍 Clases y Componentes

### 🚦 **RoutingAgent Class**

**Ubicación**: `routing_agent/agent.py`

**Propiedades**:
- `agents_client`: Cliente para Azure AI Foundry
- `remote_agent_connections`: Diccionario de conexiones a agentes remotos
- `cards`: Información de capacidades de cada agente
- `azure_agent`: Instancia del agente de Azure
- `current_thread`: Hilo de conversación actual

**Métodos Principales**:
- `create(remote_agent_addresses)`: Factory method asíncrono
- `list_remote_agents()`: Lista agentes remotos disponibles
- `send_message(agent_name, task)`: Envía tarea a agente específico
- `create_agent()`: Crea agente Azure AI con herramientas
- `process_user_message(message)`: Procesa mensaje del usuario

### 📝 **TitleAgent Class**

**Ubicación**: `title_agent/agent.py`

**Propiedades**:
- `client`: Cliente de Azure AI Foundry
- `agent`: Instancia del agente especializado

**Métodos Principales**:
- `create_agent()`: Crea agente especializado en títulos
- `run_conversation(message)`: Ejecuta conversación con el agente

### 🔧 **AgentExecutor Classes**

**Ubicación**: `*_agent/agent_executor.py`

Cada agente tiene un **AgentExecutor** que implementa el protocolo A2A:

**Métodos Principales**:
- `execute(context, event_queue)`: Ejecuta la tarea A2A
- `cancel(context, event_queue)`: Cancela ejecución
- `_process_request(parts, context_id, updater)`: Procesa solicitud

### 🌐 **RemoteAgentConnections Class**

**Ubicación**: `routing_agent/agent.py`

**Propósito**: Mantiene conexiones HTTP persistentes con agentes remotos.

**Propiedades**:
- `agent_client`: Cliente A2A para comunicación
- `card`: Tarjeta con capacidades del agente

**Métodos**:
- `get_agent()`: Obtiene información del agente
- `send_message(request)`: Envía mensaje al agente remoto

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