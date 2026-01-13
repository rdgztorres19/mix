const mqtt = require('mqtt');
const fs = require('fs');

// Configuración del broker MQTT
const MQTT_CONFIG = {
    host: '192.168.1.40',
    port: 8883,
    username: 'admin',
    password: 'password',
    useTls: true,
    tlsInsecure: true
};

// Opciones de conexión
const options = {
    host: MQTT_CONFIG.host,
    port: MQTT_CONFIG.port,
    protocol: MQTT_CONFIG.useTls ? 'mqtts' : 'mqtt',
    username: MQTT_CONFIG.username,
    password: MQTT_CONFIG.password,
    
    // Opciones TLS
    rejectUnauthorized: !MQTT_CONFIG.tlsInsecure, // false = acepta certificados self-signed
    
    // Opciones de conexión
    clientId: `mqtt_subscriber_${Math.random().toString(16).substr(2, 8)}`,
    clean: true,
    connectTimeout: 10000,
    reconnectPeriod: 5000,
    keepalive: 60,
    
    // Opciones de calidad
    qos: 0,
    retain: false
};

console.log('='.repeat(70));
console.log('🚀 Iniciando cliente MQTT');
console.log('='.repeat(70));
console.log(`📡 Broker: ${MQTT_CONFIG.host}:${MQTT_CONFIG.port}`);
console.log(`🔐 Usuario: ${MQTT_CONFIG.username}`);
console.log(`🔒 TLS: ${MQTT_CONFIG.useTls ? 'Habilitado' : 'Deshabilitado'}`);
console.log(`⚠️  TLS Insecure: ${MQTT_CONFIG.tlsInsecure ? 'Si (ignora certificados)' : 'No'}`);
console.log('='.repeat(70));
console.log();

// Crear cliente MQTT
const client = mqtt.connect(options);

// Contador de mensajes
let messageCount = 0;
const messagesByTopic = {};
const startTime = Date.now();

// Evento: Conexión establecida
client.on('connect', () => {
    console.log('✅ Conectado al broker MQTT');
    console.log(`🆔 Client ID: ${options.clientId}`);
    console.log();
    
    // Suscribirse a todos los topics
    const allTopics = '#'; // '#' es el wildcard que captura todos los topics
    
    client.subscribe(allTopics, { qos: 0 }, (err, granted) => {
        if (err) {
            console.error('❌ Error al suscribirse:', err.message);
            return;
        }
        
        console.log('✅ Suscrito exitosamente a todos los topics (#)');
        console.log('📊 Detalles de la suscripción:');
        granted.forEach(sub => {
            console.log(`   - Topic: ${sub.topic}, QoS: ${sub.qos}`);
        });
        console.log();
        console.log('👂 Esperando mensajes...');
        console.log('='.repeat(70));
        console.log();
    });
});

// Evento: Mensaje recibido
client.on('message', (topic, message, packet) => {
    messageCount++;
    
    // Llevar cuenta por topic
    if (!messagesByTopic[topic]) {
        messagesByTopic[topic] = 0;
    }
    messagesByTopic[topic]++;
    
    const timestamp = new Date().toISOString();
    const messageStr = message.toString();
    
    // Intentar parsear como JSON
    let parsedMessage;
    let isJson = false;
    try {
        parsedMessage = JSON.parse(messageStr);
        isJson = true;
    } catch (e) {
        parsedMessage = messageStr;
    }
    
    // Mostrar información del mensaje
    console.log('📨 Nuevo mensaje recibido');
    console.log(`   ⏰ Timestamp: ${timestamp}`);
    console.log(`   📍 Topic: ${topic}`);
    console.log(`   📏 Tamaño: ${message.length} bytes`);
    console.log(`   🔢 QoS: ${packet.qos}`);
    console.log(`   📌 Retain: ${packet.retain}`);
    console.log(`   📦 Formato: ${isJson ? 'JSON' : 'Texto/Binario'}`);
    console.log(`   💬 Payload:`);
    
    if (isJson) {
        console.log(JSON.stringify(parsedMessage, null, 2).split('\n').map(line => '      ' + line).join('\n'));
    } else {
        // Limitar la salida si el mensaje es muy largo
        if (messageStr.length > 200) {
            console.log(`      ${messageStr.substring(0, 200)}... (truncado)`);
        } else {
            console.log(`      ${messageStr}`);
        }
    }
    
    console.log(`   📊 Total mensajes: ${messageCount}`);
    console.log('-'.repeat(70));
    console.log();
});

// Evento: Error
client.on('error', (error) => {
    console.error();
    console.error('❌ Error MQTT:', error.message);
    console.error();
});

// Evento: Reconexión
client.on('reconnect', () => {
    console.log('🔄 Reconectando al broker...');
});

// Evento: Desconexión
client.on('close', () => {
    console.log();
    console.log('🔌 Desconectado del broker MQTT');
});

// Evento: Fuera de línea
client.on('offline', () => {
    console.log('📵 Cliente fuera de línea');
});

// Evento: Fin
client.on('end', () => {
    console.log();
    console.log('='.repeat(70));
    console.log('🏁 Cliente MQTT finalizado');
    console.log('='.repeat(70));
    printStatistics();
});

// Función para imprimir estadísticas
function printStatistics() {
    const uptime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log();
    console.log('📊 ESTADÍSTICAS:');
    console.log(`   ⏱️  Tiempo activo: ${uptime} segundos`);
    console.log(`   📨 Total mensajes recibidos: ${messageCount}`);
    console.log(`   📍 Topics únicos: ${Object.keys(messagesByTopic).length}`);
    
    if (Object.keys(messagesByTopic).length > 0) {
        console.log();
        console.log('   📋 Mensajes por topic:');
        
        // Ordenar por cantidad de mensajes
        const sortedTopics = Object.entries(messagesByTopic)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20); // Mostrar solo los top 20
        
        sortedTopics.forEach(([topic, count]) => {
            const percentage = ((count / messageCount) * 100).toFixed(1);
            console.log(`      ${topic}: ${count} (${percentage}%)`);
        });
        
        if (Object.keys(messagesByTopic).length > 20) {
            console.log(`      ... y ${Object.keys(messagesByTopic).length - 20} topics más`);
        }
    }
    
    console.log('='.repeat(70));
}

// Manejo de señales de terminación
process.on('SIGINT', () => {
    console.log();
    console.log('⚠️  Señal de interrupción recibida (Ctrl+C)');
    console.log('🛑 Cerrando conexión...');
    
    client.end(false, () => {
        printStatistics();
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log();
    console.log('⚠️  Señal de terminación recibida');
    console.log('🛑 Cerrando conexión...');
    
    client.end(false, () => {
        printStatistics();
        process.exit(0);
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    console.error();
    console.error('❌ Error no capturado:', error);
    console.error();
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error();
    console.error('❌ Promise rechazada no manejada:', reason);
    console.error();
});

// Exportar cliente para uso programático
module.exports = client;

