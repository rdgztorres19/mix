const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mqtt = require('mqtt');

// const brokerUrl = "mqtt://20.190.196.94:1883";
const brokerUrl = "mqtt://4.174.130.135:1883";

const mqttOptions = {
  username: "admin",
  password: "sbrQp10",
  rejectUnauthorized: false,
  clean: true,
  connectTimeout: 10000,
  keepalive: 60
};

const client = mqtt.connect(brokerUrl, mqttOptions);

// Crear el directorio mqtt_debug si no existe
const debugDir = 'mqtt_debug';
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

client.on('connect', () => {
  console.log('Conectado al broker MQTT');
  client.subscribe('sorba_ignition/ixpsorba1/debug/udt-definitions-no-output-nodes-MOTOR_AD1', (err) => {
    if (err) {
      console.error('Error al suscribirse al tema:', err);
    } else {
      console.log('Suscripción exitosa a: sorba_ignition/ixpsorba1/tags/structures');
    }
  });
});

const pathMap = new Map();

client.on('message', (topic, message) => {
  const timestamp = new Date().toISOString();
  const messageStr = message.toString();
  
  console.log(`[${timestamp}] Mensaje recibido en ${topic}`);
  console.log('Contenido:', messageStr);
  
  // Crear nombre de archivo con timestamp
  const filename = `structures_${Date.now()}.json`;
  const filepath = path.join(debugDir, filename);
  
  // Crear objeto con metadata
  const debugData = {
    timestamp: timestamp,
    topic: topic,
    message: messageStr,
    messageLength: messageStr.length
  };
  
  // Escribir a archivo
  fs.writeFile(filepath, messageStr, (err) => {
    if (err) {
      console.error('Error escribiendo archivo:', err);
    } else {
      console.log(`Datos guardados en: ${filepath}`);
    }
  });
});

client.on('error', (error) => {
  console.error('Error en la conexión MQTT:', error);
});