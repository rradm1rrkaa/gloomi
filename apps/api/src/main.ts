import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { AppModule } from './modules/app.module';
import { webOrigins } from './modules/auth/web-origins';

async function bootstrap() {
  if (!process.env.DATABASE_URL && process.env.AWS_DB_SECRET_ARN) {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'eu-central-1' });
    const result = await client.send(new GetSecretValueCommand({ SecretId: process.env.AWS_DB_SECRET_ARN }));
    const secret = JSON.parse(result.SecretString || '{}') as { username:string; password:string; host:string; port:number; dbname:string };
    const database = encodeURIComponent(secret.dbname || process.env.DB_NAME || 'gloomi');
    process.env.DATABASE_URL = `postgresql://${encodeURIComponent(secret.username)}:${encodeURIComponent(secret.password)}@${secret.host}:${secret.port || process.env.DB_PORT || 5432}/${database}?schema=public&sslmode=require`;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL or AWS_DB_SECRET_ARN must be configured');
  if (!process.env.JWT_ACCESS_SECRET || Buffer.byteLength(process.env.JWT_ACCESS_SECRET) < 32 || !process.env.JWT_REFRESH_SECRET || Buffer.byteLength(process.env.JWT_REFRESH_SECRET) < 32) throw new Error('JWT secrets must each be at least 32 bytes');
  if (!process.env.EMAIL_CODE_PEPPER || Buffer.byteLength(process.env.EMAIL_CODE_PEPPER) < 32) throw new Error('EMAIL_CODE_PEPPER must be configured with at least 32 bytes');
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.getHttpAdapter().getInstance().set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : 0);
  app.enableCors({ origin: webOrigins(), credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'], methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
}
void bootstrap();
