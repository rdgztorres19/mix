const Redis = require('ioredis');

const KEY = 'operations:sync:d0d88429-28df-4a00-b3eb-5abd05300626';

async function main() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  try {
    const removed = await redis.rpop(KEY);
    if (removed === null) {
      console.log('La lista está vacía. No hay elementos que borrar.');
    } else {
      console.log('Elemento eliminado:', removed.toString());
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    redis.disconnect();
  }
}

main();
