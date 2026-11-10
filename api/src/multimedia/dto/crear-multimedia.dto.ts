import { ApiPropertyOptional } from '@nestjs/swagger';
import { tipo_multimedia_enum } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Opt } from '../../common/transforms';

export class CrearMultimediaDto {
  @IsEnum(tipo_multimedia_enum)
  tipo: tipo_multimedia_enum;

  @Opt() @IsString() @MaxLength(100)
  titulo?: string;

  /** Solo para REEL_PRESENTACION y ENLACE_PORTAFOLIO: enlace https de YouTube o Vimeo. */
  @Opt() @IsString() @MaxLength(2048)
  url?: string;
}

/** Solo para documentar el archivo en Swagger. */
export class CrearMultimediaDocDto extends CrearMultimediaDto {
  @ApiPropertyOptional({
    type: 'string', format: 'binary',
    description: 'FOTO_PERFIL / FOTO_BOOK: jpg, png o webp (máx. 10 MB). DOCUMENTO: pdf (máx. 5 MB).',
  })
  archivo?: any;
}

export class ListarMultimediaDto {
  @IsOptional() @IsEnum(tipo_multimedia_enum)
  tipo?: tipo_multimedia_enum;
}
