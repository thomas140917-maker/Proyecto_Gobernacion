import { estado_convocatoria_enum } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { PaginacionDto } from '../../admin/dto/admin.dto';
import {
  COLORES_CABELLO, COLORES_OJOS, DIALECTOS, GENEROS, MODALIDADES, PROVINCIAS, TONOS_PIEL, codigos,
} from '../../common/catalogos';
import { Opt, Trim } from '../../common/transforms';

const lista = (max: number) => [IsOptional(), IsArray(), ArrayMaxSize(max), ArrayUnique()];
const aplicar = (...decs: PropertyDecorator[]) => (t: object, k: string | symbol) => decs.forEach((d) => d(t, k));

export class HabilidadRequeridaDto {
  @IsUUID()
  habilidad_id: string;

  /** true (por defecto) = requisito obligatorio; false = deseable (solo suma compatibilidad). */
  @IsOptional() @IsBoolean()
  obligatoria?: boolean = true;
}

export class ConvocatoriaDto {
  @Trim() @IsString() @MinLength(3) @MaxLength(200)
  titulo: string;

  @Trim() @IsString() @MinLength(10) @MaxLength(5000)
  descripcion: string;

  @Opt() @IsString() @MaxLength(4000)
  requisitos?: string;

  @Opt() @IsString() @MaxLength(100)
  ubicacion?: string;

  @IsIn(codigos(MODALIDADES))
  modalidad: string;

  /** Número de vacantes: no se podrán SELECCIONAR más postulaciones que este valor. */
  @IsInt() @Min(1) @Max(1000)
  cupo_maximo: number;

  /** ISO 8601 con zona horaria, p. ej. 2026-11-01T08:00:00-05:00 */
  @IsOptional() @IsISO8601({ strict: true })
  fecha_apertura?: string;

  @IsISO8601({ strict: true })
  fecha_cierre: string;

  // ---- Requisitos DUROS (bloquean la postulación) ----
  @IsOptional() @IsInt() @Min(0) @Max(100) edad_aparente_min?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) edad_aparente_max?: number;
  @IsOptional() @IsInt() @Min(50) @Max(250) estatura_min_cm?: number;
  @IsOptional() @IsInt() @Min(50) @Max(250) estatura_max_cm?: number;

  @aplicar(...lista(4)) @IsIn(codigos(GENEROS), { each: true })
  generos?: string[];

  @IsOptional() @IsBoolean()
  solo_mayores_de_edad?: boolean;

  /** Destrezas requeridas (obligatoria=true bloquea) o deseables (obligatoria=false). */
  @IsOptional() @IsArray() @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => HabilidadRequeridaDto)
  habilidades?: HabilidadRequeridaDto[];

  // ---- Preferencias BLANDAS (solo suman a la compatibilidad 0-100) ----
  @aplicar(...lista(5)) @IsIn(codigos(TONOS_PIEL), { each: true })
  tonos_piel?: string[];

  @aplicar(...lista(6)) @IsIn(codigos(COLORES_OJOS), { each: true })
  colores_ojos?: string[];

  @aplicar(...lista(6)) @IsIn(codigos(COLORES_CABELLO), { each: true })
  colores_cabello?: string[];

  @aplicar(...lista(10)) @IsIn(codigos(DIALECTOS), { each: true })
  dialectos?: string[];

  @aplicar(...lista(14)) @IsIn(codigos(PROVINCIAS), { each: true })
  provincias?: string[];

  @aplicar(...lista(30)) @IsString({ each: true }) @MaxLength(100, { each: true })
  municipios?: string[];
}

export class CambiarEstadoConvocatoriaDto {
  @IsEnum(estado_convocatoria_enum)
  estado: estado_convocatoria_enum;

  @Opt() @IsString() @MaxLength(500)
  motivo?: string;
}

export class ListarConvocatoriasDto extends PaginacionDto {
  /** Solo lo respetan los administradores; el público siempre ve ACTIVA y PROXIMA. */
  @IsOptional() @IsEnum(estado_convocatoria_enum)
  estado?: estado_convocatoria_enum;
}
