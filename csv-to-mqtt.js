const fs = require('fs');
const csv = require('csv-parser');
const mqtt = require('mqtt');

const brokerUrl = "mqtt://66.179.188.92:1883";
// const brokerUrl = "mqtts://broker.testing-branch.sorba.ai:8883";

const mqttOptions = {
  username: "admin",
  password: "HvD1P875vJbb5a9iGURZ6QpEd5anSIBApps5P9g114jsrtCscY",
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
    const csvFilePath = 'MOTOR_BEARING_PROBLEM_DS_part1.csv'; // Cambia por la ruta de tu archivo CSV
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
  if (currentIndex == rows.length - 1) {
    currentIndex = 0;
    
  }
  const currentRow = rows[currentIndex];

  const tags = [
    { path: "Current", value: currentRow[1] },
    { path: "Freq", value: currentRow[2] },
    { path: "Power", value: currentRow[3] },
    { path: "Scale_Speed", value: currentRow[4] },
    { path: "Torque", value: currentRow[5] },
    { path: "Voltage_AC", value: currentRow[6] }
  ];

  const values = [];

  for (const [path, input] of pathMap.entries()) {
    const pathElements = path.split('/');
    const lastElement = pathElements[pathElements.length - 1];

    const tag = tags.find(tag => tag.path === lastElement);
    if (tag) {
      values.push({ path, value: tag.value });
    }
  }

  client.publish('sorba_ignition/tags/outputs/realtime', JSON.stringify(values), (err) => {
    if (err) {
      console.error('Error al publicar en MQTT:', err);
    } else {
    }
  });

  // Incrementar el índice y procesar la siguiente fila después de 1 segundo
  currentIndex++;
  setTimeout(processRows, 1000);
};
