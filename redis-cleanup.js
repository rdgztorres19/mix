const Redis = require('ioredis');

const REDIS_HOST = '192.168.1.72';
const REDIS_PORT = 6379; // Default Redis port
const KEY_PREFIX = 'sess';

/**
 * Connects to Redis and deletes all keys with the specified prefix
 * Uses SCAN instead of KEYS for better performance with large datasets
 */
async function deleteKeysWithPrefix() {
    // Create Redis client
    const client = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    client.on('connect', () => {
        console.log(`✅ Connected to Redis at ${REDIS_HOST}:${REDIS_PORT}`);
    });

    client.on('error', (err) => {
        console.error('❌ Redis Client Error:', err);
        process.exit(1);
    });

    try {
        const pattern = `${KEY_PREFIX}*`;
        console.log(`🔍 Searching for keys with pattern: ${pattern}`);
        
        // Use SCAN to find all keys (better for production than KEYS)
        const keys = [];
        let cursor = '0';
        
        do {
            const [nextCursor, foundKeys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            keys.push(...foundKeys);
        } while (cursor !== '0');
        
        if (keys.length === 0) {
            console.log('ℹ️  No keys found with that prefix');
            await client.quit();
            return;
        }

        console.log(`📋 Found ${keys.length} key(s) to delete:`);
        keys.forEach((key, index) => {
            console.log(`   ${index + 1}. ${key}`);
        });

        // Delete all keys in batches for better performance
        if (keys.length > 0) {
            // Delete in batches of 100
            const batchSize = 100;
            let deletedCount = 0;
            
            for (let i = 0; i < keys.length; i += batchSize) {
                const batch = keys.slice(i, i + batchSize);
                const count = await client.del(...batch);
                deletedCount += count;
            }
            
            console.log(`✅ Successfully deleted ${deletedCount} key(s)`);
        }

        // Close connection
        await client.quit();
        console.log('🔌 Disconnected from Redis');
        
    } catch (error) {
        console.error('❌ Error:', error);
        await client.quit();
        process.exit(1);
    }
}

// Run the cleanup
deleteKeysWithPrefix();

