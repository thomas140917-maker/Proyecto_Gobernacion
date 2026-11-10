import { estado_curso_enum, estado_inscripcion_enum, tipo_actividad_enum, tipo_curso_enum } from '@prisma/client';
import {
  IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PaginacionDto } from '../../admin/dto/admin.dto';
import { MODALIDADES, codigos } from '../../common/catalogos';
import { Opt, Trim } from '../../common/transforms';

export class CursoDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(200)
  titulo: string;

  @IsEnum(tipo_curso_enum)
  tipo: tipo_curso_enum;

  @Trim() @IsString() @MinLength(10) @MaxLength(5000)
  descripcion: string;

  @Opt() @IsString() @MaxLength(100)
  instructor?: string;

  @IsIn(codigos(MODALIDADES))
  modalidad: string;

  @Opt() @IsString() @MaxLength(200)
  lugar?: string;

  /** ISO 8601 con zona horaria, p. ej. 2026-11-01T08:00:00-05:00 */
  @IsISO8601({ strict: true })
  fecha_inicio_inscripcion: string;

  @IsISO8601({ strict: true })
  fecha_inicio_curso: string;

  @IsISO8601({ strict: true })
  fecha_fin_curso: string;

  @IsInt() @Min(1) @Max(1000)
  cupo_maximo: number;

  /** Intensidad horaria (aparece en la constancia). */
  @IsOptional() @IsInt() @Min(1) @Max(2000)
  horas_totales?: number;

  @IsOptional() @IsBoolean()
  es_proceso_formacion?: boolean;

  @IsOptional() @IsBoolean()
  solo_mayores_de_edad?: boolean;
}

export class CambiarEstadoCursoDto {
  @IsEnum(estado_curso_enum)
  estado: estado_curso_enum;

  @Opt() @IsString() @MaxLength(500)
  motivo?: string;
}

export class ListarCursosDto extends PaginacionDto {
  /** Solo lo respetan los administradores; el público ve ABIERTO y EN_CURSO. */
  @IsOptional() @IsEnum(estado_curso_enum)
  estado?: estado_curso_enum;

  @IsOptional() @IsEnum(tipo_curso_enum)
  tipo?: tipo_curso_enum;
}

export class ActividadDto {
  @IsOptional() @IsEnum(tipo_actividad_enum)
  tipo?: tipo_actividad_enum;

  @Trim() @IsString() @MinLength(3) @MaxLength(200)
  titulo: string;

  @Opt() @IsString() @MaxLength(3000)
  descripcion?: string;

  @IsOptional() @IsISO8601({ strict: true })
  fecha_inicio?: string;

  @IsOptional() @IsISO8601({ strict: true })
  fecha_fin?: string;

  /** Lugar o enlace de la sesión. Los enlaces deben ser https. */
  @Opt() @IsString() @MaxLength(300)
  lugar_o_enlace?: string;

  @IsOptional() @IsInt() @Min(0) @Max(1000)
  orden?: number;
}

export class CambiarEstadoInscripcionDto {
  @IsEnum(estado_inscripcion_enum)
  estado: estado_inscripcion_enum;

  @Opt() @IsString() @MaxLength(1000)
  notas?: string;
}

export class ListarInscripcionesDto extends PaginacionDto {
  @IsOptional() @IsEnum(estado_inscripcion_enum)
  estado?: estado_inscripcion_enum;
}
