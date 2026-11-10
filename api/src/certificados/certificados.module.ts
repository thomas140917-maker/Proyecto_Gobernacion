import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminCertificadosController, CertificadosController, VerificacionController } from './certificados.controller';
import { CertificadosService } from './certificados.service';
import { FirmaPdfService } from './firma-pdf.service';

@Module({
  imports: [AuthModule],
  controllers: [CertificadosController, VerificacionController, AdminCertificadosController],
  providers: [CertificadosService, FirmaPdfService],
})
export class CertificadosModule {}
