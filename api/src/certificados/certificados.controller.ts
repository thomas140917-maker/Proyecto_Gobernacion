import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, Res, StreamableFile, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AccesoActorGuard } from '../auth/acceso-actor.guard';
import { UsuarioSesion } from '../auth/bearer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SoloActorGuard } from '../auth/solo-actor.guard';
import { RevocarCertificadoDto } from './certificados.dto';
import { CertificadosService, PdfEntregado } from './certificados.service';

type ReqUsuario = { usuario: UsuarioSesion };

function enviarPdf(res: Response, r: PdfEntregado) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="certificado-${r.codigo}.pdf"`,
    'X-Certificado-Codigo': r.codigo,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(r.buffer);
}

@ApiTags('Certificados')
@ApiBearerAuth()
@Controller('certificados')
export class CertificadosController {
  constructor(private readonly certificados: CertificadosService) {}

  /** PDF del certificado de registro (perfil APROBADO). Devuelve el archivo; el código va en X-Certificado-Codigo. */
  @Post('registro')
  @HttpCode(201)
  @UseGuards(SoloActorGuard)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  async registro(@Req() req: ReqUsuario, @Res({ passthrough: true }) res: Response) {
    return enviarPdf(res, await this.certificados.emitirRegistro(req.usuario.id));
  }

  /** Constancia de un curso completado. */
  @Post('curso/:cursoId')
  @HttpCode(201)
  @UseGuards(SoloActorGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async curso(
    @Param('cursoId', ParseUUIDPipe) cursoId: string,
    @Req() req: ReqUsuario,
    @Res({ passthrough: true }) res: Response,
  ) {
    return enviarPdf(res, await this.certificados.emitirCurso(req.usuario.id, cursoId));
  }

  @Get('mis')
  @UseGuards(SoloActorGuard)
  mios(@Req() req: ReqUsuario) {
    return this.certificados.mios(req.usuario.id);
  }

  @Get(':id/pdf')
  @UseGuards(AccesoActorGuard)
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario, @Res({ passthrough: true }) res: Response) {
    return enviarPdf(res, await this.certificados.descargar(id, req.usuario));
  }
}

/** Público: cualquiera con el código (QR) puede comprobar un certificado. */
@ApiTags('Verificación pública')
@Controller('verificacion')
export class VerificacionController {
  constructor(private readonly certificados: CertificadosService) {}

  @Get(':codigo')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verificar(@Param('codigo') codigo: string, @Res({ passthrough: true }) res: Response) {
    res.set('Cache-Control', 'no-store'); // la vigencia puede cambiar en cualquier momento
    return this.certificados.verificar(codigo);
  }
}

@ApiTags('Certificados (admin)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/certificados')
export class AdminCertificadosController {
  constructor(private readonly certificados: CertificadosService) {}

  @Put(':id/revocar')
  revocar(@Param('id', ParseUUIDPipe) id: string, @Req() req: { admin: { sub: string } }, @Body() dto: RevocarCertificadoDto) {
    return this.certificados.revocar(id, req.admin.sub, dto.motivo);
  }
}
