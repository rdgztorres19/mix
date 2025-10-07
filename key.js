const { Model, KaldiRecognizer } = require('vosk');
const mic = require('mic');
const robot = require('robotjs');
const fs = require('fs');
const path = require('path');

const MODEL_PATH = path.join(__dirname, 'model', 'vosk-model-small-es-0.42');
if (!fs.existsSync(MODEL_PATH)) {
  console.error("Modelo de Vosk no encontrado en:", MODEL_PATH);
  process.exit(1);
}

const model = new Model(MODEL_PATH);
const recognizer = new KaldiRecognizer(model, 16000);
recognizer.setWords(true);

const keyBindings = {
  "uno": ["control", "alt", "1"],
  "dos": ["control", "alt", "2"],
  "tres": ["control", "alt", "3"],
  "cuatro": ["control", "alt", "4"],
  "cinco": ["control", "alt", "5"],
};

const micInstance = mic({
  rate: '16000',
  channels: '1',
  debug: false,
  exitOnSilence: 6,
});

const micInputStream = micInstance.getAudioStream();

micInputStream.on('data', (data) => {
  if (recognizer.acceptWaveform(data)) {
    const result = JSON.parse(recognizer.result());
    const spoken = result.text.toLowerCase().trim();
    console.log("Dijiste:", spoken);
    handleCommand(spoken);
  }
});

function handleCommand(command) {
  const combo = keyBindings[command];
  if (combo) {
    const key = combo.pop(); // Última es la tecla
    console.log(`⏺️ Ejecutando: ${combo.join('+')}+${key}`);
    robot.keyTap(key, combo);
  } else {
    console.log("❌ Comando no reconocido.");
  }
}

micInstance.start();
console.log("🎙️ Escuchando comandos de voz para atajos de teclado...");
