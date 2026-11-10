import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PostulacionesController } from './postulaciones.controller';
import { PostulacionesService } from './postulaciones.service';

@Module({
  imports: [AuthModule],
  controllers: [PostulacionesController],
  providers: [PostulacionesService],
})
export class PostulacionesModule {}
