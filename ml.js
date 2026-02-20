const http = require('http');
const httpProxy = require('http-proxy-middleware');
const express = require('express');

// Configurar múltiples proxies con diferentes puertos
const proxyConfigs = [
  {
    listenPort: 5556,
    target: 'http://192.168.1.74:5556',
    changeOrigin: true,
    ws: true,
    logLevel: 'info',
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).send('Proxy error');
    }
  },
  {
    listenPort: 4555,
    target: 'http://192.168.1.74:4555',
    changeOrigin: true,
    ws: true,
    logLevel: 'info',
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.status(500).send('Proxy error');
    }
  }
];

// Crear un Express app para cada configuración
proxyConfigs.forEach(config => {
  const app = express();
  const { listenPort, ...proxyOptions } = config;
  
  const proxy = httpProxy.createProxyMiddleware(proxyOptions);
  app.use('/', proxy);
  
  app.listen(listenPort, 'localhost', () => {
    console.log(`Proxy server running on http://localhost:${listenPort}`);
    console.log(`Forwarding requests to ${config.target}`);
  });
});