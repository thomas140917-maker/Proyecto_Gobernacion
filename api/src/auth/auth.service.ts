import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../common/password.util';
import { MailService } from '../mail/mail.service';
import { AUD_ACTOR, signOpts } from './jwt.constants';
import { PrismaService } from '../prisma/prisma.service';

const TOKEN_TTL_MIN = 30;
const MAX_INTENTOS = 5;
const BLOQUEO_MIN = 15;
export const JWT_EXPIRES_IN_SECONDS = 8 * 60 * 60; // 8 horas
const MSG_LOGIN = 'Credenciales inválidas o cuenta bloqueada temporalmente';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async login(correo: string, contrasena: string) {
    const ahora = new Date();
    const admin = await this.prisma.administradores.findUnique({ where: { correo } });

    // Siempre se ejecuta una comparación bcrypt (exista o no el usuario): evita ataques de tiempo.
    const coincide = await verifyPassword(contrasena, admin?.contrasena_hash ?? DUMMY_HASH);
    const bloqueado = !!admin?.bloqueado_hasta && admin.bloqueado_hasta > ahora;

    if (!admin || !admin.esta_activo || bloqueado || !coincide) {
      if (admin?.esta_activo && !bloqueado && !coincide) await this.registrarFallo(admin.admin_id);
      // Mismo mensaje en todos los casos: no revela si la cuenta existe o está bloqueada.
      throw new UnauthorizedException(MSG_LOGIN);
    }

    if (admin.intentos_fallidos > 0 || admin.bloqueado_hasta) {
      await this.prisma.administradores.update({
        where: { admin_id: admin.admin_id },
        data: { intentos_fallidos: 0, bloqueado_hasta: null },
      });
    }

    const nombre = `${admin.nombre} ${admin.apellido}`;
    const access_token = await this.jwt.signAsync({
      sub: admin.admin_id,
      correo: admin.correo,
      nombre,
      rol: 'ADMIN',
    });
    return {
      access_token,
      token_type: 'Bearer',
      expires_in: JWT_EXPIRES_IN_SECONDS,
      admin: { admin_id: admin.admin_id, correo: admin.correo, nombre },
    };
  }

  private async registrarFallo(adminId: string) {
    const { intentos_fallidos } = await this.prisma.administradores.update({
      where: { admin_id: adminId },
      data: { intentos_fallidos: { increment: 1 } },
      select: { intentos_fallidos: true },
    });
    if (intentos_fallidos >= MAX_INTENTOS) {
      await this.prisma.administradores.update({
        where: { admin_id: adminId },
        data: { intentos_fallidos: 0, bloqueado_hasta: new Date(Date.now() + BLOQUEO_MIN * 60_000) },
      });
      this.logger.warn(`Cuenta de admin ${adminId} bloqueada ${BLOQUEO_MIN} min por intentos fallidos`);
    }
  }

  /**
   * Responde de inmediato y procesa en segundo plano: el tiempo de respuesta
   * no revela si el correo existe.
   */
  recuperar(correo: string) {
    void this.procesarRecuperacion(correo).catch((e) =>
      this.logger.error(`Error en recuperación de contraseña: ${(e as Error).message}`),
    );
    return {
      message: 'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
    };
  }

  private async procesarRecuperacion(correo: string) {
    const admin = await this.prisma.administradores.findUnique({ where: { correo } });
    if (!admin || !admin.esta_activo) return;

    const token = randomBytes(32).toString('hex'); // 64 caracteres
    const ahora = new Date();
    await this.prisma.$transaction([
      // limpia tokens viejos (usados o vencidos) y anula los pendientes
      this.prisma.tokens_recuperacion.deleteMany({
        where: { admin_id: admin.admin_id, OR: [{ usado_en: { not: null } }, { expira_en: { lt: ahora } }] },
      }),
      this.prisma.tokens_recuperacion.updateMany({
        where: { admin_id: admin.admin_id, usado_en: null },
        data: { usado_en: ahora },
      }),
      this.prisma.tokens_recuperacion.create({
        data: {
          admin_id: admin.admin_id,
          token_hash: sha256(token),
          expira_en: new Date(ahora.getTime() + TOKEN_TTL_MIN * 60_000),
        },
      }),
    ]);

    // El token va en el fragmento (#): no viaja al servidor ni en cabeceras Referer.
    const base = this.config.get<string>('FRONTEND_URL');
    await this.mail.enviarRecuperacion(admin.correo, admin.nombre, `${base}/admin/reset-password#token=${token}`);
  }

  async restablecer(token: string, nuevaContrasena: string) {
    const tokenHash = sha256(token);
    const hash = await hashPassword(nuevaContrasena);
    const ahora = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Consumo atómico: si dos peticiones usan el mismo token, solo una gana.
      const usado = await tx.tokens_recuperacion.updateMany({
        where: { token_hash: tokenHash, usado_en: null, expira_en: { gt: ahora } },
        data: { usado_en: ahora },
      });
      if (usado.count !== 1) throw new BadRequestException('Token inválido o expirado');

      const registro = await tx.tokens_recuperacion.findUniqueOrThrow({ where: { token_hash: tokenHash } });
      await tx.administradores.update({
        where: { admin_id: registro.admin_id },
        data: {
          contrasena_hash: hash,
          contrasena_actualizada_en: ahora, // invalida los JWT emitidos antes
          intentos_fallidos: 0,
          bloqueado_hasta: null,
        },
      });
      await tx.tokens_recuperacion.updateMany({
        where: { admin_id: registro.admin_id, usado_en: null },
        data: { usado_en: ahora },
      });
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACTUALIZAR',
          entidad_afectada: 'administradores',
          entidad_id: registro.admin_id,
          realizado_por_admin_id: registro.admin_id,
          observacion_accion: 'Restablecimiento de contraseña mediante token',
        },
      });
    });
    return { message: 'Contraseña actualizada correctamente' };
  }

  /** Login de actor (para gestionar su propio perfil y multimedia). Misma política que el admin. */
  async loginActor(correo: string, contrasena: string) {
    const ahora = new Date();
    const actor = await this.prisma.actores.findUnique({ where: { correo } });
    const coincide = await verifyPassword(contrasena, actor?.contrasena_hash ?? DUMMY_HASH);
    const bloqueado = !!actor?.bloqueado_hasta && actor.bloqueado_hasta > ahora;

    if (!actor || !actor.esta_activo || bloqueado || !coincide) {
      if (actor?.esta_activo && !bloqueado && !coincide) await this.registrarFalloActor(actor.actor_id);
      throw new UnauthorizedException(MSG_LOGIN);
    }

    if (actor.intentos_fallidos > 0 || actor.bloqueado_hasta) {
      await this.prisma.actores.update({
        where: { actor_id: actor.actor_id },
        data: { intentos_fallidos: 0, bloqueado_hasta: null },
      });
    }

    const access_token = await this.jwt.signAsync(
      { sub: actor.actor_id, correo: actor.correo, rol: 'ACTOR' },
      signOpts(AUD_ACTOR, '4h'),
    );
    return {
      access_token,
      token_type: 'Bearer',
      expires_in: 4 * 60 * 60,
      actor: { actor_id: actor.actor_id, correo: actor.correo, nombre_completo: actor.nombre_completo },
    };
  }

  private async registrarFalloActor(actorId: string) {
    const { intentos_fallidos } = await this.prisma.actores.update({
      where: { actor_id: actorId },
      data: { intentos_fallidos: { increment: 1 } },
      select: { intentos_fallidos: true },
    });
    if (intentos_fallidos >= MAX_INTENTOS) {
      await this.prisma.actores.update({
        where: { actor_id: actorId },
        data: { intentos_fallidos: 0, bloqueado_hasta: new Date(Date.now() + BLOQUEO_MIN * 60_000) },
      });
      this.logger.warn(`Cuenta de actor ${actorId} bloqueada ${BLOQUEO_MIN} min por intentos fallidos`);
    }
  }
}
