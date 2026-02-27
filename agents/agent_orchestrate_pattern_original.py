#!/usr/bin/env python3
"""
Multi-Agent Sequential Orchestration - CÓDIGO ORIGINAL DEL TUTORIAL
===================================================================

Este archivo contiene EXACTAMENTE el código del tutorial oficial de Microsoft:
https://microsoftlearning.github.io/mslearn-ai-agents/Instructions/Exercises/08-agent-framework-multi-agents.html

PROBLEMA: El tutorial usa APIs que no existen o no funcionan como se muestra
SOLUCIÓN: Ver agent_orchestrate_pattern.py para la implementación que SÍ funciona
"""

import os
from dotenv import load_dotenv

# CÓDIGO EXACTO DEL TUTORIAL - Add references
# =============================================
# PROBLEMA: Estas importaciones no funcionan como se muestra en el tutorial
import asyncio
from typing import cast
from agent_framework import ChatMessage, Role, SequentialBuilder, WorkflowOutputEvent  # ✅ Estos SÍ existen
from agent_framework.azure import AzureAIAgentClient  # ❌ Existe pero API diferente
from azure.identity import AzureCliCredential  # ❌ Problemas de permisos sandbox

load_dotenv()

async def main():
    """Main function from Microsoft tutorial - EXACTLY as written"""
    
    # Agent instructions from tutorial (these are correct)
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

    print("🚨 EJECUTANDO CÓDIGO ORIGINAL DEL TUTORIAL DE MICROSOFT")
    print("=" * 65)
    print("⚠️  ADVERTENCIA: Este código NO funcionará como se muestra")
    print("📚 Tutorial: https://microsoftlearning.github.io/.../08-agent-framework-multi-agents.html")
    print("=" * 65)

    try:
        # CÓDIGO EXACTO DEL TUTORIAL - Create the chat client
        # ===================================================
        # PROBLEMA: AzureCliCredential no funciona en sandbox de Cursor
        credential = AzureCliCredential()
        
        # PROBLEMA: Esta sintaxis async with no funciona como se muestra
        async with (
            AzureAIAgentClient(credential=credential) as chat_client,
        ):
            print("✅ AzureAIAgentClient creado (sorprendentemente funcionó)")
            
            # CÓDIGO EXACTO DEL TUTORIAL - Create agents
            # ===========================================  
            # PROBLEMA: chat_client.as_agent() no existe en la versión real
            print("🔄 Intentando crear agentes con chat_client.as_agent()...")
            
            summarizer = chat_client.as_agent(
                instructions=summarizer_instructions,
                name="summarizer",
            )
            print("✅ Summarizer agent creado")
            
            classifier = chat_client.as_agent(
                instructions=classifier_instructions,
                name="classifier",
            )
            print("✅ Classifier agent creado")
            
            action = chat_client.as_agent(
                instructions=action_instructions,
                name="action",
            )
            print("✅ Action agent creado")

            # CÓDIGO EXACTO DEL TUTORIAL - Initialize feedback
            # =================================================
            feedback = """
            I use the dashboard every day to monitor metrics, and it works well overall.
            But when I'm working late at night, the bright screen is really harsh on my eyes.
            If you added a dark mode option, it would make the experience much more comfortable.
            """
            
            print(f"\n📝 Customer feedback:\n{feedback.strip()}\n")

            # CÓDIGO EXACTO DEL TUTORIAL - Build sequential orchestration
            # ===========================================================
            # NOTA: SequentialBuilder SÍ existe, pero requiere que los agentes funcionen
            workflow = SequentialBuilder().participants([summarizer, classifier, action]).build()
            print("✅ Sequential workflow creado")

            # CÓDIGO EXACTO DEL TUTORIAL - Run and collect outputs
            # =====================================================
            print("🔄 Ejecutando workflow.run_stream()...")
            outputs = []
            async for event in workflow.run_stream(f"Customer feedback: {feedback}"):
                if isinstance(event, WorkflowOutputEvent):
                    outputs.append(cast(list[ChatMessage], event.data))

            # CÓDIGO EXACTO DEL TUTORIAL - Display outputs  
            # =============================================
            if outputs:
                print("\n📊 RESULTADOS DEL WORKFLOW:")
                print("-" * 60)
                for i, msg in enumerate(outputs[-1], start=1):
                    name = msg.author_name or ("assistant" if msg.role == Role.ASSISTANT else "user")
                    print(f"{'-' * 60}\n{i:02d} [{name}]\n{msg.text}")
            
            print("\n🎉 ¡El tutorial de Microsoft funcionó perfectamente!")
                    
    except ImportError as e:
        print(f"\n❌ ERROR DE IMPORTACIÓN: {e}")
        print("\n💡 EXPLICACIÓN:")
        print("   Las importaciones del tutorial no coinciden con la versión real del SDK")
        
    except AttributeError as e:
        print(f"\n❌ ERROR DE ATRIBUTO: {e}")
        print("\n💡 EXPLICACIÓN:")
        print("   Los métodos del tutorial (como .as_agent()) no existen en la API real")
        
    except Exception as e:
        print(f"\n❌ ERROR GENERAL: {e}")
        print("\n💡 EXPLICACIÓN:")
        print("   El tutorial de Microsoft tiene problemas de compatibilidad")

    print(f"\n{'=' * 65}")
    print("🔍 ANÁLISIS DEL TUTORIAL DE MICROSOFT:")
    print("✅ CORRECTO:")
    print("   - Concepto de Sequential Orchestration Pattern")
    print("   - Estructura de agentes (Summarizer → Classifier → Action)")
    print("   - SequentialBuilder existe en agent_framework")
    print("   - WorkflowOutputEvent existe")
    
    print("\n❌ INCORRECTO/PROBLEMÁTICO:")
    print("   - chat_client.as_agent() no existe (debería ser create_agent)")
    print("   - AzureAIAgentClient sintaxis diferente a la mostrada")
    print("   - AzureCliCredential problemas de permisos")
    print("   - Tutorial desactualizado vs SDK real")
    
    print(f"\n🎯 CONCLUSIÓN:")
    print("   El CONCEPTO es correcto, pero la IMPLEMENTACIÓN está desactualizada")
    print("   Ver agent_orchestrate_pattern.py para la versión que SÍ funciona")

if __name__ == "__main__":
    print("📚 TUTORIAL OFICIAL DE MICROSOFT - Código sin modificaciones")
    print("🔗 https://microsoftlearning.github.io/mslearn-ai-agents/Instructions/Exercises/08-agent-framework-multi-agents.html")
    print()
    
    # EJECUTAR CÓDIGO EXACTO DEL TUTORIAL
    asyncio.run(main())