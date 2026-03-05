"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
require("reflect-metadata");
const _core = require("@nestjs/core");
const _common = require("@nestjs/common");
const _appmodule = require("./app.module");
async function bootstrap() {
    const app = await _core.NestFactory.create(_appmodule.AppModule);
    app.useGlobalPipes(new _common.ValidationPipe({
        whitelist: true,
        transform: true
    }));
    app.enableCors();
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`Trading Agent API running on http://localhost:${port}`);
    console.log(`  POST /agent/analyze    - Analyze a ticker`);
    console.log(`  GET  /scanner/watchlist - Get today's watchlist`);
}
bootstrap();

//# sourceMappingURL=main.js.map