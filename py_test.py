import asyncio
import os

from azure.identity.aio import DefaultAzureCredential
from agent_framework.azure import AzureAIAgentClient
from azure.ai.agentserver.agentframework import (
    GroupChatBuilder,
    GroupChatManager,
    WorkflowOutputEvent,
)


PROJECT_ENDPOINT = os.environ["PROJECT_ENDPOINT"]
MODEL_DEPLOYMENT = os.environ["MODEL_DEPLOYMENT_NAME"]


# ======================================
# Custom Manager with Human-in-the-Loop
# ======================================

class HumanLoopManager(GroupChatManager):

    def __init__(self, max_rounds=5):
        super().__init__()
        self.max_rounds = max_rounds
        self.round = 0

    async def should_request_user_input(self, conversation):
        # Ask human every 2 rounds
        return self.round > 0 and self.round % 2 == 0

    async def should_terminate(self, conversation):
        return self.round >= self.max_rounds

    async def filter_results(self, conversation):
        # Return full conversation as final result
        return conversation

    async def select_next_agent(self, conversation, participants):
        agent = participants[self.round % len(participants)]
        self.round += 1
        return agent


async def main():

    # ==============================
    # 1️⃣ Create chat client
    # ==============================

    credential = DefaultAzureCredential()

    agent_client = AzureAIAgentClient(
        endpoint=PROJECT_ENDPOINT,
        credential=credential,
        model=MODEL_DEPLOYMENT,
    )

    # ==============================
    # 2️⃣ Define agents
    # ==============================

    marketing = await agent_client.create_agent(
        name="Marketing",
        instructions="Provide market positioning and customer strategy."
    )

    engineering = await agent_client.create_agent(
        name="Engineering",
        instructions="Provide technical feasibility and architecture details."
    )

    finance = await agent_client.create_agent(
        name="Finance",
        instructions="Provide cost analysis and ROI estimation."
    )

    # ==============================
    # 3️⃣ Create custom manager
    # ==============================

    manager = HumanLoopManager(max_rounds=6)

    # ==============================
    # 4️⃣ Build Group Chat workflow
    # ==============================

    workflow = (
        GroupChatBuilder()
        .participants(marketing, engineering, finance)
        .manager(manager)
        .build()
    )

    # ==============================
    # 5️⃣ Run workflow (streaming)
    # ==============================

    task = "Launch an AI SaaS product for small businesses."

    print("\n=== GROUP CHAT START ===\n")

    async for event in workflow.run_stream(task):

        if isinstance(event, WorkflowOutputEvent):

            conversation = event.output

            print("\n=== FINAL RESULT ===\n")

            for message in conversation:
                print(f"{message.author}:")
                print(message.content)
                print("-" * 60)

        # Handle human input request
        if event.__class__.__name__ == "UserInputRequestedEvent":

            user_input = input("\n👤 Human input requested: ")
            await workflow.send_user_input(user_input)


if __name__ == "__main__":
    asyncio.run(main())
