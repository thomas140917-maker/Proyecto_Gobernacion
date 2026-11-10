import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RecoverPasswordDto } from './dto/recover-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@ApiTags('Auth Admin')
@Controller('auth/admin')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.correo, dto.contrasena);
  }

  @Post('recover-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  recover(@Body() dto: RecoverPasswordDto) {
    return this.auth.recuperar(dto.correo);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.restablecer(dto.token, dto.nueva_contrasena);
  }

  /** Sirve al frontend para validar la sesión al cargar el panel. */
  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@Req() req: { admin: { sub: string; correo: string; nombre: string; rol: string } }) {
    const { sub, correo, nombre, rol } = req.admin;
    return { admin_id: sub, correo, nombre, rol };
  }
}
