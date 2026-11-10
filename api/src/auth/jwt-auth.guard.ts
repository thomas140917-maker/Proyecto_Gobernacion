import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { extraerBearer } from './bearer';
import { SesionService } from './sesion.service';

/**
 * Solo administradores: @UseGuards(JwtAuthGuard).
 * Deja el payload en req.admin y {tipo,id} en req.usuario.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly sesiones: SesionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const sesion = await this.sesiones.admin(extraerBearer(req));
    if (!sesion) throw new UnauthorizedException('Sesión no válida');
    req.admin = sesion.payload;
    req.usuario = { tipo: 'ADMIN', id: sesion.id };
    return true;
  }
}
