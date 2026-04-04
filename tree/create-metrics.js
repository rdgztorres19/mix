const axios = require("axios");

const API_URL = "http://localhost:8089/api/v2";
const PARENT_ID = 7937727343495168;
const TOTAL_METRICS = 60000;
const BASE_NAME = "IOTConnector_ASSET3.Device3.UtcTime31";

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
        headers: {
          "content-type": "application/json",
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