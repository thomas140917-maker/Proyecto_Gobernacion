import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Trim } from '../../common/transforms';

export class PaginacionDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;
}

export class AprobarPerfilDto {
  /** Opcional: versión que el admin revisó. Si ya cambió, la API responde 409 en vez de aprobar otra. */
  @IsOptional() @IsUUID()
  version_id?: string;
}

export class RechazarPerfilDto {
  /** Justificación técnica institucional (queda en la versión, el perfil y la auditoría). */
  @Trim() @IsString() @MinLength(20, { message: 'La justificación debe tener al menos 20 caracteres' }) @MaxLength(1000)
  motivo: string;

  @IsOptional() @IsUUID()
  version_id?: string;
}
