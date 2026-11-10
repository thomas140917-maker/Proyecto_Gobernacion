import { IsString, MaxLength, MinLength } from 'class-validator';
import { Trim } from '../common/transforms';

export class RevocarCertificadoDto {
  @Trim() @IsString() @MinLength(10, { message: 'Indica el motivo (mínimo 10 caracteres)' }) @MaxLength(500)
  motivo: string;
}
