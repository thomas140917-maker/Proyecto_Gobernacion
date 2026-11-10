import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, estado_convocatoria_enum } from '@prisma/client';
import { evaluarCompatibilidad } from '../casting/compatibilidad';
import { perfilCastingDesdeActor, requisitosDesdeConvocatoria } from '../casting/mapeadores';
import { calcularEdad } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { CambiarEstadoPostulacionDto } from './dto/postulacion.dto';
import { puedeCambiarPostulacion } from './transiciones';

const MENSAJE_ESTADO: Record<estado_convocatoria_enum, string> = {
  PROXIMA: 'La convocatoria aún no abre',
  ACTIVA: '',
  EN_PAUSA: 'La convocatoria está en pausa',
  CERRADA: 'La convocatoria está cerrada',
};

@Injectable()
export class PostulacionesService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ actor: postularse
  async postular(actorId: string, convocatoriaId: string) {
    const ahora = new Date();
    const convocatoria = await this.prisma.convocatorias.findUnique({
      where: { convocatoria_id: convocatoriaId },
      include: { habilidades: { include: { habilidad: { select: { nombre: true } } } } },
    });
    if (!convocatoria) throw new NotFoundException('Convocatoria no encontrada');
    if (convocatoria.estado !== 'ACTIVA') throw new ConflictException(MENSAJE_ESTADO[convocatoria.estado]);
    if (convocatoria.fecha_cierre <= ahora) throw new ConflictException('La convocatoria ya venció');

    const actor = await this.prisma.actores.findUnique({
      where: { actor_id: actorId },
      include: {
        perfil: true,
        acudientes: { select: { esta_verificado: true } },
        habilidades: { select: { habilidad_id: true } },
      },
    });
    if (!actor || !actor.esta_activo) throw new ForbiddenException('Cuenta no habilitada');
    if (actor.perfil?.estado !== 'APROBADO') {
      throw new ForbiddenException('Tu perfil debe estar aprobado para postularte');
    }
    if (calcularEdad(actor.fecha_nacimiento) < 18 && !actor.acudientes.some((a) => a.esta_verificado)) {
      throw new ForbiddenException('Un menor de edad necesita su acudiente legal verificado para postularse');
    }

    const resultado = evaluarCompatibilidad(
      perfilCastingDesdeActor(actor),
      requisitosDesdeConvocatoria(convocatoria),
    );
    if (!resultado.cumple) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'No cumples los requisitos obligatorios de esta convocatoria',
        incumplimientos: resultado.incumplimientos,
      });
    }

    try {
      const postulacion = await this.prisma.$transaction(async (tx) => {
        const p = await tx.postulaciones_castings.create({
          data: {
            convocatoria_id: convocatoriaId,
            actor_id: actorId,
            estado: 'POSTULADO',
            compatibilidad: resultado.compatibilidad,
            detalle_compatibilidad: JSON.parse(JSON.stringify(resultado.detalle)),
          },
        });
        await tx.historial_auditoria.create({
          data: {
            tipo_accion: 'CREAR',
            entidad_afectada: 'postulaciones_castings',
            entidad_id: p.postulacion_id,
            realizado_por_actor_id: actorId,
            observacion_accion: 'Postulación a convocatoria',
            detalle: { convocatoria_id: convocatoriaId, compatibilidad: resultado.compatibilidad },
          },
        });
        return p;
      });
      return {
        postulacion_id: postulacion.postulacion_id,
        convocatoria_id: convocatoriaId,
        estado: postulacion.estado,
        compatibilidad: postulacion.compatibilidad,
        opcionales_no_cumplidos: resultado.opcionales_no_cumplidos,
        postulado_en: postulacion.postulado_en,
      };
    } catch (e) {
      // Llave única (convocatoria_id + actor_id): impide aplicaciones repetidas, incluso en paralelo.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya te postulaste a esta convocatoria');
      }
      throw e;
    }
  }

  // ------------------------------------------------------------ actor: ver y retirar
  async mias(actorId: string) {
    const filas = await this.prisma.postulaciones_castings.findMany({
      where: { actor_id: actorId },
      orderBy: { postulado_en: 'desc' },
      take: 200,
      include: { convocatoria: { select: { convocatoria_id: true, titulo: true, estado: true, fecha_cierre: true, modalidad: true } } },
    });
    // notas_admin es interno: el actor no lo ve
    return filas.map((p) => ({
      postulacion_id: p.postulacion_id,
      estado: p.estado,
      compatibilidad: p.compatibilidad,
      postulado_en: p.postulado_en,
      actualizado_en: p.actualizado_en,
      convocatoria: p.convocatoria,
    }));
  }

  async retirar(actorId: string, postulacionId: string) {
    const p = await this.prisma.postulaciones_castings.findFirst({
      where: { postulacion_id: postulacionId, actor_id: actorId },
    });
    if (!p) throw new NotFoundException('Postulación no encontrada');
    if (!['POSTULADO', 'EN_REVISION'].includes(p.estado)) {
      throw new ConflictException('Ya no puedes retirar esta postulación porque avanzó en el proceso');
    }
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.postulaciones_castings.deleteMany({
        where: { postulacion_id: postulacionId, actor_id: actorId, estado: { in: ['POSTULADO', 'EN_REVISION'] } },
      });
      if (r.count !== 1) throw new ConflictException('La postulación cambió de estado; recarga e intenta de nuevo');
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ELIMINAR',
          entidad_afectada: 'postulaciones_castings',
          entidad_id: postulacionId,
          realizado_por_actor_id: actorId,
          observacion_accion: 'Retiro de postulación por el actor',
          detalle: { convocatoria_id: p.convocatoria_id, estado: p.estado },
        },
      });
    });
    return { message: 'Postulación retirada' };
  }

  // ------------------------------------------------------------ admin: mover en el Kanban
  async cambiarEstado(id: string, adminId: string, dto: CambiarEstadoPostulacionDto) {
    const inicial = await this.prisma.postulaciones_castings.findUnique({
      where: { postulacion_id: id }, select: { convocatoria_id: true },
    });
    if (!inicial) throw new NotFoundException('Postulación no encontrada');

    return this.prisma.$transaction(async (tx) => {
      // Un lock por convocatoria serializa los cambios y protege el tope de vacantes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${inicial.convocatoria_id}))`;

      const p = await tx.postulaciones_castings.findUnique({
        where: { postulacion_id: id },
        include: { convocatoria: { select: { cupo_maximo: true } } },
      });
      if (!p) throw new NotFoundException('Postulación no encontrada');
      if (dto.estado_anterior && dto.estado_anterior !== p.estado) {
        throw new ConflictException(`La tarjeta ya está en ${p.estado}; recarga el tablero`);
      }
      if (p.estado === dto.estado) throw new ConflictException(`La postulación ya está en ${dto.estado}`);
      if (!puedeCambiarPostulacion(p.estado, dto.estado)) {
        throw new ConflictException(`No se puede pasar de ${p.estado} a ${dto.estado}`);
      }
      if (dto.estado === 'RECHAZADO' && (dto.notas ?? '').length < 10) {
        throw new BadRequestException('Para rechazar indica el motivo en "notas" (mínimo 10 caracteres)');
      }
      if (dto.estado === 'SELECCIONADO') {
        const seleccionados = await tx.postulaciones_castings.count({
          where: { convocatoria_id: p.convocatoria_id, estado: 'SELECCIONADO' },
        });
        if (seleccionados >= p.convocatoria.cupo_maximo) {
          throw new ConflictException(`Ya se completaron las ${p.convocatoria.cupo_maximo} vacantes de la convocatoria`);
        }
      }

      const ahora = new Date();
      const r = await tx.postulaciones_castings.updateMany({
        where: { postulacion_id: id, estado: p.estado },
        data: {
          estado: dto.estado,
          notas_admin: dto.notas ?? p.notas_admin,
          revisado_por_admin_id: adminId,
          actualizado_en: ahora,
        },
      });
      if (r.count !== 1) throw new ConflictException('La postulación cambió mientras la editabas; recarga el tablero');

      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACCION_ADMINISTRADOR',
          entidad_afectada: 'postulaciones_castings',
          entidad_id: id,
          realizado_por_admin_id: adminId,
          observacion_accion: 'CAMBIAR_ESTADO_POSTULACION',
          detalle: {
            accion: 'CAMBIAR_ESTADO_POSTULACION',
            de: p.estado, a: dto.estado,
            convocatoria_id: p.convocatoria_id, actor_id: p.actor_id,
            notas: dto.notas ?? null,
          },
        },
      });
      return {
        postulacion_id: id, convocatoria_id: p.convocatoria_id,
        estado_anterior: p.estado, estado: dto.estado, actualizado_en: ahora,
      };
    });
  }
}
