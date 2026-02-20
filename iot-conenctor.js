const fs = require('fs');
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

client.on('connect', () => {
  console.log('Conectado al broker MQTT');
  client.subscribe('sorba_ignition/tags/inputs/realtime', (err) => {
    if (err) {
      console.error('Error al suscribirse a los temas:', err);
    } else {
      console.log('Suscripción a todos los temas exitosa');
    }
  });
});

const pathMap = new Map();

client.on('message', (topic, message) => {
  const inputs = JSON.parse(message);

  for (const input of inputs) {
    if (input.path.includes("/INPUTS/")) {
      pathMap.set(input.path, input);
    }
  }
});

client.on('error', (error) => {
  console.error('Error en la conexión MQTT:', error);
});

// Variables globales
let rows = [];
let currentIndex = 0;

// Función principal
(async () => {
  try {
    console.log('Conexión a la base de datos establecida.');

    // Leer el archivo CSV
    const csvFilePath = 'MOTOR_BEARING_PROBLEM_DS_part1.csv';
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (data) => {
        rows.push([
          data['Timestamp'].replace('T', ' ').replace('Z', ''), // Formatear timestamp
          parseFloat(data['CURRENT']),
          parseFloat(data['FREQ']),
          parseFloat(data['POWER']),
          parseFloat(data['SCALE_SPEED']),
          parseFloat(data['TORQUE']),
          parseFloat(data['VOLTAGE_AC']),
        ]);
      })
      .on('end', async () => {
        console.log('CSV cargado. Comenzando a procesar...');
        processRows();
      })
      .on('error', (error) => {
        console.error('Error al leer el archivo CSV:', error);
      });
  } catch (error) {
    console.error('Error inicializando el programa:', error);
  }
})();

// Función para procesar las filas
const processRows = async () => {
  if (rows.length === 0) return;

  if (currentIndex >= rows.length) {
    currentIndex = 0; // Reinicia si llegamos al final
  }

  const currentRow = rows[currentIndex];

  // Crear objeto JSON con todos los campos
  const data = {
    timestamp: currentRow[0],
    current: currentRow[1],
    freq: currentRow[2],
    power: currentRow[3],
    scale_speed: currentRow[4],
    torque: currentRow[5],
    voltage_ac: currentRow[6]
  };

  // Publicar todo en formato JSON
  const jsonData = JSON.stringify(data);
  console.log(`Publicando datos: ${jsonData}`);

  client.publish('Sorba/MANUEL/ASSET_GROUP_1', jsonData, (err) => {
    if (err) {
      console.error('Error al publicar en MQTT:', err);
    }
  });

  currentIndex++;
  setTimeout(processRows, 1000); // Espera 1 segundo antes de la siguiente publicación
};