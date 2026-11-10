import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UsuarioSesion } from '../auth/bearer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SoloActorGuard } from '../auth/solo-actor.guard';
import { CambiarEstadoPostulacionDto, PostularDto } from './dto/postulacion.dto';
import { PostulacionesService } from './postulaciones.service';

@ApiTags('Postulaciones')
@ApiBearerAuth()
@Controller('postulaciones')
export class PostulacionesController {
  constructor(private readonly postulaciones: PostulacionesService) {}

  /** Solo actores. El actor sale del token: no se puede postular a nombre de otro. */
  @Post()
  @HttpCode(201)
  @UseGuards(SoloActorGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  postular(@Req() req: { usuario: UsuarioSesion }, @Body() dto: PostularDto) {
    return this.postulaciones.postular(req.usuario.id, dto.convocatoria_id);
  }

  @Get('mias')
  @UseGuards(SoloActorGuard)
  mias(@Req() req: { usuario: UsuarioSesion }) {
    return this.postulaciones.mias(req.usuario.id);
  }

  @Delete(':id')
  @UseGuards(SoloActorGuard)
  retirar(@Param('id', ParseUUIDPipe) id: string, @Req() req: { usuario: UsuarioSesion }) {
    return this.postulaciones.retirar(req.usuario.id, id);
  }

  /** Solo administradores (mover tarjetas del Kanban). */
  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard)
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { admin: { sub: string } },
    @Body() dto: CambiarEstadoPostulacionDto,
  ) {
    return this.postulaciones.cambiarEstado(id, req.admin.sub, dto);
  }
}
