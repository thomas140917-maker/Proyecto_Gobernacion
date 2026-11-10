import {
  Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, Res, StreamableFile, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminAcudientesService } from './admin-acudientes.service';
import { AdminPerfilesService } from './admin-perfiles.service';
import { AprobarPerfilDto, PaginacionDto, RechazarPerfilDto } from './dto/admin.dto';

type ReqAdmin = { admin: { sub: string } };

@ApiTags('Admin - Perfiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/perfiles')
export class AdminPerfilesController {
  constructor(private readonly perfiles: AdminPerfilesService) {}

  @Get('pendientes')
  pendientes(@Query() q: PaginacionDto) {
    return this.perfiles.pendientes(q.page, q.limit);
  }

  @Get(':id/diff')
  diff(@Param('id', ParseUUIDPipe) id: string) {
    return this.perfiles.diff(id);
  }

  @Put(':id/aprobar')
  aprobar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: AprobarPerfilDto) {
    return this.perfiles.aprobar(id, req.admin.sub, dto.version_id);
  }

  @Put(':id/rechazar')
  rechazar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: RechazarPerfilDto) {
    return this.perfiles.rechazar(id, req.admin.sub, dto.motivo, dto.version_id);
  }
}

@ApiTags('Admin - Acudientes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/acudientes')
export class AdminAcudientesController {
  constructor(private readonly acudientes: AdminAcudientesService) {}

  @Get('pendientes')
  pendientes(@Query() q: PaginacionDto) {
    return this.acudientes.pendientes(q.page, q.limit);
  }

  @Put(':id/verificar')
  verificar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin) {
    return this.acudientes.verificar(id, req.admin.sub);
  }

  @Get(':id/documento')
  async documento(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ReqAdmin,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, contentType, ext } = await this.acudientes.abrirDocumento(id, req.admin.sub);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="autorizacion${ext}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(buffer);
  }
}
