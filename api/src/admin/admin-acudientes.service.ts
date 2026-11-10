import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { extname } from 'path';
import { calcularEdad } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png' };

@Injectable()
export class AdminAcudientesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async pendientes(page = 1, limit = 20) {
    const where = { esta_verificado: false };
    const [total, filas] = await this.prisma.$transaction([
      this.prisma.acudientes_legales.count({ where }),
      this.prisma.acudientes_legales.findMany({
        where,
        orderBy: { actor: { creado_en: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { actor_id: true, nombre_completo: true, fecha_nacimiento: true } } },
      }),
    ]);
    const data = filas.map((a) => ({
      acudiente_id: a.acudiente_id,
      actor_id: a.actor_id,
      nombre_actor: a.actor.nombre_completo,
      edad_actor: calcularEdad(a.actor.fecha_nacimiento),
      nombre_acudiente: a.nombre_acudiente,
      documento_acudiente: a.documento_acudiente,
      telefono_acudiente: a.telefono_acudiente,
      correo_acudiente: a.correo_acudiente,
    }));
    return { data, total, page, limit };
  }

  async verificar(acudienteId: string, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      const acudiente = await tx.acudientes_legales.findUnique({ where: { acudiente_id: acudienteId } });
      if (!acudiente) throw new NotFoundException('Acudiente no encontrado');

      const r = await tx.acudientes_legales.updateMany({
        where: { acudiente_id: acudienteId, esta_verificado: false },
        data: { esta_verificado: true, verificado_por_admin_id: adminId },
      });
      if (r.count !== 1) throw new ConflictException('El acudiente ya estaba verificado');

      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACCION_ADMINISTRADOR',
          entidad_afectada: 'acudientes_legales',
          entidad_id: acudienteId,
          realizado_por_admin_id: adminId,
          observacion_accion: 'VERIFICAR_ACUDIENTE',
          detalle: { accion: 'VERIFICAR_ACUDIENTE', actor_id: acudiente.actor_id },
        },
      });
      return { acudiente_id: acudienteId, actor_id: acudiente.actor_id, esta_verificado: true };
    });
  }

  /** Descarga el documento de autorización (dato sensible) desde S3 y deja constancia de quién lo consultó. */
  async abrirDocumento(acudienteId: string, adminId: string) {
    const acudiente = await this.prisma.acudientes_legales.findUnique({
      where: { acudiente_id: acudienteId },
      select: { actor_id: true, url_documento_autorizacion: true },
    });
    if (!acudiente) throw new NotFoundException('Acudiente no encontrado');

    // Lanza 404 si el objeto no existe (p. ej. registros anteriores guardados en disco local).
    const buffer = await this.storage.descargar(acudiente.url_documento_autorizacion);

    await this.prisma.historial_auditoria.create({
      data: {
        tipo_accion: 'ACCION_ADMINISTRADOR',
        entidad_afectada: 'acudientes_legales',
        entidad_id: acudienteId,
        realizado_por_admin_id: adminId,
        observacion_accion: 'VER_DOCUMENTO_AUTORIZACION',
        detalle: { accion: 'VER_DOCUMENTO_AUTORIZACION', actor_id: acudiente.actor_id },
      },
    });

    const ext = extname(acudiente.url_documento_autorizacion).toLowerCase();
    return { buffer, contentType: MIME[ext] ?? 'application/octet-stream', ext };
  }
}
