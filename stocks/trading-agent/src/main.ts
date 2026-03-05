import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Trading Agent API running on http://localhost:${port}`);
  console.log(`  POST /agent/analyze    - Analyze a ticker`);
  console.log(`  GET  /scanner/watchlist - Get today's watchlist`);
}

bootstrap();
