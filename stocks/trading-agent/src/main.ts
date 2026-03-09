import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Increase body limit for predict endpoint (candle history arrays for live mode)
  app.use(json({ limit: '5mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableCors();
  app.useWebSocketAdapter(new IoAdapter(app));
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
