const axios = require("axios");
const https = require("https");

const API_URL = "https://172.175.64.215/gateway/tree/v1/api/v2";
const PARENT_ID = 3187042021949440;
const TOTAL_METRICS = 60000;
const BASE_NAME = "IOTConnector_ASSET3.Device3.UtcTime31";
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoieXJhbW9zQHNvcmJhLmFpIiwidXNlcklkIjoiWVYyd0FPb0lubEpNIiwic2NvcGUiOlsiYWRtaW4iXSwiYXV0aG9yaXplZCI6dHJ1ZSwiaW5zdGFuY2VJZCI6ImhxOXE3bFRZZWR1MkJ1cnEiLCJpYXQiOjE3NzU0OTIxNTYsImV4cCI6MTc3NTUwNjU1Nn0.jwLF-LznnpIm7ehEhcXIwMNx3edmuzqo6w1EY-pOUhA"; // Reemplaza con tu token de acceso si es necesario

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function createMetrics() {
  const metrics = [];

  for (let i = 1; i <= TOTAL_METRICS; i++) {
    metrics.push({
      name: `${BASE_NAME}_${i}`,
      dataType: 8,
      params: {
        enabled: 1,
        newattr: "newvalue",
      },
    });
  }

  try {
    console.time("createMetrics");
    const response = await axios.post(
      `${API_URL}/nodes/metrics`,
      {
        parent: PARENT_ID,
        metrics,
      },
      {
        httpsAgent,
        headers: {
          "content-type": "application/json",
          'Authorization': `Bearer ${token}` // Reemplaza con tu token de acceso si es necesario
        },
      }
    );
    console.timeEnd("createMetrics");
    console.log("Metrics creados correctamente:");
    console.log(response.data.data.length);
  } catch (error) {
    console.error("Error creando metrics:");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

createMetrics();