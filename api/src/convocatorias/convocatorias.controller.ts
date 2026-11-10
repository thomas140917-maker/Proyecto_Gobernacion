import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SesionService } from '../auth/sesion.service';
import { CambiarEstadoConvocatoriaDto, ConvocatoriaDto, ListarConvocatoriasDto } from './dto/convocatoria.dto';
import { ConvocatoriasService } from './convocatorias.service';

type ReqAdmin = { admin: { sub: string } };

@ApiTags('Convocatorias')
@Controller('convocatorias')
export class ConvocatoriasController {
  constructor(
    private readonly convocatorias: ConvocatoriasService,
    private readonly sesiones: SesionService,
  ) {}

  @Post()
  @HttpCode(201)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  crear(@Req() req: ReqAdmin, @Body() dto: ConvocatoriaDto) {
    return this.convocatorias.crear(dto, req.admin.sub);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: ConvocatoriaDto) {
    return this.convocatorias.actualizar(id, dto, req.admin.sub);
  }

  @Patch(':id/estado')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string, @Req() req: ReqAdmin, @Body() dto: CambiarEstadoConvocatoriaDto,
  ) {
    return this.convocatorias.cambiarEstado(id, dto, req.admin.sub);
  }

  /** Público: ACTIVA y PROXIMA. Con token de admin: todas (y filtro ?estado=). */
  @Get()
  @ApiBearerAuth()
  async listar(@Req() req: { headers: Record<string, any> }, @Query() q: ListarConvocatoriasDto) {
    const admin = await this.sesiones.adminOpcional(req.headers.authorization);
    return this.convocatorias.listar(q, !!admin);
  }

  @Get(':id')
  @ApiBearerAuth()
  async obtener(@Param('id', ParseUUIDPipe) id: string, @Req() req: { headers: Record<string, any> }) {
    const admin = await this.sesiones.adminOpcional(req.headers.authorization);
    return this.convocatorias.obtener(id, !!admin);
  }
}
