import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { compararPerfil } from '../admin/diff';
import { DatosPerfil, snapshotPerfil } from '../common/campos-perfil';
import { validarEdadAparente } from '../common/validaciones';
import { UsuarioSesion } from '../auth/bearer';
import { PrismaService } from '../prisma/prisma.service';
import { HabilidadActorDto, PerfilDto } from './dto/perfil.dto';

@Injectable()
export class PerfilService {
  constructor(private readonly prisma: PrismaService) {}

  /** Un actor solo ve lo suyo; un admin puede ver cualquiera. */
  private exigirAcceso(usuario: UsuarioSesion, actorId: string) {
    if (usuario.tipo === 'ACTOR' && usuario.id !== actorId) {
      throw new ForbiddenException('Solo puedes gestionar tu propio perfil');
    }
  }

  // ------------------------------------------------------------ perfil (con staging)
  async obtener(actorId: string, usuario: UsuarioSesion) {
    this.exigirAcceso(usuario, actorId);
    const perfil = await this.prisma.perfiles_actores.findUnique({ where: { actor_id: actorId } });
    if (!perfil) throw new NotFoundException('Perfil no encontrado');

    const [pendiente, rechazada] = await Promise.all([
      this.prisma.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'PENDIENTE' } }),
      this.prisma.perfiles_versiones.findFirst({
        where: { actor_id: actorId, estado: 'RECHAZADA' }, orderBy: { creado_en: 'desc' },
      }),
    ]);
    return {
      actor_id: actorId,
      estado_perfil: perfil.estado,
      autoriza_vitrina_publica: perfil.autoriza_vitrina_publica,
      perfil_publico: snapshotPerfil(perfil),
      version_pendiente: pendiente
        ? { version_id: pendiente.version_id, numero_version: pendiente.numero_version, enviado_en: pendiente.creado_en, datos: pendiente.datos }
        : null,
      ultima_version_rechazada: !pendiente && rechazada
        ? { numero_version: rechazada.numero_version, motivo_rechazo: rechazada.motivo_rechazo, revisado_en: rechazada.revisado_en }
        : null,
    };
  }

  /**
   * Envía cambios: crea (o actualiza) el borrador PENDIENTE. El perfil público NO cambia
   * hasta que un admin apruebe (doble estado).
   */
  async actualizar(actorId: string, usuario: UsuarioSesion, dto: PerfilDto) {
    this.exigirAcceso(usuario, actorId);
    validarEdadAparente(dto.edad_aparente_min, dto.edad_aparente_max);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actorId}))`;
      const perfil = await tx.perfiles_actores.findUnique({ where: { actor_id: actorId } });
      if (!perfil) throw new NotFoundException('Perfil no encontrado');

      // La foto del registro no se edita aquí (la multimedia se gestiona en /actores/{id}/multimedia).
      const datos = snapshotPerfil({ ...dto, foto_perfil_url: perfil.foto_perfil_url });

      const [pendiente, vigente] = await Promise.all([
        tx.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'PENDIENTE' } }),
        tx.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'APROBADA' } }),
      ]);
      if (!pendiente && vigente && compararPerfil(vigente.datos as Partial<DatosPerfil>, datos).total_cambios === 0) {
        throw new ConflictException('No hay cambios respecto a tu perfil público actual');
      }

      let version;
      if (pendiente) {
        version = await tx.perfiles_versiones.update({ where: { version_id: pendiente.version_id }, data: { datos } });
      } else {
        const max = await tx.perfiles_versiones.aggregate({ where: { actor_id: actorId }, _max: { numero_version: true } });
        version = await tx.perfiles_versiones.create({
          data: { actor_id: actorId, numero_version: (max._max.numero_version ?? 0) + 1, datos, estado: 'PENDIENTE' },
        });
      }

      // Si nunca hubo versión pública y estaba RECHAZADO, vuelve a la cola de revisión.
      if (!vigente && perfil.estado !== 'PENDIENTE') {
        await tx.perfiles_actores.update({
          where: { actor_id: actorId },
          data: { estado: 'PENDIENTE', motivo_rechazo: null, actualizado_en: new Date() },
        });
      }

      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACTUALIZAR',
          entidad_afectada: 'perfiles_actores',
          entidad_id: actorId,
          realizado_por_actor_id: actorId,
          observacion_accion: 'Envío de cambios de perfil a revisión',
          detalle: { version_id: version.version_id, numero_version: version.numero_version, reemplaza_borrador: !!pendiente },
        },
      });
      return {
        version_id: version.version_id,
        numero_version: version.numero_version,
        estado: 'PENDIENTE',
        message: 'Cambios enviados. Se publicarán cuando un administrador los apruebe.',
      };
    });
  }

  // ------------------------------------------------------------ destrezas
  async obtenerHabilidades(actorId: string, usuario: UsuarioSesion) {
    this.exigirAcceso(usuario, actorId);
    const filas = await this.prisma.actores_habilidades.findMany({
      where: { actor_id: actorId },
      include: { habilidad: { select: { nombre: true, tipo: true } } },
      orderBy: { habilidad: { nombre: 'asc' } },
    });
    return filas.map((f) => ({
      habilidad_id: f.habilidad_id, nombre: f.habilidad.nombre, tipo: f.habilidad.tipo, descripcion_otra: f.descripcion_otra,
    }));
  }

  /** Reemplaza el conjunto completo de destrezas (máx. 15). */
  async reemplazarHabilidades(actorId: string, usuario: UsuarioSesion, items: HabilidadActorDto[]) {
    this.exigirAcceso(usuario, actorId);
    const ids = items.map((i) => i.habilidad_id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Hay destrezas repetidas');
    if (ids.length) {
      const existentes = await this.prisma.habilidades.count({ where: { habilidad_id: { in: ids } } });
      if (existentes !== ids.length) throw new BadRequestException('Alguna destreza indicada no existe');
    }

    await this.prisma.$transaction([
      this.prisma.actores_habilidades.deleteMany({ where: { actor_id: actorId } }),
      this.prisma.actores_habilidades.createMany({
        data: items.map((i) => ({ actor_id: actorId, habilidad_id: i.habilidad_id, descripcion_otra: i.descripcion_otra ?? null })),
      }),
      this.prisma.historial_auditoria.create({
        data: {
          tipo_accion: 'ACTUALIZAR',
          entidad_afectada: 'actores_habilidades',
          entidad_id: actorId,
          realizado_por_actor_id: actorId,
          observacion_accion: 'Actualización de destrezas',
          detalle: { total: items.length },
        },
      }),
    ]);
    return this.obtenerHabilidades(actorId, usuario);
  }

  // ------------------------------------------------------------ consentimiento de vitrina
  /** Inmediato (no pasa por moderación): retirar el consentimiento no puede esperar a un admin. */
  async cambiarVitrina(actorId: string, usuario: UsuarioSesion, autoriza: boolean) {
    this.exigirAcceso(usuario, actorId);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.perfiles_actores.updateMany({
        where: { actor_id: actorId },
        data: { autoriza_vitrina_publica: autoriza, actualizado_en: new Date() },
      });
      if (r.count !== 1) throw new NotFoundException('Perfil no encontrado');
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACTUALIZAR',
          entidad_afectada: 'perfiles_actores',
          entidad_id: actorId,
          realizado_por_actor_id: actorId,
          observacion_accion: autoriza ? 'Autoriza vitrina pública' : 'Retira autorización de vitrina pública',
          detalle: { autoriza_vitrina_publica: autoriza },
        },
      });
    });
    return { actor_id: actorId, autoriza_vitrina_publica: autoriza };
  }
}
