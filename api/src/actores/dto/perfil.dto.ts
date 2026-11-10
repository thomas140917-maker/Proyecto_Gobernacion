import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import {
  COLORES_CABELLO, COLORES_OJOS, DIALECTOS, GENEROS, PROVINCIAS, TONOS_PIEL, codigos,
} from '../../common/catalogos';
import { Bool, Entero, Opt } from '../../common/transforms';

/** PUT: reemplaza el borrador completo. Lo no enviado queda vacío. Pasa por moderación. */
export class PerfilDto {
  @Opt() @IsString() @MaxLength(100) nombre_artistico?: string;

  @Bool() @IsBoolean()
  tiene_experiencia: boolean;

  @Opt() @IsString() @MaxLength(2000) biografia?: string;

  @Entero() @IsOptional() @IsInt() @Min(50) @Max(250) estatura_cm?: number;

  @Opt() @IsIn(codigos(COLORES_OJOS)) color_ojos?: string;
  @Opt() @IsIn(codigos(COLORES_CABELLO)) color_cabello?: string;
  @Opt() @IsIn(codigos(TONOS_PIEL)) tono_piel?: string;
  @Opt() @IsString() @MaxLength(50) contextura?: string;

  @Opt() @IsIn(codigos(GENEROS)) genero?: string;
  @Entero() @IsOptional() @IsInt() @Min(0) @Max(100) edad_aparente_min?: number;
  @Entero() @IsOptional() @IsInt() @Min(0) @Max(100) edad_aparente_max?: number;
  @Opt() @IsIn(codigos(DIALECTOS)) dialecto?: string;
  @Opt() @IsIn(codigos(PROVINCIAS)) provincia?: string;
}

export class HabilidadActorDto {
  @IsUUID()
  habilidad_id: string;

  @Opt() @IsString() @MaxLength(100)
  descripcion_otra?: string;
}

export class HabilidadesActorDto {
  @IsArray() @ArrayMaxSize(15) @ValidateNested({ each: true }) @Type(() => HabilidadActorDto)
  habilidades: HabilidadActorDto[];
}

export class VitrinaActorDto {
  @IsBoolean()
  autoriza_vitrina_publica: boolean;
}
