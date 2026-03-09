"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const express_1 = require("express");
const platform_socket_io_1 = require("@nestjs/platform-socket.io");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bodyParser: false });
    app.use((0, express_1.json)({ limit: '5mb' }));
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        transform: true,
    }));
    app.enableCors();
    app.useWebSocketAdapter(new platform_socket_io_1.IoAdapter(app));
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