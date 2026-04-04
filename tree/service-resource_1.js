const axios = require("axios");

const BASE_URL = "http://localhost:8089";

async function loadResources() {
  console.time("loadResources");
  const { data, headers } = await axios.post(`${BASE_URL}/api/v2/service-resource-nodes`, {
    action: "loadResources",
    source: "cloud-data-ingestion-v2",
    types: ["tag-v4"],
    fields: ["id", "label"],
    params: ["type", "typeID", "defaultValue"],
    includeAbsolutePath: true,
    filter: { "$and": [] }
  }, {
    headers: { "x-service": "test-script" }
  });

  const size = (Buffer.byteLength(JSON.stringify(data)) / 1024 / 1024).toFixed(2);
  count++;
  console.log(`Status: 200`);
  console.log(`Size: ${size} MB`);
  console.log(`Nodes: ${data.data?.nodes?.length || 0}`);
  console.log(`Count: ${count}`);
  console.timeEnd("loadResources");
}

// Primera ejecución al arrancar (opcional; quita si solo quieres esperar 10s primero)
loadResources().catch(console.error);

let count = 0;
// Cada 10 segundos
setInterval(() => {
  loadResources().catch(err => {
    console.error(err);
    process.exit(1);
  });
}, 10_000);