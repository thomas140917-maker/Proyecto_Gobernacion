import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAcudientesService } from './admin-acudientes.service';
import { AdminPerfilesService } from './admin-perfiles.service';
import { AdminAcudientesController, AdminPerfilesController } from './admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminPerfilesController, AdminAcudientesController],
  providers: [AdminPerfilesService, AdminAcudientesService],
})
export class AdminModule {}
