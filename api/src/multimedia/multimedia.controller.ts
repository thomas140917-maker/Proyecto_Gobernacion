import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AccesoActorGuard } from '../auth/acceso-actor.guard';
import { UsuarioSesion } from '../auth/bearer';
import { CrearMultimediaDocDto, CrearMultimediaDto, ListarMultimediaDto } from './dto/crear-multimedia.dto';
import { MultimediaService } from './multimedia.service';

type ReqUsuario = { usuario: UsuarioSesion };

@ApiTags('Multimedia')
@ApiBearerAuth()
@UseGuards(AccesoActorGuard) // se evalúa ANTES de recibir el archivo
@Controller('actores/:id/multimedia')
export class MultimediaController {
  constructor(private readonly multimedia: MultimediaService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CrearMultimediaDocDto })
  @UseInterceptors(
    FileInterceptor('archivo', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10, fieldSize: 4096, parts: 15 },
    }),
  )
  crear(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ReqUsuario,
    @Body() dto: CrearMultimediaDto,
    @UploadedFile() archivo?: Express.Multer.File,
  ) {
    return this.multimedia.crear(id, req.usuario, dto, archivo);
  }

  @Get()
  listar(@Param('id', ParseUUIDPipe) id: string, @Req() req: ReqUsuario, @Query() q: ListarMultimediaDto) {
    return this.multimedia.listar(id, req.usuario, q.tipo);
  }

  @Delete(':multimediaId')
  eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('multimediaId', ParseUUIDPipe) multimediaId: string,
    @Req() req: ReqUsuario,
  ) {
    return this.multimedia.eliminar(id, req.usuario, multimediaId);
  }
}
