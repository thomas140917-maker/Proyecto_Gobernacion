import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { extraerBearer } from './bearer';
import { SesionService } from './sesion.service';

/**
 * Admin o actor autenticado. Deja {tipo,id} en req.usuario; el servicio decide
 * si el actor es dueño del recurso (un actor solo puede tocar lo suyo).
 */
@Injectable()
export class AccesoActorGuard implements CanActivate {
  constructor(private readonly sesiones: SesionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extraerBearer(req);
    const sesion = (await this.sesiones.admin(token)) ?? (await this.sesiones.actor(token));
    if (!sesion) throw new UnauthorizedException('Sesión no válida');
    req.usuario = { tipo: sesion.tipo, id: sesion.id };
    return true;
  }
}
