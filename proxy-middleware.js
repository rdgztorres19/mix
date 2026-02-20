const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3001;

// Token de autorización
const token = process.env.GRAFANA_TOKEN || (() => { throw new Error('GRAFANA_TOKEN environment variable is required'); })();

// Configuración del proxy para el endpoint /dashboard
const dashboardProxy = createProxyMiddleware('/dashboard_a', {
  target: 'https://platform.test.sorbapp.com',
  changeOrigin: true,
  secure: true,
  logLevel: 'debug',
  onProxyReq: (proxyReq, req, res) => {
    // Agregar el header de autorización Bearer
    proxyReq.setHeader('Authorization', `Bearer ${token}`);
    console.log(`Proxying ${req.method} ${req.url} to ${proxyReq.getHeader('host')}${proxyReq.path}`);
    console.log(`Authorization header added: Bearer ${token.substring(0, 10)}...`);
  },
  onProxyRes: (proxyRes, req, res) => {
    console.log(`Response from target: ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).send('Proxy error occurred');
  }
});

// Aplicar el middleware de proxy
app.use('/dashboard_a', dashboardProxy);

// Endpoint de salud para verificar que el servidor está funcionando
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Proxy server is running',
    timestamp: new Date().toISOString()
  });
});

// Endpoint de información sobre las rutas disponibles
app.get('/', (req, res) => {
  res.json({
    message: 'Proxy Middleware Server',
    endpoints: {
      '/dashboard': 'Proxies to https://platform.test.sorbapp.com/dashboard with Bearer token',
      '/health': 'Health check endpoint'
    },
    port: PORT
  });
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`📊 Dashboard proxy: http://localhost:${PORT}/dashboard -> https://platform.test.sorbapp.com/dashboard`);
  console.log(`🔑 Authorization token configured`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
});

module.exports = app;