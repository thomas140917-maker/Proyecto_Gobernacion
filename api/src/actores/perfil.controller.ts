import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccesoActorGuard } from '../auth/acceso-actor.guard';
import { UsuarioSesion } from '../auth/bearer';
import { SoloActorGuard } from '../auth/solo-actor.guard';
import { HabilidadesActorDto, PerfilDto, VitrinaActorDto } from './dto/perfil.dto';
import { PerfilService } from './perfil.service';

type ReqUsuario = { usuario: UsuarioSesion };

@ApiTags('Actores - Perfil')
@ApiBearerAuth()
@Controller('actores/:id')
export class ActorPerfilController {
  constructor(private readonly perfil: PerfilService) {}

  @Get('perfil')
  @UseGuards(AccesoActorGuard)
  obtener(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario) {
    return this.perfil.obtener(id, req.usuario);
  }

  /** Envía cambios a moderación (crea/actualiza el borrador pendiente). */
  @Put('perfil')
  @UseGuards(SoloActorGuard)
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario, @Body() dto: PerfilDto) {
    return this.perfil.actualizar(id, req.usuario, dto);
  }

  @Get('habilidades')
  @UseGuards(AccesoActorGuard)
  habilidades(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario) {
    return this.perfil.obtenerHabilidades(id, req.usuario);
  }

  @Put('habilidades')
  @UseGuards(SoloActorGuard)
  reemplazarHabilidades(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario, @Body() dto: HabilidadesActorDto) {
    return this.perfil.reemplazarHabilidades(id, req.usuario, dto.habilidades);
  }

  /** Autoriza o retira la publicación en la vitrina pública (efecto inmediato). */
  @Put('vitrina')
  @UseGuards(SoloActorGuard)
  vitrina(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario, @Body() dto: VitrinaActorDto) {
    return this.perfil.cambiarVitrina(id, req.usuario, dto.autoriza_vitrina_publica);
  }
}
