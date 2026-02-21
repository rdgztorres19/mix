#!/usr/bin/env python3
"""
Agent Framework Example - Expense Claims Agent
==============================================

DIFERENCIAS CON TUS AGENTES ACTUALES:
-------------------------------------

1. IMPORTACIONES:
   - Tus agentes: from azure.ai.projects import AIProjectClient
   - Agent Framework: from agent_framework import Agent, tool (más simple)

2. DEFINICIÓN DE HERRAMIENTAS:
   - Tus agentes: FunctionTool con JSON schema complejo (~15 líneas)
   - Agent Framework: @tool decorator (~3 líneas)

3. CREACIÓN DE AGENTE:
   - Tus agentes: AIProjectClient + PromptAgentDefinition + múltiples pasos
   - Agent Framework: Agent() directo con async/await

4. EJECUCIÓN:
   - Tus agentes: create_conversation + create_message + create_response + manejo manual
   - Agent Framework: await agent.run() - todo automático

VENTAJA: Menos código, API más moderna
"""

import os
from dotenv import load_dotenv
from pathlib import Path

# Add references - DIFERENCIA: Menos importaciones que tus agentes
from agent_framework import Agent, tool  # ← Tus agentes: AIProjectClient + FunctionTool
from agent_framework.azure import AzureOpenAIResponsesClient  # ← Tus agentes: AIProjectClient
from azure.identity import AzureCliCredential
from pydantic import Field
from typing import Annotated

load_dotenv()

def main():
    """Main function - loads expenses data and processes it"""
    # Clear console
    os.system('cls' if os.name == 'nt' else 'clear')
    
    print("Expense Claims Agent - Agent Framework Example")
    print("=" * 50)
    
    # Load expenses data
    script_dir = Path(__file__).parent
    expenses_file_path = script_dir / 'files' / 'expenses.txt'
    
    # Create sample expenses file if it doesn't exist
    if not expenses_file_path.exists():
        expenses_file_path.parent.mkdir(exist_ok=True)
        sample_expenses = """Business Trip Expenses:
Hotel: $150.00
Meals: $85.50  
Transportation: $25.00
Office supplies: $15.75
Total: $276.25"""
        with open(expenses_file_path, 'w') as f:
            f.write(sample_expenses)
    
    # Read expenses data
    with open(expenses_file_path, 'r') as file:
        expenses_data = file.read()
    
    print(f"Expenses data loaded:\n{expenses_data}\n")
    
    # Get user input
    prompt = input("What would you like to do with this expenses data? ")
    
    # Process the expenses data
    import asyncio
    asyncio.run(process_expenses_data(prompt, expenses_data))

# Create a tool function for the email functionality
# DIFERENCIA: Tus agentes definen esto como FunctionTool con JSON schema complejo
# Agent Framework usa @tool decorator - mucho más simple (solo 3 líneas)
@tool
def send_email(
    to: Annotated[str, Field(description="Who to send the email to")],
    subject: Annotated[str, Field(description="The subject of the email.")],
    body: Annotated[str, Field(description="The text body of the email.")]
):
    """Send an email (simulated)"""
    print("\nTo:", to)
    print("Subject:", subject)
    print(body, "\n")

async def process_expenses_data(prompt, expenses_data):
    """Process expenses data using Agent Framework"""
    
    # DIFERENCIA: Tus agentes usan AIProjectClient con context managers complejos
    # Agent Framework usa Agent directo con async/await más simple
    
    # Create a client and initialize an agent with the tool and instructions
    async with (
        AzureCliCredential() as credential,
        Agent(
            client=AzureOpenAIResponsesClient(
                credential=credential,
                deployment_name=os.getenv("MODEL_DEPLOYMENT_NAME"),
                project_endpoint=os.getenv("PROJECT_ENDPOINT"),
            ),
            instructions="""You are an AI assistant for expense claim submission.
                        At the user's request, create an expense claim and use the plug-in function to send an email to expenses@contoso.com with the subject 'Expense Claim' and a body that contains itemized expenses with a total.
                        Then confirm to the user that you've done so. Don't ask for any more information from the user, just use the data provided to create the email.""",
            tools=[send_email],  # ← DIFERENCIA: Función directa vs FunctionTool object
        ) as agent,
    ):
        
        # Use the agent to process the expenses data
        # DIFERENCIA: Tus agentes requieren crear conversation, message, response manualmente
        # Agent Framework: una sola llamada await agent.run()
        try:
            # Add the input prompt to a list of messages to be submitted
            prompt_messages = [f"{prompt}: {expenses_data}"]
            
            # Invoke the agent for the specified thread with the messages
            response = await agent.run(prompt_messages)
            
            # Display the response
            print(f"\n# Agent:\n{response}")
            
        except Exception as e:
            # Something went wrong
            print(e)

if __name__ == "__main__":
    # DIFERENCIA CLAVE: Agent Framework requiere menos setup que tus agentes
    # Tus agentes: AIProjectClient + AgentsClient + múltiples context managers  
    # Agent Framework: Solo main() con async/await
    main()