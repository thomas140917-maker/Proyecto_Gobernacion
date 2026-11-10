import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás de nginx/Traefik: necesario para que el rate-limit use la IP real del cliente.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : process.env.TRUST_PROXY);
  }

  // Frontend (public/) + rutas /api/* del sitio. Se monta ANTES de helmet porque trae su propia CSP.
  // No toca /api/v1 ni /api/docs: esas rutas siguen siendo las de la API original.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../web').montar(app.getHttpAdapter().getInstance());

  const swaggerOn = process.env.SWAGGER_ENABLED === 'true';
  // La CSP por defecto de helmet rompe Swagger UI; solo se relaja si Swagger está activo.
  app.use(helmet({ contentSecurityPolicy: swaggerOn ? false : undefined }));

  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()) : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['Content-Disposition', 'X-Certificado-Codigo'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  if (swaggerOn) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Centro Actoral de Boyacá - API')
        .setVersion('0.2.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  await app.listen(Number(process.env.PORT) || 3000, '0.0.0.0');
}
bootstrap();
