// npm install soap moment
const soap = require('soap');

// Configuración de credenciales y WSDL
const KAREO_USER = 'yozamyd@gmail.com';
const KAREO_CUSTOMER_KEY = 'c64xz78ip32n';
const KAREO_PASSWORD = 'Chispita123*12345';
const KAREO_WSDL = 'https://webservice.kareo.com/services/soap/2.1/KareoServices.svc?singleWsdl';

const wsdlOptions = {
    ignoredNamespaces: {
        namespaces: ['xmlns', 'xsi', 'msc', /^q\d+$/],
        override: true
    },
    overrideRootElement: {
        namespace: 'tns',
        xmlnsAttributes: [{
            name: 'xmlns:tns',
            value: 'http://www.kareo.com/api/schemas/'
        }]
    }
};

(async () => {
    // 1) Crea el cliente a partir del WSDL
    const client = await soap.createClientAsync(KAREO_WSDL, wsdlOptions);


    // 3) Log para verificar el XML saliente
    client.on('request', xml => {
        //console.log('=== OUTGOING XML ===\n', xml);
    });

    // 4) Monta tu <request> igual que en axios
    const args = {
        request: {
            RequestHeader: {
                ClientVersion: 'v1',
                CustomerKey: KAREO_CUSTOMER_KEY,
                Password: KAREO_PASSWORD,
                User: KAREO_USER
            },
            Fields: {},
            Filter: {}
        }
    };

    // 5) Llama a GetPractices
    const result = await client.GetPracticesAsync(args);
    console.log('=== GetPractices Result ===\n', result[0].GetPracticesResult.Practices);
})();