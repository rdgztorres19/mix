const axios = require('axios');
const fs = require('fs');
const https = require('https');
const FormData = require('form-data');
const { default: PromisePool } = require('@supercharge/promise-pool');

class DatasetService {
    constructor(options) {
        // options debe incluir { url, token }
        this.options = options;
        // Se establece el basePath fijo
        this.basePath = '/ml/v1';

        // Crear un agente HTTPS que ignore certificados autofirmados
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });

        // Se configura la instancia de axios con el token de autorización
        this.axiosInstance = axios.create({
            baseURL: this.options.url, // https://20.190.196.94/gateway
            headers: {
                'Authorization': `Bearer ${this.options.token}`
            },
            httpsAgent
        });
    }

    async createDataset(tenant, dataset, datasetVersion, rules = [], filePath) {
        const url = this.basePath.concat(`/${tenant}/datasets`);
        // Crea el dataset
        await this.axiosInstance.post(url, dataset);
        // Crea las reglas asociadas
        await this.createRules(tenant, dataset.id, rules);
        // Obtiene las reglas creadas
        const rulesCreated = await this.findRulesOfDataset(tenant, dataset.id);
        // Actualiza datasetVersion con los ids de las reglas incluidas
        datasetVersion.includedRules = rulesCreated.map(rule => rule.id).join(",");
        // Crea la versión del dataset
        await this.createDatasetVersion(tenant, dataset.id, datasetVersion);
        // Procesa la versión del dataset (por ejemplo, para cargar un archivo)
        await this.postProcessDatasetVersion(
            tenant,
            dataset.id,
            datasetVersion.version,
            datasetVersion.datasource_type,
            true,
            0,
            0,
            filePath
        );
        return;
    }

    async createRules(tenant, datasetId, rules) {
        // Procesa las reglas con concurrencia máxima de 10
        await PromisePool
            .withConcurrency(10)
            .for(rules)
            .process(async (rule) => {
                await this.createRule(tenant, datasetId, rule);
            });
        return;
    }

    async createRule(tenant, datasetId, rule) {
        // Implementa la lógica para crear una regla
        const url = this.basePath.concat(`/${tenant}/datasets/${datasetId}/rules`);
        await this.axiosInstance.post(url, rule);
        return;
    }

    async findRulesOfDataset(tenant, dataset) {
        const url = this.basePath.concat(`/${tenant}/datasets/${dataset}/rules`);
        const response = await this.axiosInstance.get(url);
        return response.data._embedded.rules;
    }

    async createDatasetVersion(tenant, datasetId, version) {
        const url = this.basePath.concat(`/${tenant}/datasets/${datasetId}/versions`);
        await this.axiosInstance.post(url, version);
        return;
    }

    async postProcessDatasetVersion(tenant, datasetId, version, datasourceType, postProcess = true, start = 0, end = 0, filePath) {
        const url = this.basePath.concat(`/${tenant}/datasets/${datasetId}/versions/${version}/data`);
        const formData = new FormData();
        if (datasourceType === "file") {
            formData.append('files', fs.createReadStream(filePath));
        }
        // Fusionamos el header de Authorization en la petición PUT
        await this.axiosInstance.put(url, formData, {
            params: {
                postprocess: postProcess,
                datasource_type: datasourceType,
                start: start,
                end: end
            },
            headers: {
                'Content-Type': 'multipart/form-data',
                'Authorization': `Bearer ${this.options.token}`
            }
        });
    }
}

// Configuración de opciones, incluyendo la URL y el token de autorización
const options = {
    url: 'https://20.190.196.94/gateway',
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoieXJhbW9zQHNvcmJhLmFpIiwidXNlcklkIjoiMlFfVnFfdWxsVFl3Iiwic2NvcGUiOlsiYWRtaW4iXSwiYXV0aG9yaXplZCI6dHJ1ZSwiaWF0IjoxNzQwOTMwNjMyLCJleHAiOjE3NDA5NDUwMzJ9.ymT43d5KmO_dDUH2mQSni1kTxp0Un21pzlIFZjUsjVU' // Reemplaza 'tuBearerToken' por el token real
};

// Crea una instancia de DatasetService
const datasetService = new DatasetService(options);

// Datos de ejemplo
const tenant = "sorba_sde";

const dataset = {
    application_type: "numerical_analysis",
    description: "",
    source: "file",
    database: "",
    post_processed: true,
    post_processed_error: "error",
    timestamp_field: "file",
    timestamp_format: "unix",
    timestamp_tzone: "",
    fieldsForm: [
        {
            action: "DISCARD",
            included: true,
            fields_replace_null_with_value: 0,
            hl: null,
            ll: null,
            name: "Device_1.IGNITION.Cluster3.INPUTS.Current",
        },
        {
            action: "DISCARD",
            included: true,
            fields_replace_null_with_value: 0,
            hl: null,
            ll: null,
            name: "Device_1.IGNITION.Cluster3.INPUTS.Freq",
        },
        {
            action: "DISCARD",
            included: true,
            fields_replace_null_with_value: 0,
            hl: null,
            ll: null,
            name: "Device_1.IGNITION.Cluster3.INPUTS.Power",
        },
        {
            action: "DISCARD",
            included: true,
            fields_replace_null_with_value: 0,
            hl: null,
            ll: null,
            name: "Device_1.IGNITION.Cluster3.INPUTS.Scale_Speed",
        },
        {
            action: "DISCARD",
            included: true,
            fields_replace_null_with_value: 0,
            hl: null,
            ll: null,
            name: "Device_1.IGNITION.Cluster3.INPUTS.Torque",
        },
        {
            action: "DISCARD",
            included: true,
            fields_replace_null_with_value: 0,
            hl: null,
            ll: null,
            name: "Device_1.IGNITION.Cluster3.INPUTS.Voltage_AC",
        },
    ],
    fields: "[{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Current\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Freq\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Power\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Scale_Speed\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Torque\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Voltage_AC\"}]",
    advance: "{\"correlation\":1,\"tag_ranking\":0,\"data_quality\":1,\"data_drift\":1,\"data_quality_info\":{\"acceptanceRate\":3,\"filterBasedOnOutOfRange\":0,\"filterBasedOnOutlier\":0},\"correlation_info\":{\"filterBasedOnCorrelation\":0,\"correlationValue\":0.9},\"tag_ranking_info\":{\"filterBasedOnTagranking\":0,\"tagRankingValue\":5},\"data_drift_info\":{\"reference_size\":0.5}}",
    measurement: "",
    datasource_type: "file",
    start: 0,
    end: 0,
    user: "admin",
    name: "Cluster3",
    id: "Cluster3-6324818532",
};

const datasetVersion = {
    range: "0,1",
    version: "1.0.0",
    datasource_type: "file",
    timestamp_format: "unix",
    timestamp_tzone: "",
    timestamp_field: "Timestamp",
    fields: "[{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Current\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Freq\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Power\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Scale_Speed\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Torque\"},{\"action\":\"DISCARD\",\"included\":true,\"fields_replace_null_with_value\":0,\"hl\":null,\"ll\":null,\"name\":\"Device_1.IGNITION.Cluster3.INPUTS.Voltage_AC\"}]",
    advance: "{\"correlation\":1,\"tag_ranking\":0,\"data_quality\":1,\"data_drift\":1,\"data_quality_info\":{\"acceptanceRate\":3,\"filterBasedOnOutOfRange\":0,\"filterBasedOnOutlier\":0},\"correlation_info\":{\"filterBasedOnCorrelation\":0,\"correlationValue\":0.9},\"tag_ranking_info\":{\"filterBasedOnTagranking\":0,\"tagRankingValue\":5},\"data_drift_info\":{\"reference_size\":0.5}}",
    description: "",
    includedRules: "",
    user: "admin",
};


const rules = [];

// Ruta al archivo que se enviará (asegúrate que la ruta exista y sea accesible)
const filePath = 'historical_1740930678110.csv';

// Llama a la función createDataset y maneja la promesa
datasetService.createDataset(tenant, dataset, datasetVersion, rules, filePath)
    .then(() => {
        console.log('Dataset creado exitosamente.');
    })
    .catch(err => {
        console.error('Error al crear el dataset:', err);
    });