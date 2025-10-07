const IORedis = require('ioredis');

(async () => {
  try {
    // Create Redis clients
    const subscriber = new IORedis({
      host: '192.168.1.205',
      port: 6379
    });

    const redisClient = new IORedis({
      host: '192.168.1.205',
      port: 6379
    });

    // Listen for connection or error events
    subscriber.on('connect', () => console.log('Subscriber connected to Redis'));
    redisClient.on('connect', () => console.log('Redis client connected'));

    subscriber.on('error', (err) => console.error('Subscriber Redis Error:', err));
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));

    // Subscribe to "write_queue" channel
    subscriber.subscribe('write_queue', (err, count) => {
      if (err) {
        console.error('Subscription error:', err);
      } else {
        console.log(`Successfully subscribed to ${count} channel(s).`);
      }
    });

    // Handle incoming messages
    subscriber.on('message', async (channel, message) => {
      console.log(`Received message from "${channel}": ${message}`);

      try {
        const parsedData = JSON.parse(message);

        const newMessage = {
            id: parsedData.id,
            timestamp: Date.now(),
            value: parsedData.value,
            dataValue: parsedData.value,
            quality: 1
        }

        if (!parsedData.id) {
          console.error('Invalid message format: Missing "id" field');
          return;
        }

        const key = `rt_data:${newMessage.id}`;
        await redisClient.set(key, JSON.stringify(newMessage));

        if (newMessage.id == 3224154485982208) {
            await redisClient.publish('read_queue', JSON.stringify(newMessage));
            const storedData = await redisClient.get(key);
            const parsedStoredData = JSON.parse(storedData);
            console.log(`Retrieved data from Redis with key: ${key}`);
        }
        
        console.log(`Stored data in Redis with key: ${key}`);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });
  } catch (err) {
    console.error('Error:', err);
  }
})();
