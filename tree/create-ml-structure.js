const axios = require("axios");
const https = require("https");

// const API_URL = "https://172.175.64.215/gateway/tree/v1/api/v2";
// const API_URL = "http://192.168.1.29:8089/api/v2";
const API_URL = "https://localhost:8243/tree/v1/api/v2";
// const PARENT_ID = 3187042021949440;
const PARENT_ID = 5774302388598784;
const TOTAL_INPUTS = 200000;
// const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoieXJhbW9zQHNvcmJhLmFpIiwidXNlcklkIjoiWVYyd0FPb0lubEpNIiwic2NvcGUiOlsiYWRtaW4iXSwiYXV0aG9yaXplZCI6dHJ1ZSwiaW5zdGFuY2VJZCI6ImhxOXE3bFRZZWR1MkJ1cnEiLCJpYXQiOjE3NzU0OTIxNTYsImV4cCI6MTc3NTUwNjU1Nn0.jwLF-LznnpIm7ehEhcXIwMNx3edmuzqo6w1EY-pOUhA";
// const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoieXJhbW9zQHNvcmJhLmFpIiwidXNlcklkIjoiZjQybDBzbm5MZFdPIiwic2NvcGUiOlsiYWRtaW4iXSwiYXV0aG9yaXplZCI6dHJ1ZSwiaW5zdGFuY2VJZCI6Ikt1NWJ3ZkVLQTJJcU9DdTIiLCJpYXQiOjE3NzU0OTIwNjYsImV4cCI6MTc3NTUwNjQ2Nn0.Xf7Es_UbuL1pdMjC0mO_hXuM-C23wjrMTOd-uB2uo-M";
const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoibXJvZHJpZ3VlejFAc29yYmEuYWkiLCJ1c2VySWQiOiJFNHJtNk91ZWd2OGYiLCJzY29wZSI6WyJhZG1pbiJdLCJhdXRob3JpemVkIjp0cnVlLCJpbnN0YW5jZUlkIjoidlZXSzJJc2M5WC1kV2ZSTyIsImlhdCI6MTc3NTU3OTcxOCwiZXhwIjoxNzc1NTk0MTE4fQ.MpGa6tT5dofL6PvlGGWQXdLYy-P1TKLJRgGMtWs7SR4";

const ASSET_LABEL = "ML_ASSET";
const MODEL_LABEL = "AAA";
const INPUTS_GROUP_LABEL = "INPUTS";
const INPUT_BASE_NAME = "input";

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function buildInputs(totalInputs) {
  const children = [];

  for (let i = 1; i <= totalInputs; i++) {
    const inputLabel = `${INPUT_BASE_NAME}_${i}`;

    children.push({
      label: inputLabel,
      path: `${ASSET_LABEL}.${MODEL_LABEL}.${INPUTS_GROUP_LABEL}.${inputLabel}`,
      type: "tag-v4",
      params: {
        type: "tag-v4",
        icon: "ionicons:pricetag-outline",
      },
      rollback: true,
      updateOnDuplicate: false,
      children: [],
    });
  }

  return children;
}

function buildBody(totalInputs) {
  const inputsChildren = buildInputs(totalInputs);

  return [
    {
      label: ASSET_LABEL,
      path: null,
      type: "asset-v4",
      params: {
        type: "asset-v4",
      },
      rollback: true,
      updateOnDuplicate: false,
      children: [
        {
          label: MODEL_LABEL,
          path: null,
          type: "tags-group-v4",
          params: {
            type: "tags-group-v4",
          },
          rollback: true,
          updateOnDuplicate: false,
          children: [
            {
              label: INPUTS_GROUP_LABEL,
              path: null,
              type: "tags-group-v4",
              params: {
                type: "tags-group-v4",
              },
              rollback: true,
              updateOnDuplicate: false,
              children: inputsChildren,
            },
          ],
        },
      ],
    },
  ];
}

async function createMlTags() {
  const body = buildBody(TOTAL_INPUTS);

  try {
    console.time("createMlTags");

    const response = await axios.post(
      `${API_URL}/metrics/${PARENT_ID}/ml-tags`,
      body,
      {
        httpsAgent,
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );

    console.timeEnd("createMlTags");
    console.log("ML tags creados correctamente.");

    if (response?.data) {
      console.log("Response:");
      console.log(response.data.data.length);
    }
  } catch (error) {
    console.error("Error creando ML tags:");

    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

createMlTags();