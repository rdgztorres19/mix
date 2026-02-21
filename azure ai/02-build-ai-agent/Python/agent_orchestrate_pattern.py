#!/usr/bin/env python3
"""
Agent Framework - Sequential Orchestration Pattern Example
==========================================================

PATRÓN USADO: SEQUENTIAL ORCHESTRATION PATTERN
- Los agentes procesan información secuencialmente (uno tras otro)
- Cada agente toma la salida del anterior como entrada
- Pipeline lineal: Summarizer → Classifier → Action

DIFERENCIAS CON TUS AGENTES ACTUALES:
------------------------------------

1. PATRÓN DE ORQUESTACIÓN:
   - Tus agentes: ConnectedAgentTool (coordinador central que llama agentes individuales)
   - Agent Framework: SequentialBuilder (pipeline secuencial automático)

2. ESTRUCTURA:
   - Tus agentes: Un coordinator agent + specialized agents
   - Agent Framework: Pipeline directo de agentes especializados

3. CONFIGURACIÓN:
   - Tus agentes: AgentsClient + create_agent + ConnectedAgentTool
   - Agent Framework: AzureAIAgentClient + as_agent + SequentialBuilder

4. EJECUCIÓN:
   - Tus agentes: Manual thread creation + conversation handling
   - Agent Framework: workflow.run_stream() automático

VENTAJA: Pipeline más simple para casos lineales
"""

import os
from dotenv import load_dotenv
import certifi
print(certifi.where())

from azure.identity import AzureCliCredential

# Add references - DIFERENCIA: Menos imports que tus agentes multi-agente
import asyncio
from typing import cast
from azure.ai.agents import AgentsClient
# Add references - DIFERENCIA: Usando AgentsClient que SÍ funciona
from azure.ai.agents import AgentsClient  # ← Lo que SÍ funciona en tus agentes
from azure.ai.agents.models import MessageRole, ListSortOrder  # ← Para manejo manual de mensajes
from azure.identity import DefaultAzureCredential

load_dotenv()

def main():
    """Main function - orchestrates multiple agents sequentially"""
    
    # Agent instructions - DIFERENCIA: Definidos como strings simples
    # Tus agentes: Creados con AgentsClient.create_agent() individualmente
    summarizer_instructions = """
    You are a Summarizer agent. Your job is to take raw customer feedback and condense it into a short, neutral sentence that captures the key issue or request. Don't add interpretation or emotion—just summarize the facts clearly and concisely.
    """

    classifier_instructions = """
    You are a Classifier agent. Your job is to categorize customer feedback based on its content and tone. 
    
    Classify feedback into one of these categories:
    - Positive: Compliments, praise, or positive experiences
    - Negative: Complaints, problems, or negative experiences  
    - Feature request: Suggestions for new features or improvements
    
    Respond with only the category name.
    """

    action_instructions = """
    You are a Recommended Action agent. Based on the feedback category, suggest the most appropriate next step:
    
    - For Positive feedback: "Thank customer and request review/testimonial"
    - For Negative feedback: "Escalate to customer success team for immediate follow-up" 
    - For Feature requests: "Log as enhancement request for product backlog"
    
    Respond with only the recommended action.
    """
    
    print("Multi-Agent Sequential Orchestration Example")
    print("=" * 60)
    print("Pattern: Sequential Orchestration (Summarizer → Classifier → Action)")
    print("=" * 60)
    
    # Run the orchestration
    process_feedback(summarizer_instructions, classifier_instructions, action_instructions)

def process_feedback(summarizer_instructions, classifier_instructions, action_instructions):
    """Process customer feedback through sequential agent orchestration - SÍNCRONO como tus agentes"""
    
    # Create the agents client - IGUAL que tus agentes que SÍ funcionan
    agents_client = AgentsClient(
        endpoint=os.getenv("PROJECT_ENDPOINT"),
        credential=DefaultAzureCredential(
            exclude_environment_credential=True,
            exclude_managed_identity_credential=True
        )
    )
    
    with agents_client:

        # Create agents - IGUAL que tus agentes que SÍ funcionan
        model_deployment = os.getenv("MODEL_DEPLOYMENT_NAME")
        
        print("🤖 Creando agentes del pipeline secuencial...")
        
        summarizer = agents_client.create_agent(
            model=model_deployment,
            name="summarizer",
            instructions=summarizer_instructions,
        )
        print(f"✅ Summarizer agent creado: {summarizer.id}")
        
        classifier = agents_client.create_agent(
            model=model_deployment,
            name="classifier", 
            instructions=classifier_instructions,
        )
        print(f"✅ Classifier agent creado: {classifier.id}")
        
        action = agents_client.create_agent(
            model=model_deployment,
            name="action",
            instructions=action_instructions,
        )
        print(f"✅ Action agent creado: {action.id}")
        print()
        
        # Initialize the current feedback
        feedback = """
        I use the dashboard every day to monitor metrics, and it works well overall.
        But when I'm working late at night, the bright screen is really harsh on my eyes.
        If you added a dark mode option, it would make the experience much more comfortable.
        """
        
        print(f"Customer feedback:\n{feedback.strip()}\n")
        print("🔄 Processing through Sequential Pattern (manual implementation)...")
        print("=" * 60)
        
        # SEQUENTIAL ORCHESTRATION - Manual implementation usando AgentsClient
        # DIFERENCIA: Manual sequential processing vs SequentialBuilder automático
        # Step 1: Summarizer
        print("1️⃣ SUMMARIZER AGENT")
        print("-" * 30)
        
        # Usar métodos correctos del AgentsClient (como en tus agentes que funcionan)
        summarizer_thread = agents_client.threads.create()
        agents_client.messages.create(
            thread_id=summarizer_thread.id,
            role=MessageRole.USER,
            content=f"Customer feedback: {feedback}"
        )
        
        summarizer_run = agents_client.runs.create_and_process(
            thread_id=summarizer_thread.id,
            agent_id=summarizer.id
        )
        
        # Get messages and extract response (como en tus agentes)
        messages = agents_client.messages.list(
            thread_id=summarizer_thread.id,
            order=ListSortOrder.ASCENDING
        )
        # Get the last assistant message
        summary = ""
        for message in messages:
            if message.role == "assistant" and message.text_messages:
                summary = message.text_messages[-1].text.value
        print(f"📝 Summary: {summary}")
        print()
        
        # Step 2: Classifier
        print("2️⃣ CLASSIFIER AGENT")
        print("-" * 30)
        
        classifier_thread = agents_client.threads.create()
        agents_client.messages.create(
            thread_id=classifier_thread.id,
            role=MessageRole.USER,
            content=summary  # ← Sequential: usa output del anterior
        )
        
        classifier_run = agents_client.runs.create_and_process(
            thread_id=classifier_thread.id,
            agent_id=classifier.id
        )
        
        messages = agents_client.messages.list(
            thread_id=classifier_thread.id,
            order=ListSortOrder.ASCENDING
        )
        classification = ""
        for message in messages:
            if message.role == "assistant" and message.text_messages:
                classification = message.text_messages[-1].text.value
        print(f"🏷️ Classification: {classification}")
        print()
        
        # Step 3: Action
        print("3️⃣ ACTION AGENT")
        print("-" * 30)
        
        action_thread = agents_client.threads.create()
        agents_client.messages.create(
            thread_id=action_thread.id,
            role=MessageRole.USER,
            content=classification  # ← Sequential: usa output del anterior
        )
        
        action_run = agents_client.runs.create_and_process(
            thread_id=action_thread.id,
            agent_id=action.id
        )
        
        messages = agents_client.messages.list(
            thread_id=action_thread.id,
            order=ListSortOrder.ASCENDING
        )
        recommended_action = ""
        for message in messages:
            if message.role == "assistant" and message.text_messages:
                recommended_action = message.text_messages[-1].text.value
        print(f"⚡ Recommended Action: {recommended_action}")
        print()
        
        print("=" * 60)
        print("✅ Sequential orchestration completed!")
        print(f"Pipeline: Customer Feedback → Summary → Classification → Action")
        
        # Cleanup agents (como en tus agentes que funcionan)
        print("\n🧹 Cleaning up agents...")
        agents_client.delete_agent(summarizer.id)
        agents_client.delete_agent(classifier.id) 
        agents_client.delete_agent(action.id)
        print("✅ Agents deleted")

if __name__ == "__main__":
    # DIFERENCIA CLAVE: Sequential Orchestration Pattern
    # Tus agentes: Coordinator pattern (central agent que delega)
    # Agent Framework: Pipeline pattern (secuencia automática)
    main()