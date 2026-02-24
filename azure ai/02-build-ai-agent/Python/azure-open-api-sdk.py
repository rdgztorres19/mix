import os
from openai import AzureOpenAI

endpoint = "https://rdgztorres19-1990-resource.cognitiveservices.azure.com/"
model_name = "gpt-4.1-mini"
deployment = "gpt-4.1"

subscription_key = "7AGlxmLpLpGdWhVsfLEsOslFZJJSVEkYlB1fdPmPC2PqydwwDF6UJQQJ99CBACHYHv6XJ3w3AAAAACOGtErt"
api_version = "2024-12-01-preview"

client = AzureOpenAI(
    api_version=api_version,
    azure_endpoint=endpoint,
    api_key=subscription_key,
)

response = client.chat.completions.create(
    messages=[
        {
            "role": "system",
            "content": "You are a helpful assistant.",
        },
        {
            "role": "user",
            "content": "I am going to Paris, what should I see?",
        }
    ],
    max_completion_tokens=13107,
    temperature=1.0,
    top_p=1.0,
    frequency_penalty=0.0,
    presence_penalty=0.0,
    model=deployment
)

print(response.choices[0].message.content)