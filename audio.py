import speech_recognition as sr
import pyautogui
import time
import threading
from pynput import keyboard as pk

# Diccionario de comandos → secuencia de acciones
keymap = {
    "one2": ["ctrl", "alt", "5"],
    "uno": [{"key": "a", "hold": 1000}, {"combo": ["d", "l"]}, ],
    "uno1": [{"key": "a", "hold": 2000}, {"wait": 0}, "s", {"wait": 0}, "a", "l"],
    "five": ["1"],
    "sobrewoolf": ["d", {"wait": 50}, "s", {"wait": 50}, {"combo": ["a", "l"]}]
}

def ejecutar_comandos(acciones):
    print(f"▶️ Ejecutando: {acciones}")
    if all(isinstance(a, str) for a in acciones) and len(acciones) <= 3:
        pyautogui.hotkey(*acciones)
        return

    for action in acciones:
        if isinstance(action, dict):
            if "wait" in action:
                time.sleep(action["wait"] / 1000)
            elif "hold" in action and "key" in action:
                pyautogui.keyDown(action["key"])
                time.sleep(action["hold"] / 1000)
                pyautogui.keyUp(action["key"])
            elif "combo" in action and isinstance(action["combo"], list):
                keys = action["combo"]
                for k in keys:
                    pyautogui.keyDown(k)
                time.sleep(0.1)  # ajustar si quieres que queden presionadas más tiempo
                for k in reversed(keys):
                    pyautogui.keyUp(k)
        elif isinstance(action, str):
            pyautogui.press(action)

# Diccionario de teclas físicas que activan comandos
teclas_a_escuchar = {
    "n": "sobrewoolf",
    "f9": "five"
}

def escuchar_teclas_pynput():
    def on_press(key):
        try:
            if hasattr(key, 'char') and key.char in teclas_a_escuchar:
                comando = teclas_a_escuchar[key.char]
                ejecutar_comandos(keymap[comando])
            elif hasattr(key, 'name') and key.name in teclas_a_escuchar:
                comando = teclas_a_escuchar[key.name]
                ejecutar_comandos(keymap[comando])
        except Exception as e:
            print(f"Error al detectar tecla: {e}")

    listener = pk.Listener(on_press=on_press)
    listener.start()
    print("⌨️ Escuchando teclas físicas (pynput)...")

def escuchar():
    recognizer = sr.Recognizer()
    mic = sr.Microphone()

    print("🎙️ Escuchando comandos de voz...")

    with mic as source:
        recognizer.adjust_for_ambient_noise(source)
        while True:
            try:
                audio = recognizer.listen(source)
                texto = recognizer.recognize_google(audio, language="es-ES").lower()
                print(f"🗣️ Dijiste: {texto}")

                for palabra, acciones in keymap.items():
                    if palabra in texto:
                        ejecutar_comandos(acciones)
                        break

            except sr.UnknownValueError:
                print("No entendí... intenta de nuevo.")
            except sr.RequestError as e:
                print(f"Error al usar Google STT: {e}")
                break

# 🔄 Iniciar escucha de teclas físicas y voz
escuchar_teclas_pynput()
escuchar()
