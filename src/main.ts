import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import basicAuth from 'express-basic-auth';
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

  const config = app.get(ConfigService);
  const swaggerUser = config.get<string>('SWAGGER_USER')!;
  const swaggerPassword = config.get<string>('SWAGGER_PASSWORD')!;
  const nodeEnv = config.get<string>('NODE_ENV');

  if (nodeEnv === 'production' && swaggerPassword === 'change-me-in-production') {
    Logger.warn(
      'SWAGGER_PASSWORD sigue en su valor por defecto en produccion -- la documentacion en /api quedaria protegida con una clave publica y conocida. Definir SWAGGER_USER/SWAGGER_PASSWORD reales.',
      'Bootstrap',
    );
  }

  // La API completa mezcla rutas de panel interno (JWT), integraciones
  // (API key propia) y endpoints publicos (chatbot, articles) -- la
  // documentacion en si misma no debe quedar abierta a cualquiera, por
  // eso se protege con Basic Auth antes de montar Swagger UI.
  app.use(
    ['/api', '/api-json'],
    basicAuth({ users: { [swaggerUser]: swaggerPassword }, challenge: true }),
  );

  const swaggerDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('EcoFarma API')
      .setDescription(
        'API del backend de EcoFarma: pipeline editorial "Diario de la Salud" (ingesta, ' +
          'reescritura con IA verificada, validacion humana, publicacion), inventario/e-commerce ' +
          '(WooCommerce, Distrimonaco) y chatbot de atencion al cliente.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'jwt',
      )
      .addApiKey(
        { type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'Clave de la API publica de articulos (PUBLIC_API_KEY)' },
        'public-api-key',
      )
      .addApiKey(
        { type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'Clave del plugin de WordPress (INTEGRATION_API_KEY)' },
        'integration-api-key',
      )
      .build(),
  );
  SwaggerModule.setup('api', app, swaggerDocument);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Diario de la Salud API escuchando en el puerto ${port}`, 'Bootstrap');
}

bootstrap();
