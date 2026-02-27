const Redis = require('ioredis');

// Conexión solo para escanear CLIENT LIST
const scanRedis = new Redis({
  host: '192.168.1.118',
  port: 6379,
  db: 0,
  disableClientInfo: true,
});

// Conexión separada solo para MONITOR
const monitorRedis = new Redis({
  host: '192.168.1.118',
  port: 6379,
  db: 0,
  disableClientInfo: true,
});

const knownClients = new Set();
const newClients = new Set();
let initialized = false;

async function refreshClients() {
  try {
    const list = await scanRedis.client('LIST');
    const lines = list.split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split(' ');
      const addrPart = parts.find((p) => p.startsWith('addr='));
      if (!addrPart) continue;

      const addr = addrPart.split('=')[1]; // ip:port

      // Primer escaneo: solo rellenar knownClients (baseline)
      if (!initialized) {
        knownClients.add(addr);
        continue;
      }

      // A partir del segundo escaneo: detectar y registrar solo nuevos
      if (!knownClients.has(addr)) {
        knownClients.add(addr);
        newClients.add(addr);
        console.log('Nuevo cliente detectado:', addr);
      }
    }

    // Después del primer refresh exitoso marcamos como inicializado
    if (!initialized) {
      initialized = true;
      console.log('Escaneo inicial completado, empezando a detectar nuevos clientes.');
    }
  } catch (err) {
    console.error('Error al ejecutar CLIENT LIST:', err);
  }
}

scanRedis.on('connect', () => {
  console.log('Conectado a Redis (scan) en 192.168.1.118:6379');
  // Ejecutar CLIENT LIST al principio
  refreshClients();
  // Y luego cada 1 segundo
  setInterval(refreshClients, 1000);
});

scanRedis.on('error', (err) => {
  console.error('Error en Redis (scan):', err);
});

monitorRedis.on('connect', () => {
  console.log('Conectado a Redis (monitor) en 192.168.1.118:6379');
});

monitorRedis.on('error', (err) => {
  console.error('Error en Redis (monitor):', err);
});

monitorRedis.monitor((err, monitor) => {
  if (err) {
    console.error('Error al activar monitor:', err);
    return;
  }

  console.log('Monitor de Redis activado.');

  monitor.on('monitor', (time, args, source, database) => {
    // Solo loguear comandos de clientes nuevos detectados
    if (source && newClients.has(source)) {
      console.log('Hora:', time);
      console.log('Cliente (source):', source);
      console.log('Base de datos:', database);
      console.log('Comando:', args);
      console.log('-----------------------------');
    }
  });
});

