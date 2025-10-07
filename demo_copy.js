const fs = require('fs');
const csv = require('csv-parser');
const mqtt = require('mqtt');

// const brokerUrl = "mqtt://20.190.196.94:1883";
const brokerUrl = "mqtt://66.179.188.92:1883";

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
  if (rows.length === 0) return;

  if (currentIndex >= rows.length) {
    currentIndex = 0; // Reinicia si llegamos al final
  }

  const currentRow = rows[currentIndex];

  const tags = [
    { path: "Ref/Current", value: currentRow[1] },
    { path: "Ref/Freq", value: currentRow[2] },
    { path: "Ref/Power", value: currentRow[3] },
    { path: "Ref/Scale_Speed", value: currentRow[4] },
    { path: "Ref/Torque", value: currentRow[5] },
    { path: "Ref/Voltage_AC", value: currentRow[6] }
  ];

  let tagIndex = 0;

  const publishNextTag = () => {
    if (tagIndex >= tags.length) {
      currentIndex++; // Pasamos a la siguiente fila una vez se envían todos los valores
      setTimeout(processRows, 200); // Espera 2 segundos antes de empezar con la siguiente fila
      return;
    }

    console.log(`Publicando ${tags[tagIndex].path} con valor ${tags[tagIndex].value}`);

    const tag = tags[tagIndex];
    client.publish(tag.path, String(tag.value), (err) => {
      if (err) {
        console.error('Error al publicar en MQTT:', err);
      }
    });

    tagIndex++;
    setTimeout(publishNextTag, 200); // Publica el siguiente valor después de 2 segundos
  };

  publishNextTag();
};

