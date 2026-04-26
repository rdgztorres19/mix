#!/usr/bin/env node

const Redis = require('ioredis');

const redis = new Redis({
  host: 'localhost',
  port: 6379,
});

const topic = 'knowledge-store/init.node.diff.check.command';

const payload = JSON.stringify({
  content: { nodes: {} },
  context: {
    id: null,
    userId: null,
    resourceId: null,
    tenantId: null,
    connectionId: null,
    name: null,
    origin: null,
    resource: null,
    culture: null,
    createdAt: null,
    retries: 0,
  },
});

redis.publish(topic, payload, (err, count) => {
  if (err) {
    console.error('Error publishing:', err);
    process.exit(1);
  }
  console.log(`Published to "${topic}" — ${count} subscriber(s) received it`);
  redis.quit();
});
