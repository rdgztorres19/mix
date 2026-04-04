#!/usr/bin/env node

/**
 * Llama al endpoint /metrics/auto-match con métricas T1 a T100
 * y mide el tiempo de respuesta.
 */

const apiUrl = 'http://localhost:8089/api/v2';
const rootID = 4789228967625728;

// Construir array de métricas T1, T2, ... T100
const metrics = [];
for (let i = 1; i <= 50000; i++) {
  metrics.push(`FDFF.AG_1_ASSET_1.GROUP_1.TAG_${i}`);
}

async function callAutoMatch() {
  const startTime = performance.now();

  const response = await fetch(`${apiUrl}/metrics/iot-connector-auto-suggestion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parentId:rootID,
      "nodeName": "MQTT Connector",
      metrics,
    }),
  });

  const endTime = performance.now();
  const duration = endTime - startTime;

  return {
    status: response.status,
    ok: response.ok,
    duration,
    body: await response.text(),
  };
}

async function main() {
  console.log('📡 Llamando a POST /metrics/auto-match');
  console.log(`   URL: ${apiUrl}/metrics/auto-match`);
  console.log(`   Métricas: ${metrics.length} items\n`);

  try {
    const result = await callAutoMatch();

    console.log('✅ Respuesta recibida:');
    console.log(`   Status: ${result.status}`);
    console.log(`   Duración: ${result.duration.toFixed(2)} ms`);
    console.log(`   Duración: ${(result.duration / 1000).toFixed(3)} s\n`);

    // Contador de elementos en matching por métrica
    let json;
    try {
      json = JSON.parse(result.body);
      // console.log(json[0].matching);
    } catch {
      console.log('   Body (raw):', result.body?.substring(0, 500));
      return;
    }

    const data = json?.data ?? [];
    console.log('📊 CONTADOR MATCHING POR MÉTRICA:');
    console.log('-'.repeat(50));

   console.log(data.slice(0, 5));
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
