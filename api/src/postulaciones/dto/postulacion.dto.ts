import { estado_postulacion_enum } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Opt } from '../../common/transforms';

export class PostularDto {
  @IsUUID()
  convocatoria_id: string;
}

export class CambiarEstadoPostulacionDto {
  @IsEnum(estado_postulacion_enum)
  estado: estado_postulacion_enum;

  /** Estado que el admin veía al arrastrar la tarjeta; si ya cambió, la API responde 409. */
  @IsOptional() @IsEnum(estado_postulacion_enum)
  estado_anterior?: estado_postulacion_enum;

  /** Obligatoria (mín. 10 caracteres) al pasar a RECHAZADO. */
  @Opt() @IsString() @MaxLength(1000)
  notas?: string;
}
