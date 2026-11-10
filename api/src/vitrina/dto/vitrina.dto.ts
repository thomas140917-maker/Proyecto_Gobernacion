import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { DIALECTOS, GENEROS, PROVINCIAS, TONOS_PIEL, codigos } from '../../common/catalogos';
import { Opt } from '../../common/transforms';

export class VitrinaQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  /** Máximo 50 por página: dificulta el raspado masivo de la vitrina. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number = 20;

  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(250)
  estatura_min?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(50) @Max(250)
  estatura_max?: number;

  @Opt() @IsIn(codigos(TONOS_PIEL)) tono_piel?: string;
  @Opt() @IsIn(codigos(DIALECTOS)) dialecto?: string;
  @Opt() @IsIn(codigos(PROVINCIAS)) provincia?: string;
  @Opt() @IsIn(codigos(GENEROS)) genero?: string;
  @Opt() @IsString() @MaxLength(100) municipio?: string;

  /** Edad aparente buscada: devuelve actores cuyo rango la incluye. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100)
  edad?: number;

  /** Ids de destrezas, separados por coma o repetidos: ?habilidades=id1,id2 */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === '') return undefined;
    const arr = Array.isArray(value) ? value : String(value).split(',');
    return arr.map((v) => String(v).trim()).filter(Boolean);
  })
  @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  habilidades?: string[];

  /** todas = debe tener todas las destrezas (por defecto); alguna = basta con una. */
  @IsOptional() @IsIn(['todas', 'alguna'])
  habilidades_modo?: 'todas' | 'alguna' = 'todas';
}
