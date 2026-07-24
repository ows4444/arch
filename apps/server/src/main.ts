import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RequestContextLogger } from './request-context/request-context-logger';

function corsOrigins(): string[] | boolean {
  const raw = process.env.CORS_ORIGIN;

  if (!raw) {
    return false;
  }

  if (raw === '*') {
    return true;
  }

  return raw.split(',').map((origin) => origin.trim());
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new RequestContextLogger(),
  });

  app.use(helmet());
  app.enableCors({ origin: corsOrigins() });
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Arch API')
    .setDescription('HTTP API for the arch monorepo')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
      responseInterceptor: (response: {
        url: string;
        status: number;
        text: string;
      }) => {
        const ui = (
          window as unknown as {
            ui: {
              preauthorizeApiKey: (name: string, key: string) => void;
              authActions: {
                logout: (names: string[]) => void;
                persistAuthorizationIfNeeded: () => void;
              };
            };
          }
        ).ui;

        if (
          response.status === 200 &&
          /\/auth\/(login|refresh)$/.test(response.url)
        ) {
          try {
            const body = JSON.parse(response.text) as { accessToken?: string };
            if (body.accessToken) {
              ui.preauthorizeApiKey('bearer', body.accessToken);
              ui.authActions.persistAuthorizationIfNeeded();
            }
          } catch {
            // ignore malformed auth response
          }
        }

        if (
          response.status === 204 &&
          /\/auth\/logout(-all)?$/.test(response.url)
        ) {
          ui.authActions.logout(['bearer']);
          ui.authActions.persistAuthorizationIfNeeded();
        }

        return response;
      },
    },
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
