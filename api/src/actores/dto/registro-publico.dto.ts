import { ApiPropertyOptional } from '@nestjs/swagger';
import { tipo_documento_enum } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  Equals, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString,
  Matches, MaxLength, Max, Min, MinLength,
} from 'class-validator';
import { COLORES_CABELLO, COLORES_OJOS, DIALECTOS, GENEROS, PROVINCIAS, TONOS_PIEL, codigos } from '../../common/catalogos';
import { Bool, Correo, Documento, Entero, Opt, Trim } from '../../common/transforms';

const TELEFONO = /^\+?[0-9\s-]{7,20}$/;

export class RegistroPublicoDto {
  // ---- Cuenta ----
  @Correo() @IsEmail() @MaxLength(201)
  correo: string;

  @IsString() @MinLength(8) @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'La contraseña debe incluir letras y números' })
  contrasena: string;

  // ---- Datos personales ----
  @Trim() @IsString() @MinLength(3) @MaxLength(200)
  nombre_completo: string;

  @IsEnum(tipo_documento_enum)
  tipo_documento: tipo_documento_enum;

  @Documento() @IsString() @MinLength(5) @MaxLength(50)
  numero_documento: string;

  @Trim()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha_nacimiento debe tener formato YYYY-MM-DD' })
  fecha_nacimiento: string;

  @Trim() @IsString() @MinLength(2) @MaxLength(100)
  municipio: string;

  @Trim() @IsString() @MinLength(2) @MaxLength(100)
  ciudad: string;

  @Trim() @Matches(TELEFONO, { message: 'Teléfono inválido' })
  telefono: string;

  // ---- Consentimientos ----
  @Bool() @Equals(true, { message: 'Debes aceptar los términos y condiciones' })
  acepta_terminos: boolean;

  // ---- Perfil ----
  @Opt() @IsString() @MaxLength(100)
  nombre_artistico?: string;

  @Bool() @IsBoolean()
  tiene_experiencia: boolean;

  @Opt() @IsString() @MaxLength(2000)
  biografia?: string;

  // ---- Rasgos físicos ----
  @Transform(({ value }) => (value === '' || value == null ? undefined : Number(value)))
  @IsOptional() @IsInt() @Min(50) @Max(250)
  estatura_cm?: number;

  @Opt() @IsIn(codigos(COLORES_OJOS)) color_ojos?: string;
  @Opt() @IsIn(codigos(COLORES_CABELLO)) color_cabello?: string;
  @Opt() @IsIn(codigos(TONOS_PIEL)) tono_piel?: string;
  @Opt() @IsString() @MaxLength(50) contextura?: string;

  // ---- Datos para casting y vitrina ----
  @Opt() @IsIn(codigos(GENEROS)) genero?: string;

  @Entero() @IsOptional() @IsInt() @Min(0) @Max(100)
  edad_aparente_min?: number;

  @Entero() @IsOptional() @IsInt() @Min(0) @Max(100)
  edad_aparente_max?: number;

  @Opt() @IsIn(codigos(DIALECTOS)) dialecto?: string;
  @Opt() @IsIn(codigos(PROVINCIAS)) provincia?: string;

  /** Consentimiento expreso para aparecer en la vitrina pública (por defecto NO). Se puede cambiar luego. */
  @Bool() @IsBoolean()
  autoriza_vitrina_publica: boolean;

  // ---- Acudiente (obligatorio si el actor es menor de 18 años; se valida en el servicio) ----
  @Opt() @IsString() @MaxLength(200)
  nombre_acudiente?: string;

  @Documento() @Opt() @IsString() @MaxLength(50)
  documento_acudiente?: string;

  @Opt() @Matches(TELEFONO, { message: 'Teléfono del acudiente inválido' })
  telefono_acudiente?: string;

  @Correo() @Opt() @IsEmail() @MaxLength(201)
  correo_acudiente?: string;
}

/** Solo para documentar los archivos en Swagger (no se usa para validar). */
export class RegistroPublicoDocDto extends RegistroPublicoDto {
  @ApiPropertyOptional({ type: 'string', format: 'binary', description: 'jpg/png/webp, máx 5 MB' })
  foto_perfil?: any;

  @ApiPropertyOptional({
    type: 'string', format: 'binary',
    description: 'pdf/jpg/png, máx 5 MB. Obligatorio si el actor es menor de 18 años',
  })
  documento_autorizacion?: any;
}
