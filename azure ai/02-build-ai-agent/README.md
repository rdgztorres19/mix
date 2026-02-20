# 🤖 Azure AI Agent - Data Analysis Tool

Un agente de IA que analiza datos y crea visualizaciones usando la herramienta **Code Interpreter** integrada de Azure AI Foundry.

## 🎯 ¿Qué hace este agente?

Este agente puede:
- 📊 Analizar datos de archivos CSV/texto
- 📈 Generar visualizaciones de texto (gráficos ASCII)
- 🔢 Calcular métricas estadísticas (promedio, desviación estándar, etc.)
- 💬 Mantener conversaciones contextuales sobre los datos

## 🏗️ Arquitectura

```
Usuario → Python App → Azure AI Foundry → Code Interpreter Tool
    ↓
  agent.py → Sube data.txt → Crea agente → Ejecuta análisis
```

## 📁 Estructura de Archivos

```
Python/
├── 📄 requirements.txt     # Dependencias: azure-identity, azure-ai-projects
├── 📄 .env                 # Configuración: PROJECT_ENDPOINT, MODEL_DEPLOYMENT_NAME
├── 📄 agent.py             # Aplicación principal del agente
├── 📄 data.txt             # Datos de ejemplo (categorías, items, costos)
└── 📄 README.md            # Esta documentación
```

## 🔧 Configuración e Instalación

### 1. Prerrequisitos Azure

- **Azure AI Foundry Project** configurado
- **Modelo gpt-4.1** desplegado
- **Azure CLI** instalado y autenticado

### 2. Configurar Variables de Entorno

Edita `.env` con tus configuraciones:

```bash
# Azure AI Foundry
PROJECT_ENDPOINT=https://tu-proyecto.cognitiveservices.azure.com/
MODEL_DEPLOYMENT_NAME=gpt-4.1
```

### 3. Instalar Dependencias

```bash
pip install -r requirements.txt
```

### 4. Autenticación con Azure

```bash
# Usando Azure CLI
az login
```

## 🚀 Cómo Ejecutar

```bash
python agent.py
```

### Ejemplos de Prompts

```bash
# Análisis básico
"What's the category with the highest cost?"

# Visualización
"Create a text-based bar chart showing cost by category"

# Estadísticas
"What's the standard deviation of cost?"

# Análisis avanzado
"Show me the top 3 most expensive items and their categories"
```

## 🔍 Flujo Técnico

### 1. **Inicialización**
```python
# Conecta a Azure AI Foundry
with AIProjectClient(endpoint=project_endpoint, credential=credential) as project_client:
    with project_client.get_openai_client() as openai_client:
```

### 2. **Upload de Datos**
```python
# Sube archivo de datos
file = openai_client.files.create(
    file=open(file_path, "rb"), purpose="assistants"
)

# Crea herramienta Code Interpreter
code_interpreter = CodeInterpreterTool(
    container=CodeInterpreterToolAuto(file_ids=[file.id])
)
```

### 3. **Creación del Agente**
```python
# Define agente con Code Interpreter
agent = project_client.agents.create_version(
    agent_name="data-agent",
    definition=PromptAgentDefinition(
        model=model_deployment,
        instructions="You are an AI agent that analyzes data...",
        tools=[code_interpreter],  # ← Herramienta para ejecutar Python
    ),
)
```

### 4. **Conversación**
```python
# Crea thread de conversación
conversation = openai_client.conversations.create()

# Envía mensaje del usuario
openai_client.conversations.items.create(
    conversation_id=conversation.id,
    items=[{"type": "message", "role": "user", "content": user_prompt}],
)

# Ejecuta agente
response = openai_client.responses.create(
    conversation=conversation.id,
    extra_body={"agent": {"name": agent.name, "type": "agent_reference"}},
)
```

## 🛠️ Componentes Técnicos

### **Code Interpreter Tool**
- **Propósito**: Ejecuta código Python dinámicamente
- **Capacidades**: Análisis estadístico, visualizaciones, cálculos
- **Input**: Archivos de datos (CSV, texto)
- **Output**: Resultados de análisis, gráficos ASCII

### **Azure AI Foundry Integration**
- **Cliente**: `AIProjectClient` para gestión de proyectos
- **Agentes**: `PromptAgentDefinition` con instrucciones especializadas
- **Conversaciones**: Thread-based conversations con estado

### **Datos de Ejemplo**
```csv
Category,Item,Cost
Electronics,Laptop,1200
Electronics,Phone,800
Furniture,Chair,150
Clothing,Jacket,80
Food,Groceries,200
Transportation,Gas,100
```

## 📊 Capacidades de Análisis

### **Métricas Estadísticas**
- Promedios, medianas, desviación estándar
- Análisis por categorías
- Identificación de outliers

### **Visualizaciones de Texto**
- Gráficos de barras ASCII
- Histogramas de texto
- Tablas formateadas

### **Análisis Avanzado**
- Correlaciones entre variables
- Análisis de tendencias
- Comparaciones entre categorías

## 🧹 Limpieza Automática

El agente se encarga de limpiar recursos automáticamente:

```python
# Elimina conversación y agente
openai_client.conversations.delete(conversation_id=conversation.id)
project_client.agents.delete_version(agent_name=agent.name, agent_version=agent.version)
```

## 🔍 Logging y Debug

- **Historial completo** de conversación al finalizar
- **Status de respuestas** para manejo de errores
- **Información de archivos** subidos y procesados

---

**¡Un agente inteligente que convierte datos en insights! 📊✨**