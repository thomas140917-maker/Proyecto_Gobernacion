import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatosPerfil, aColumnasPerfil, snapshotPerfil } from '../common/campos-perfil';
import { calcularEdad } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { compararPerfil } from './diff';

@Injectable()
export class AdminPerfilesService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ listado
  async pendientes(page = 1, limit = 20) {
    const where = { estado: 'PENDIENTE' as const };
    const [total, filas] = await this.prisma.$transaction([
      this.prisma.perfiles_versiones.count({ where }),
      this.prisma.perfiles_versiones.findMany({
        where,
        orderBy: { creado_en: 'asc' }, // los más antiguos primero
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: {
            select: {
              actor_id: true, nombre_completo: true, fecha_nacimiento: true, municipio: true, ciudad: true,
              acudientes: { select: { esta_verificado: true } },
            },
          },
        },
      }),
    ]);

    const data = filas.map((v) => {
      const datos = v.datos as Partial<DatosPerfil>;
      const acudientes = v.actor.acudientes;
      return {
        actor_id: v.actor_id,
        version_id: v.version_id,
        numero_version: v.numero_version,
        nombre_completo: v.actor.nombre_completo,
        nombre_artistico: datos.nombre_artistico ?? null,
        municipio: v.actor.municipio,
        ciudad: v.actor.ciudad,
        es_menor_de_edad: calcularEdad(v.actor.fecha_nacimiento) < 18,
        // null = no aplica (mayor de edad); false = falta verificar al acudiente antes de poder aprobar
        acudiente_verificado: acudientes.length ? acudientes.some((a) => a.esta_verificado) : null,
        enviado_en: v.creado_en,
      };
    });
    return { data, total, page, limit };
  }

  // ------------------------------------------------------------ diff
  async diff(actorId: string) {
    const actor = await this.prisma.actores.findUnique({
      where: { actor_id: actorId },
      select: { actor_id: true, nombre_completo: true },
    });
    if (!actor) throw new NotFoundException('Actor no encontrado');

    const [pendiente, vigente] = await Promise.all([
      this.prisma.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'PENDIENTE' } }),
      this.prisma.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'APROBADA' } }),
    ]);
    if (!pendiente) throw new NotFoundException('El actor no tiene una versión pendiente de revisión');

    const { campos, total_cambios } = compararPerfil(
      (vigente?.datos as Partial<DatosPerfil>) ?? null,
      pendiente.datos as Partial<DatosPerfil>,
    );
    return {
      actor_id: actor.actor_id,
      nombre_completo: actor.nombre_completo,
      es_primera_version: !vigente,
      version_borrador: { version_id: pendiente.version_id, numero_version: pendiente.numero_version, enviado_en: pendiente.creado_en },
      version_publica: vigente
        ? { version_id: vigente.version_id, numero_version: vigente.numero_version, aprobada_en: vigente.revisado_en }
        : null,
      total_cambios,
      campos, // cada campo trae publicado, borrador y cambiado:true/false
    };
  }

  // ------------------------------------------------------------ aprobar
  async aprobar(actorId: string, adminId: string, versionId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { pendiente, acudientes } = await this.cargarPendiente(tx, actorId, versionId);

      // Un menor solo se aprueba con acudiente verificado
      if (acudientes.length && !acudientes.some((a) => a.esta_verificado)) {
        throw new ConflictException('El actor es menor de edad: primero debe verificarse a su acudiente legal');
      }

      const vigente = await tx.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'APROBADA' } });
      const ahora = new Date();

      // Orden importante por el índice único parcial (una sola APROBADA por actor):
      // 1) la vigente pasa a histórica  2) la pendiente pasa a aprobada.
      if (vigente) {
        await tx.perfiles_versiones.update({ where: { version_id: vigente.version_id }, data: { estado: 'HISTORICA' } });
      }
      // Reclamo atómico: si otro admin la resolvió en paralelo, count = 0 y se revierte todo.
      const reclamada = await tx.perfiles_versiones.updateMany({
        where: { version_id: pendiente.version_id, estado: 'PENDIENTE' },
        data: { estado: 'APROBADA', revisado_en: ahora, revisado_por_admin_id: adminId, motivo_rechazo: null },
      });
      if (reclamada.count !== 1) throw new ConflictException('La versión ya fue resuelta por otro administrador');

      const datos = snapshotPerfil(pendiente.datos as Partial<DatosPerfil>);
      await tx.perfiles_actores.update({
        where: { actor_id: actorId },
        data: {
          ...aColumnasPerfil(datos),
          estado: 'APROBADO',
          motivo_rechazo: null,
          revisado_en: ahora,
          revisado_por_admin_id: adminId,
          actualizado_en: ahora,
        },
      });

      const modificados = compararPerfil((vigente?.datos as Partial<DatosPerfil>) ?? null, datos)
        .campos.filter((c) => c.cambiado).map((c) => c.campo);
      await this.auditar(tx, adminId, actorId, 'APROBAR_PERFIL', {
        accion: 'APROBAR',
        version_id: pendiente.version_id,
        numero_version: pendiente.numero_version,
        version_anterior_historica: vigente?.version_id ?? null,
        campos_modificados: modificados,
      });

      return {
        actor_id: actorId,
        estado_perfil: 'APROBADO',
        version_id: pendiente.version_id,
        numero_version: pendiente.numero_version,
        version_anterior_historica: vigente?.version_id ?? null,
      };
    });
  }

  // ------------------------------------------------------------ rechazar
  async rechazar(actorId: string, adminId: string, motivo: string, versionId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const { pendiente } = await this.cargarPendiente(tx, actorId, versionId);
      const ahora = new Date();

      const reclamada = await tx.perfiles_versiones.updateMany({
        where: { version_id: pendiente.version_id, estado: 'PENDIENTE' },
        data: { estado: 'RECHAZADA', motivo_rechazo: motivo, revisado_en: ahora, revisado_por_admin_id: adminId },
      });
      if (reclamada.count !== 1) throw new ConflictException('La versión ya fue resuelta por otro administrador');

      // Si ya hay una versión pública vigente, el perfil público sigue APROBADO:
      // solo el borrador fue rechazado. Si no la hay, el perfil queda RECHAZADO.
      const vigente = await tx.perfiles_versiones.findFirst({
        where: { actor_id: actorId, estado: 'APROBADA' }, select: { version_id: true },
      });
      let estadoPerfil: 'APROBADO' | 'RECHAZADO' = 'APROBADO';
      if (!vigente) {
        estadoPerfil = 'RECHAZADO';
        await tx.perfiles_actores.update({
          where: { actor_id: actorId },
          data: { estado: 'RECHAZADO', motivo_rechazo: motivo, revisado_en: ahora, revisado_por_admin_id: adminId, actualizado_en: ahora },
        });
      }

      await this.auditar(tx, adminId, actorId, 'RECHAZAR_PERFIL', {
        accion: 'RECHAZAR',
        version_id: pendiente.version_id,
        numero_version: pendiente.numero_version,
        motivo,
        perfil_publico_vigente: !!vigente,
      });

      return {
        actor_id: actorId,
        estado_version: 'RECHAZADA',
        estado_perfil: estadoPerfil,
        version_id: pendiente.version_id,
        motivo,
      };
    });
  }

  // ------------------------------------------------------------ utilidades
  private async cargarPendiente(tx: Prisma.TransactionClient, actorId: string, versionId?: string) {
    const actor = await tx.actores.findUnique({
      where: { actor_id: actorId },
      select: { acudientes: { select: { esta_verificado: true } } },
    });
    if (!actor) throw new NotFoundException('Actor no encontrado');

    const pendiente = await tx.perfiles_versiones.findFirst({ where: { actor_id: actorId, estado: 'PENDIENTE' } });
    if (!pendiente) throw new ConflictException('El actor no tiene una versión pendiente de revisión');
    if (versionId && versionId !== pendiente.version_id) {
      throw new ConflictException('La versión pendiente cambió desde que la revisaste; vuelve a cargar el diff');
    }
    return { pendiente, acudientes: actor.acudientes };
  }

  private auditar(
    tx: Prisma.TransactionClient, adminId: string, actorId: string, observacion: string,
    detalle: Prisma.InputJsonObject,
  ) {
    return tx.historial_auditoria.create({
      data: {
        tipo_accion: 'ACCION_ADMINISTRADOR',
        entidad_afectada: 'perfiles_actores',
        entidad_id: actorId,
        realizado_por_admin_id: adminId,
        observacion_accion: observacion,
        detalle,
      },
    });
  }
}
