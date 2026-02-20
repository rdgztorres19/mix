"""
Azure AI Data Analysis Agent
============================

Este archivo implementa un agente de IA especializado en análisis de datos que utiliza
el SDK de Azure AI Projects para crear un agente con capacidades de interpretación de código.

COMPONENTES PRINCIPALES:
------------------------

1. **Azure AI Projects**: Plataforma que proporciona servicios de agentes de IA
   - AIProjectClient: Cliente para conectarse al proyecto de Azure AI
   - Maneja autenticación, endpoints y comunicación con Azure

2. **CodeInterpreterTool**: Herramienta que permite al agente ejecutar código Python
   - Analiza datos automáticamente usando bibliotecas como pandas, matplotlib
   - Genera visualizaciones, estadísticas y cálculos complejos
   - Tiene acceso a archivos subidos (data.txt en este caso)

3. **PromptAgentDefinition**: Define las características del agente
   - Instrucciones de comportamiento
   - Modelo de IA a utilizar (gpt-4.1)
   - Herramientas disponibles (CodeInterpreter)

4. **Conversations**: Sistema de chat persistente
   - Mantiene el contexto de la conversación
   - Permite interacciones múltiples con el mismo agente
   - Guarda historial para referencia futura

FLUJO DE TRABAJO:
-----------------
1. Carga archivo de datos (data.txt) 
2. Conecta con Azure AI Project usando credenciales
3. Sube el archivo a Azure para que el agente pueda accederlo
4. Crea un agente especializado en análisis de datos con CodeInterpreter
5. Inicia conversación interactiva donde el usuario puede:
   - Pedir análisis estadísticos
   - Solicitar visualizaciones  
   - Hacer preguntas sobre los datos
6. El agente usa Python automáticamente para responder
7. Limpia recursos al terminar

EJEMPLOS DE USO:
---------------
- "What's the category with the highest cost?"
- "Create a text-based bar chart showing cost by category"  
- "What's the standard deviation of cost?"
- "Calculate the correlation between different variables"

Basado en: https://microsoftlearning.github.io/mslearn-ai-agents/Instructions/02-build-ai-agent.html
"""

import os
from dotenv import load_dotenv
from typing import Any
from pathlib import Path

# Add references - SDK de Azure AI para agentes y herramientas
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import PromptAgentDefinition, CodeInterpreterTool, CodeInterpreterToolAuto


def main(): 

    # Clear the console
    os.system('cls' if os.name=='nt' else 'clear')

    # Load environment variables from .env file
    load_dotenv()
    project_endpoint= os.getenv("PROJECT_ENDPOINT")
    model_deployment = os.getenv("MODEL_DEPLOYMENT_NAME")

    # Display the data to be analyzed
    script_dir = Path(__file__).parent  # Get the directory of the script
    file_path = script_dir / 'files' / 'data.txt'

    with file_path.open('r') as file:
        data = file.read() + "\n"
        print(data)

    # Connect to the AI Project and OpenAI clients
    with (
        DefaultAzureCredential(
            exclude_environment_credential=True,
            exclude_managed_identity_credential=True) as credential,
         AIProjectClient(endpoint=project_endpoint, credential=credential) as project_client,
         project_client.get_openai_client() as openai_client
    ):

        # Upload the data file and create a CodeInterpreterTool
        # ================================================================
        
        # 📤 PASO 1: Subir archivo a Azure AI
        # ------------------------------------
        # ¿QUÉ HACE?
        # - Abre data.txt en modo binario ("rb") 
        # - Sube el archivo al servidor de Azure AI
        # - Le dice a Azure que es para "assistants" (agentes)
        # - Devuelve un ID único del archivo subido
        # 
        # ¿POR QUÉ ES NECESARIO?
        # - El agente NO puede acceder directamente a archivos en tu computadora
        # - Necesita que los archivos estén en Azure para poder leerlos
        # - Es como "adjuntar un archivo" para que el agente lo vea
        file = openai_client.files.create(
            file=open(file_path, "rb"), purpose="assistants"
        )

        print(f"Uploaded {file.filename}")

        # 🔧 PASO 2: Crear CodeInterpreterTool
        # ------------------------------------
        # ¿QUÉ HACE?
        # - Crea una herramienta de interpretación de código
        # - Le da acceso al archivo subido usando file.id
        # - Habilita al agente para ejecutar código Python
        # - Prepara pandas, matplotlib, numpy automáticamente
        #
        # ¿POR QUÉ ES NECESARIO?
        # Sin esto: El agente sería como un chatbot normal
        # Con esto: El agente se convierte en un ANALISTA DE DATOS que puede:
        #   📊 Leer CSV/datos del archivo
        #   🧮 Calcular estadísticas (promedios, desviaciones, etc.)
        #   📈 Crear gráficas (barras, líneas, histogramas)  
        #   🔢 Hacer análisis complejos con Python automáticamente
        code_interpreter = CodeInterpreterTool(
            container=CodeInterpreterToolAuto(file_ids=[file.id])
        )

        # Define an agent that uses the CodeInterpreterTool
        # PromptAgentDefinition: Configura el comportamiento del agente
        # - model: Especifica qué modelo de IA usar (gpt-4.1)
        # - instructions: Define la personalidad y objetivos del agente
        # - tools: Lista de herramientas disponibles (CodeInterpreter en este caso)
        agent = project_client.agents.create_version(
            agent_name="data-agent",
            definition=PromptAgentDefinition(
                model=model_deployment,
                instructions="You are an AI agent that analyzes the data in the file that has been uploaded. Use Python to calculate statistical metrics as necessary.",
                tools=[code_interpreter],
            ),
        )
        print(f"Using agent: {agent.name}")

        # Create a conversation for the chat session
        # Conversations: Sistema de chat persistente que mantiene el contexto
        # - Permite múltiples intercambios con el mismo agente
        # - El agente recuerda conversaciones anteriores en la misma sesión
        conversation = openai_client.conversations.create()

        # Loop until the user types 'quit'
        while True:
            # Get input text
            user_prompt = input("Enter a prompt (or type 'quit' to exit): ")
            if user_prompt.lower() == "quit":
                break
            if len(user_prompt) == 0:
                print("Please enter a prompt.")
                continue

            # Send a prompt to the agent
            openai_client.conversations.items.create(
                conversation_id=conversation.id,
                items=[{"type": "message", "role": "user", "content": user_prompt}],
            )
            response = openai_client.responses.create(
                conversation=conversation.id,
                extra_body={"agent": {"name": agent.name, "type": "agent_reference"}},
                input="",
            )

            # Check the response status for failures
            if response.status == "failed":
                print(f"Response failed: {response.error}")

            # Show the latest response from the agent
            print(f"Agent: {response.output_text}")

        # Get the conversation history
        print("\nConversation Log:\n")
        items = openai_client.conversations.items.list(conversation_id=conversation.id)
        for item in items:
            if item.type == "message":
                print(f"item.content[0].type = {item.content[0].type}")
                role = item.role.upper()
                content = item.content[0].text
                print(f"{role}: {content}\n")

        # Clean up
        openai_client.conversations.delete(conversation_id=conversation.id)
        print("Conversation deleted")
        project_client.agents.delete_version(agent_name=agent.name, agent_version=agent.version)
        print("Agent deleted")


if __name__ == '__main__': 
    main()
