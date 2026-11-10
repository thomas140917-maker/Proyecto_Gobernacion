import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { ActoresModule } from './actores/actores.module';
import { HealthController } from './health/health.controller';
import { StorageModule } from './storage/storage.module';
import { MultimediaModule } from './multimedia/multimedia.module';
import { AdminModule } from './admin/admin.module';
import { ConvocatoriasModule } from './convocatorias/convocatorias.module';
import { PostulacionesModule } from './postulaciones/postulaciones.module';
import { CastingModule } from './casting/casting.module';
import { VitrinaModule } from './vitrina/vitrina.module';
import { CursosModule } from './cursos/cursos.module';
import { CertificadosModule } from './certificados/certificados.module';
import { ReportesModule } from './reportes/reportes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    MailModule,
    AuthModule,
    ActoresModule,
    StorageModule,
    MultimediaModule,
    AdminModule,
    ConvocatoriasModule,
    PostulacionesModule,
    CastingModule,
    VitrinaModule,
    CursosModule,
    CertificadosModule,
    ReportesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
