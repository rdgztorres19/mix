const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const https = require('https');

const app = express();
const PORT = 3040;

const proxy = createProxyMiddleware({
    target: 'https://localhost:8243',
    changeOrigin: true,
    secure: false,
    pathRewrite: (path, req) => `/tree/v1/operations/${req.params.id}/events`,
    ws: false,
    logLevel: 'debug',
    onProxyReq(proxyReq, req, res) {
        // proxyReq.once('response', () => {
        //     res.once('close', () => {
        //         console.log('close');
        //         proxyReq.destroy();
        //     });
        // });

        res.once('close', () => {
            proxyReq.destroy();
        });
    },
    onProxyRes: (proxyRes, req, res) => {
        console.log('onProxyRes');
    },
    agent: new https.Agent({ rejectUnauthorized: false })
});

app.use('/source/:id', proxy);


app.listen(PORT, () => {
    console.log(`EventSource proxy server running on http://localhost:${PORT}/events/${Date.now()}`);
    console.log(`Use /source/{id} to proxy SSE to https://localhost:8243/tree/v1/operations/{id}`);
}); 