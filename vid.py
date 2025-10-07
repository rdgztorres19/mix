import cv2
import os
from transformers import VisionEncoderDecoderModel, ViTImageProcessor, AutoTokenizer
from PIL import Image
import torch
import openai
from gtts import gTTS
from moviepy.editor import VideoFileClip, AudioFileClip

# Configura tu API key de OpenAI
openai.api_key = "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"  # Reemplaza con tu clave de API

# Cargar modelo de image captioning
model_name = "nlpconnect/vit-gpt2-image-captioning"
model = VisionEncoderDecoderModel.from_pretrained(model_name)
feature_extractor = ViTImageProcessor.from_pretrained(model_name)
tokenizer = AutoTokenizer.from_pretrained(model_name)

device = "cuda" if torch.cuda.is_available() else "cpu"
model.to(device)

def generate_caption(image):
    """
    Genera una descripción para una imagen usando el modelo de captioning.
    """
    if image.mode != "RGB":
        image = image.convert(mode="RGB")
    pixel_values = feature_extractor(images=image, return_tensors="pt").pixel_values
    pixel_values = pixel_values.to(device)
    output_ids = model.generate(pixel_values, max_length=16, num_beams=4)
    caption = tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()
    return caption

def extract_frames(video_path, interval=5):
    """
    Extrae frames del video cada 'interval' segundos.
    """
    cap = cv2.VideoCapture(video_path)
    frames = []
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = int(fps * interval)
    frame_count = 0
    success, frame = cap.read()
    while success:
        if frame_count % frame_interval == 0:
            # Convertir el frame de BGR (formato OpenCV) a RGB y luego a PIL Image
            img = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_img = Image.fromarray(img)
            frames.append(pil_img)
        success, frame = cap.read()
        frame_count += 1
    cap.release()
    return frames

def generate_narrative(captions):
    """
    Envía las descripciones a OpenAI para generar una narrativa que sirva de guion.
    """
    prompt = "Dadas las siguientes descripciones de escenas de un video:\n"
    for i, caption in enumerate(captions):
        prompt += f"Escena {i+1}: {caption}\n"
    prompt += "\nPor favor, genera una narrativa descriptiva y coherente en español que pueda usarse como guion de audio para este video."
    
    response = openai.ChatCompletion.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
        max_tokens=250
    )
    narrative = response.choices[0].message.content.strip()
    return narrative

def synthesize_audio(text, lang='es'):
    """
    Genera un archivo de audio a partir del texto usando gTTS.
    """
    tts = gTTS(text, lang=lang)
    audio_path = "narration.mp3"
    tts.save(audio_path)
    return audio_path

def add_audio_to_video(video_path, audio_path, output_path):
    """
    Combina el audio generado con el video original.
    """
    video_clip = VideoFileClip(video_path)
    audio_clip = AudioFileClip(audio_path)
    # Ajusta la duración del audio a la del video
    audio_clip = audio_clip.set_duration(video_clip.duration)
    video_clip = video_clip.set_audio(audio_clip)
    video_clip.write_videofile(output_path, codec="libx264", audio_codec="aac")

def main():
    video_path = "input_video.mp4"  # Ruta al video sin audio
    output_video_path = "output_video_with_audio.mp4"
    
    print("Extrayendo frames del video...")
    frames = extract_frames(video_path, interval=5)
    print(f"Total de frames extraídos: {len(frames)}")
    
    print("Generando descripciones para cada frame...")
    captions = [generate_caption(frame) for frame in frames]
    for i, caption in enumerate(captions):
        print(f"Frame {i+1}: {caption}")
    
    print("Generando narrativa con OpenAI...")
    narrative = generate_narrative(captions)
    print("Narrativa generada:")
    print(narrative)
    
    print("Sintetizando audio a partir de la narrativa...")
    audio_path = synthesize_audio(narrative, lang='es')
    
    print("Agregando audio al video...")
    add_audio_to_video(video_path, audio_path, output_video_path)
    
    print(f"Proceso completado. El video final se ha guardado en: {output_video_path}")

if __name__ == "__main__":
    main()
