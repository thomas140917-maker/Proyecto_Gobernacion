import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConvocatoriasController } from './convocatorias.controller';
import { ConvocatoriasScheduler } from './convocatorias.scheduler';
import { ConvocatoriasService } from './convocatorias.service';

@Module({
  imports: [AuthModule],
  controllers: [ConvocatoriasController],
  providers: [ConvocatoriasService, ConvocatoriasScheduler],
  exports: [ConvocatoriasService],
})
export class ConvocatoriasModule {}
