import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccesoActorGuard } from '../auth/acceso-actor.guard';
import { UsuarioSesion } from '../auth/bearer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SesionService } from '../auth/sesion.service';
import { SoloActorGuard } from '../auth/solo-actor.guard';
import { ActividadesService } from './actividades.service';
import { CursosService } from './cursos.service';
import {
  ActividadDto, CambiarEstadoCursoDto, CambiarEstadoInscripcionDto, CursoDto, ListarCursosDto,
  ListarInscripcionesDto,
} from './dto/cursos.dto';
import { InscripcionesService } from './inscripciones.service';

type ReqAdmin = { admin: { sub: string } };
type ReqUsuario = { usuario: UsuarioSesion };

@ApiTags('Cursos y talleres')
@ApiBearerAuth()
@Controller('cursos')
export class CursosController {
  constructor(
    private readonly cursos: CursosService,
    private readonly sesiones: SesionService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  crear(@Req() req: ReqAdmin, @Body() dto: CursoDto) {
    return this.cursos.crear(dto, req.admin.sub);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: CursoDto) {
    return this.cursos.actualizar(id, dto, req.admin.sub);
  }

  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard)
  cambiarEstado(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: CambiarEstadoCursoDto) {
    return this.cursos.cambiarEstado(id, dto, req.admin.sub);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  eliminar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin) {
    return this.cursos.eliminar(id, req.admin.sub);
  }

  /** Público: ABIERTO y EN_CURSO. Con token de admin: todos (y filtro ?estado=). */
  @Get()
  async listar(@Req() req: { headers: Record<string, any> }, @Query() q: ListarCursosDto) {
    const admin = await this.sesiones.adminOpcional(req.headers.authorization);
    return this.cursos.listar(q, !!admin);
  }

  @Get(':id')
  async obtener(@Param('id', ParseUUIDPipe) id: string, @Req() req: { headers: Record<string, any> }) {
    const admin = await this.sesiones.adminOpcional(req.headers.authorization);
    return this.cursos.obtener(id, !!admin);
  }
}

/** Rutas de inscripción (sin prefijo propio: viven bajo /cursos/{id}/... y /inscripciones/...). */
@ApiTags('Inscripciones a cursos')
@ApiBearerAuth()
@Controller()
export class InscripcionesController {
  constructor(private readonly inscripciones: InscripcionesService) {}

  /** Solo actores. El actor sale del token. Con el curso lleno entra a la lista de espera. */
  @Post('cursos/:id/inscripcion')
  @HttpCode(201)
  @UseGuards(SoloActorGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  inscribir(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario) {
    return this.inscripciones.inscribir(req.usuario.id, id);
  }

  @Delete('cursos/:id/inscripcion')
  @UseGuards(SoloActorGuard)
  cancelar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario) {
    return this.inscripciones.cancelar(req.usuario.id, id);
  }

  @Get('inscripciones/mias')
  @UseGuards(SoloActorGuard)
  mias(@Req() req: ReqUsuario) {
    return this.inscripciones.mias(req.usuario.id);
  }

  @Get('cursos/:id/inscripciones')
  @UseGuards(JwtAuthGuard)
  listar(@Param('id', ParseUUIDPipe) id: string, @Query() q: ListarInscripcionesDto) {
    return this.inscripciones.listar(id, q);
  }

  @Patch('cursos/:id/inscripciones/:inscripcionId')
  @UseGuards(JwtAuthGuard)
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inscripcionId', ParseUUIDPipe) inscripcionId: string,
    @Req() req: ReqAdmin,
    @Body() dto: CambiarEstadoInscripcionDto,
  ) {
    return this.inscripciones.cambiarEstado(id, inscripcionId, req.admin.sub, dto);
  }
}

@ApiTags('Actividades académicas')
@ApiBearerAuth()
@Controller('cursos/:id/actividades')
export class ActividadesController {
  constructor(private readonly actividades: ActividadesService) {}

  @Get()
  @UseGuards(AccesoActorGuard)
  listar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario) {
    return this.actividades.listar(id, req.usuario);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  crear(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: ActividadDto) {
    return this.actividades.crear(id, dto, req.admin.sub);
  }

  @Put(':actividadId')
  @UseGuards(JwtAuthGuard)
  actualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actividadId', ParseUUIDPipe) actividadId: string,
    @Req() req: ReqAdmin,
    @Body() dto: ActividadDto,
  ) {
    return this.actividades.actualizar(id, actividadId, dto, req.admin.sub);
  }

  @Delete(':actividadId')
  @UseGuards(JwtAuthGuard)
  eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('actividadId', ParseUUIDPipe) actividadId: string,
    @Req() req: ReqAdmin,
  ) {
    return this.actividades.eliminar(id, actividadId, req.admin.sub);
  }
}
