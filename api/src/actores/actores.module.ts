import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActoresController } from './actores.controller';
import { ActoresService } from './actores.service';
import { ActorPerfilController } from './perfil.controller';
import { PerfilService } from './perfil.service';

@Module({
  imports: [AuthModule],
  controllers: [ActoresController, ActorPerfilController],
  providers: [ActoresService, PerfilService],
})
export class ActoresModule {}
