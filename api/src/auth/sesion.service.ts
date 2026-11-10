import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { AUD_ACTOR, AUD_ADMIN, verifyOpts } from './jwt.constants';

export interface Sesion {
  tipo: 'ADMIN' | 'ACTOR';
  id: string;
  payload: Record<string, any>;
}

/**
 * Valida tokens contra la BD: el usuario debe seguir activo y, en admins, no haber
 * cambiado la contraseña después de emitido el token.
 */
@Injectable()
export class SesionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async admin(token: string): Promise<Sesion | null> {
    let payload: Record<string, any>;
    try {
      payload = await this.jwt.verifyAsync(token, verifyOpts(AUD_ADMIN));
    } catch {
      return null;
    }
    if (payload.rol !== 'ADMIN') return null;

    const admin = await this.prisma.administradores.findUnique({
      where: { admin_id: payload.sub },
      select: { esta_activo: true, contrasena_actualizada_en: true },
    });
    const passwordCambiada =
      !!admin && Math.floor(admin.contrasena_actualizada_en.getTime() / 1000) > payload.iat;
    if (!admin || !admin.esta_activo || passwordCambiada) return null;
    return { tipo: 'ADMIN', id: payload.sub, payload };
  }

  /** Para rutas públicas que muestran más información a un admin: nunca lanza error. */
  async adminOpcional(authorization?: string): Promise<Sesion | null> {
    const [tipo, token] = String(authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) return null;
    return this.admin(token);
  }

  async actor(token: string): Promise<Sesion | null> {
    let payload: Record<string, any>;
    try {
      payload = await this.jwt.verifyAsync(token, verifyOpts(AUD_ACTOR));
    } catch {
      return null;
    }
    if (payload.rol !== 'ACTOR') return null;

    const actor = await this.prisma.actores.findUnique({
      where: { actor_id: payload.sub },
      select: { esta_activo: true },
    });
    if (!actor?.esta_activo) return null;
    return { tipo: 'ACTOR', id: payload.sub, payload };
  }
}
