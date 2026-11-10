import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActividadesService } from './actividades.service';
import { ActividadesController, CursosController, InscripcionesController } from './cursos.controller';
import { CursosScheduler } from './cursos.scheduler';
import { CursosService } from './cursos.service';
import { InscripcionesService } from './inscripciones.service';

@Module({
  imports: [AuthModule],
  controllers: [CursosController, InscripcionesController, ActividadesController],
  providers: [CursosService, InscripcionesService, ActividadesService, CursosScheduler],
})
export class CursosModule {}
