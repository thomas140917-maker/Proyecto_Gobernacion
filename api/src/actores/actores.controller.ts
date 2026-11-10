import { Body, Controller, HttpCode, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ActoresService, ArchivosRegistro } from './actores.service';
import { RegistroPublicoDocDto, RegistroPublicoDto } from './dto/registro-publico.dto';
import { registroMulterOptions } from './upload.config';

@ApiTags('Actores')
@Controller('actores')
export class ActoresController {
  constructor(private readonly actores: ActoresService) {}

  @Post('registro-publico')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: RegistroPublicoDocDto })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'foto_perfil', maxCount: 1 },
        { name: 'documento_autorizacion', maxCount: 1 },
      ],
      registroMulterOptions,
    ),
  )
  registroPublico(@Body() dto: RegistroPublicoDto, @UploadedFiles() files: ArchivosRegistro) {
    return this.actores.registroPublico(dto, files ?? {});
  }
}
