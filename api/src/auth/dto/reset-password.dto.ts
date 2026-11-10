import { IsString, Length, Matches } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @Length(64, 64)
  token: string;

  @IsString()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{12,128}$/, {
    message: 'La contraseña debe tener entre 12 y 128 caracteres, con letras y números',
  })
  nueva_contrasena: string;
}
