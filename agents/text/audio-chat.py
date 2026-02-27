import os
import requests
import base64
from dotenv import load_dotenv

# Add references
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient


def main(): 

    # Clear the console
    os.system('cls' if os.name=='nt' else 'clear')
        
    try: 
    
        # Get configuration settings 
        load_dotenv()
        project_endpoint = "https://rdgztorres19-1990-resource.cognitiveservices.azure.com/"
        model_deployment = "Phi-4-multimodal-instruct"

        print(f"Using model: {model_deployment} at {project_endpoint}")

        # Initialize the project client
        project_client = AIProjectClient(
            credential=DefaultAzureCredential(
                exclude_environment_credential=True,
                exclude_managed_identity_credential=True
            ),
            endpoint=project_endpoint,
        )

        # Get a chat client
        openai_client = project_client.get_openai_client()

        # Initialize prompts
        system_message = "You are an AI assistant for a produce supplier company."
        prompt = ""

        # Loop until the user types 'quit'
        while True:
            prompt = input("\nAsk a question about the audio\n(or type 'quit' to exit)\n")
            if prompt.lower() == "quit":
                break
            elif len(prompt) == 0:
                    print("Please enter a question.\n")
            else:
                print("Getting a response ...\n")

                # Encode the audio file
                file_path = "https://github.com/MicrosoftLearning/mslearn-ai-language/raw/refs/heads/main/Labfiles/09-audio-chat/data/avocados.mp3"
                response = requests.get(file_path)
                response.raise_for_status()
                audio_data = base64.b64encode(response.content).decode('utf-8')

                # Get a response to audio input
                response = openai_client.chat.completions.create(
                    model=model_deployment,
                    messages=[
                        {"role": "system", "content": system_message},
                        {"role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": prompt
                                },
                                {
                                    "type": "input_audio",
                                    "input_audio": {
                                        "data": audio_data,
                                        "format": "mp3"
                                    }
                                }
                            ]}
                    ]
                )
                print(response.choices[0].message.content)


    except Exception as ex:
        print(f"Error type: {type(ex).__name__}")
        print(f"Error message: {ex}")
        if hasattr(ex, 'status_code'):
            print(f"Status code: {ex.status_code}")
        if hasattr(ex, 'response') and ex.response is not None:
            print(f"Response URL: {ex.response.url}")
            print(f"Response headers: {dict(ex.response.headers)}")
            try:
                print(f"Response body: {ex.response.text}")
            except Exception:
                pass
        if hasattr(ex, 'body'):
            print(f"Error body: {ex.body}")
        import traceback
        traceback.print_exc()


if __name__ == '__main__': 
    main()