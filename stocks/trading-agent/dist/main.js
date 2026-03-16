"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
require("reflect-metadata");
const _core = require("@nestjs/core");
const _common = require("@nestjs/common");
const _express = require("express");
const _platformsocketio = require("@nestjs/platform-socket.io");
const _appmodule = require("./app.module");
async function bootstrap() {
    const app = await _core.NestFactory.create(_appmodule.AppModule, {
        bodyParser: false
    });
    // Increase body limit for predict endpoint (candle history arrays for live mode)
    app.use((0, _express.json)({
        limit: '5mb'
    }));
    app.useGlobalPipes(new _common.ValidationPipe({
        whitelist: true,
        transform: true
    }));
    app.enableCors();
    app.useWebSocketAdapter(new _platformsocketio.IoAdapter(app));
    app.enableShutdownHooks();
    const port = process.env.PORT || 3033;
    await app.listen(port);
    console.log(`Trading Agent API running on http://localhost:${port}`);
    console.log(`  POST /agent/analyze     - Analyze a ticker`);
    console.log(`  POST /predict           - ML: ¿se puede operar?`);
    console.log(`  GET  /scanner/watchlist  - Get today's watchlist`);
    console.log(`  GET  /scanner/momo      - Top movers (momoscreener)`);
    console.log(`  GET  /scanner/dates     - Available MySQL dates (date picker)`);
    console.log(`  GET  /scanner/topmovers?date= - Top movers (momo or MySQL)`);
    console.log(`  GET  /scanner/pattern/:ticker - Get pattern (Replay)`);
}
bootstrap();

//# sourceMappingURL=main.js.map