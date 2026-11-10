import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AccesoActorGuard } from './acceso-actor.guard';
import { ActorAuthController } from './actor-auth.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUD_ADMIN, JWT_ISSUER } from './jwt.constants';
import { JwtAuthGuard } from './jwt-auth.guard';
import { SesionService } from './sesion.service';
import { SoloActorGuard } from './solo-actor.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Valores por defecto = admin. Los tokens de actor usan opciones explícitas (jwt.constants.ts).
        signOptions: { expiresIn: '8h', algorithm: 'HS256', issuer: JWT_ISSUER, audience: AUD_ADMIN },
        verifyOptions: { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: AUD_ADMIN },
      }),
    }),
  ],
  controllers: [AuthController, ActorAuthController],
  providers: [AuthService, SesionService, JwtAuthGuard, AccesoActorGuard, SoloActorGuard],
  exports: [JwtModule, SesionService, JwtAuthGuard, AccesoActorGuard, SoloActorGuard],
})
export class AuthModule {}
