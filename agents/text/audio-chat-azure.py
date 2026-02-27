import io
import base64
import numpy as np
import sounddevice as sd
import scipy.io.wavfile as wav
from openai import AzureOpenAI

endpoint = "https://rdgztorres19-1990-resource.cognitiveservices.azure.com/"
deployment = "Phi-4-multimodal-instruct"
subscription_key = "7AGlxmLpLpGdWhVsfLEsOslFZJJSVEkYlB1fdPmPC2PqydwwDF6UJQQJ99CBACHYHv6XJ3w3AAAAACOGtErt"
api_version = "2024-12-01-preview"

client = AzureOpenAI(
    api_version=api_version,
    azure_endpoint=endpoint,
    api_key=subscription_key,
)

system_message = "You are an AI assistant for a produce supplier company."

SAMPLE_RATE = 16000
SILENCE_THRESHOLD = 500
SILENCE_DURATION = 2.0
CHUNK_DURATION = 0.5


def record_until_silence():
    print("Habla ahora... (se detiene al detectar silencio)")
    frames = []
    silent_chunks = 0
    chunk_size = int(SAMPLE_RATE * CHUNK_DURATION)
    max_silent_chunks = int(SILENCE_DURATION / CHUNK_DURATION)

    while True:
        chunk = sd.rec(chunk_size, samplerate=SAMPLE_RATE, channels=1, dtype='int16')
        sd.wait()
        frames.append(chunk)

        amplitude = np.abs(chunk).mean()
        if amplitude < SILENCE_THRESHOLD:
            silent_chunks += 1
        else:
            silent_chunks = 0

        if silent_chunks >= max_silent_chunks and len(frames) > max_silent_chunks:
            break

    audio = np.concatenate(frames)

    buffer = io.BytesIO()
    wav.write(buffer, SAMPLE_RATE, audio)
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode('utf-8')


while True:
    cmd = input("\nPresiona ENTER para hablar (o escribe 'quit' para salir)\n")
    if cmd.lower() == "quit":
        break

    audio_data = record_until_silence()
    print("Audio capturado. Enviando al modelo...\n")

    response = client.chat.completions.create(
        model=deployment,
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "First, write exactly what the user said in the audio as 'Transcripcion: ...'. Then respond to it as 'Respuesta: ...'."
                    },
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": audio_data,
                            "format": "wav"
                        }
                    }
                ]}
        ]
    )
    print("=============================")
    print("Respuesta:", response.choices[0].message.content)
    print("=============================")
