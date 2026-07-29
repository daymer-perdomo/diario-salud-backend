import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Render (y proveedores similares) ponen la app detras de un proxy --
  // sin esto, req.ip refleja al proxy, no al cliente real, y tanto el
  // rate limiting del chatbot (ChatRateLimiterService) como el ipHash
  // guardado en ChatSession quedarian mal.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Diario de la Salud API escuchando en el puerto ${port}`, 'Bootstrap');
}

bootstrap();
