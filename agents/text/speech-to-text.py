from dotenv import load_dotenv
from datetime import datetime
import os

# Import namespaces
import azure.cognitiveservices.speech as speech_sdk


def main():

    # Clear the console
    os.system('cls' if os.name=='nt' else 'clear')

    try:
        global speech_config

        # Get config settings
        load_dotenv()
        speech_key = os.getenv('KEY')
        speech_region = os.getenv('REGION')

        # Configure speech service
        speech_config = speech_sdk.SpeechConfig(speech_key, speech_region)
        print('Ready to use speech service in:', speech_config.region)

        # Get spoken input
        command = TranscribeCommand()
        if command.lower() == 'what time is it?':
            TellTime()

    except Exception as ex:
        print(ex)

def TranscribeCommand():
    command = ''

    # Configure speech recognition
    current_dir = os.path.dirname(os.path.abspath(__file__))
    audio_file = os.path.join(current_dir, '..', 'files', 'time.wav')
    if os.path.exists(audio_file):
        audio_config = speech_sdk.AudioConfig(filename=audio_file)
    else:
        audio_config = speech_sdk.AudioConfig(use_default_microphone=True)
        print('Archivo time.wav no encontrado. Usando micrófono...')
    speech_recognizer = speech_sdk.SpeechRecognizer(speech_config, audio_config)

    # Process speech input
    if os.path.exists(audio_file):
        print("Listening...")
    else:
        print('Speak now...')
    speech_result = speech_recognizer.recognize_once_async().get()
    if speech_result.reason == speech_sdk.ResultReason.RecognizedSpeech:
        command = speech_result.text
        print(command)
    else:
        print(speech_result.reason)
        if speech_result.reason == speech_sdk.ResultReason.Canceled:
            cancellation = speech_result.cancellation_details
            print(cancellation.reason)
            print(cancellation.error_details)

    # Return the command
    return command


def TellTime():
    now = datetime.now()
    response_text = 'The time is {}:{:02d}'.format(now.hour,now.minute)


    # Configure speech synthesis
    output_file = "output.wav"
    speech_config.speech_synthesis_voice_name = "en-GB-RyanNeural"
    audio_config = speech_sdk.audio.AudioConfig(filename=output_file)
    speech_synthesizer = speech_sdk.SpeechSynthesizer(speech_config, audio_config)

    # Synthesize spoken output
    speak = speech_synthesizer.speak_text_async(response_text).get()
    if speak.reason != speech_sdk.ResultReason.SynthesizingAudioCompleted:
        print(speak.reason)
    else:
        print("Spoken output saved in " + output_file)

    # Print the response
    print(response_text)


if __name__ == "__main__":
    main()




# # Synthesize spoken output
# responseSsml = " \
#    <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'> \
#        <voice name='en-GB-LibbyNeural'> \
#            {} \
#            <break strength='weak'/> \
#            Time to end this lab! \
#        </voice> \
#    </speak>".format(response_text)
# speak = speech_synthesizer.speak_ssml_async(responseSsml).get()
# if speak.reason != speech_sdk.ResultReason.SynthesizingAudioCompleted:
#    print(speak.reason)
# else:
#    print("Spoken output saved in " + output_file)