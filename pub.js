const mqtt = require('mqtt');

// Configuración del broker MQTT
const brokerUrl = 'mqtt://broker.hivemq.com:1883';
const topic = 'mi/topico/prueba';

// Conectar al broker
const client = mqtt.connect(brokerUrl);

client.on('connect', () => {
    console.log('Conectado a MQTT');

    // Suscribirse a un tópico
    client.subscribe(topic, (err) => {
        if (!err) {
            console.log(`Suscrito al tópico: ${topic}`);
        } else {
            console.error('Error al suscribirse:', err);
        }
    });

    // Publicar un mensaje en el tópico
    setInterval(() => {
        const message = `Mensaje enviado a las ${new Date().toLocaleTimeString()}`;
        client.publish(topic, message);
        console.log(`Publicado: ${message}`);
    }, 5000);
});

// Manejo de mensajes recibidos
client.on('message', (receivedTopic, message) => {
    console.log(`Mensaje recibido en ${receivedTopic}: ${message.toString()}`);
});

// Manejo de errores
client.on('error', (err) => {
    console.error('Error de conexión:', err);
});