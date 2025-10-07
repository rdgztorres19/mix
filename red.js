const Redis = require('ioredis');
const redis = new Redis({
    port: 6381
}); // configure if needed

async function countKeysWithPrefix(prefix) {
  let count = 0;
  let cursor = '0';

  do {
    const [newCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 1000);
    cursor = newCursor;
    count += keys.length;
  } while (cursor !== '0');

  return count;
}

countKeysWithPrefix('sess:')
  .then(count => console.log(`Total keys with prefix "sess:": ${count}`))
  .catch(console.error);