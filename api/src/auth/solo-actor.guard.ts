import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { extraerBearer } from './bearer';
import { SesionService } from './sesion.service';

/** Solo actores autenticados (el actor_id sale SIEMPRE del token, nunca del body). */
@Injectable()
export class SoloActorGuard implements CanActivate {
  constructor(private readonly sesiones: SesionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const sesion = await this.sesiones.actor(extraerBearer(req));
    if (!sesion) throw new UnauthorizedException('Sesión no válida');
    req.usuario = { tipo: 'ACTOR', id: sesion.id };
    return true;
  }
}
