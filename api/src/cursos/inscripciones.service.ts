import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { estado_curso_enum } from '@prisma/client';
import { calcularEdad } from '../common/fechas';
import { PrismaService } from '../prisma/prisma.service';
import { CambiarEstadoInscripcionDto, ListarInscripcionesDto } from './dto/cursos.dto';
import { lockCurso, promoverListaEspera } from './lista-espera';
import { ESTADOS_QUE_OCUPAN_CUPO, puedeCambiarInscripcion } from './transiciones';

const MENSAJE_ESTADO: Record<estado_curso_enum, string> = {
  BORRADOR: '',
  ABIERTO: '',
  EN_CURSO: 'El curso ya comenzó: las inscripciones están cerradas',
  FINALIZADO: 'El curso ya finalizó',
  CANCELADO: 'El curso fue cancelado',
};

@Injectable()
export class InscripcionesService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ actor: inscribirse
  async inscribir(actorId: string, cursoId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Un lock por curso serializa inscripciones y cancelaciones: nunca se supera el cupo.
      await lockCurso(tx, cursoId);

      const curso = await tx.cursos_y_talleres.findUnique({ where: { curso_id: cursoId } });
      // Un borrador no existe para los actores
      if (!curso || curso.estado === 'BORRADOR') throw new NotFoundException('Curso no encontrado');
      if (curso.estado !== 'ABIERTO') throw new ConflictException(MENSAJE_ESTADO[curso.estado]);
      const ahora = new Date();
      if (ahora < curso.fecha_inicio_inscripcion) throw new ConflictException('Las inscripciones aún no abren');
      if (ahora >= curso.fecha_inicio_curso) throw new ConflictException('Las inscripciones ya cerraron');

      const actor = await tx.actores.findUnique({
        where: { actor_id: actorId },
        select: { esta_activo: true, fecha_nacimiento: true, acudientes: { select: { esta_verificado: true } } },
      });
      if (!actor?.esta_activo) throw new ForbiddenException('Cuenta no habilitada');
      const esMenor = calcularEdad(actor.fecha_nacimiento) < 18;
      if (esMenor && curso.solo_mayores_de_edad) throw new ForbiddenException('Este curso es solo para mayores de 18 años');
      if (esMenor && !actor.acudientes.some((a) => a.esta_verificado)) {
        throw new ForbiddenException('Un menor de edad necesita su acudiente legal verificado para inscribirse');
      }

      const previa = await tx.inscripciones_curso.findUnique({
        where: { curso_id_actor_id: { curso_id: cursoId, actor_id: actorId } },
      });
      if (previa && previa.estado !== 'CANCELADA') {
        throw new ConflictException(`Ya tienes una inscripción en este curso (${previa.estado})`);
      }
      if (previa?.revisado_por_admin_id) {
        throw new ForbiddenException('Tu inscripción fue cancelada por la organización; comunícate con el Centro');
      }

      const ocupados = await tx.inscripciones_curso.count({
        where: { curso_id: cursoId, estado: { in: ESTADOS_QUE_OCUPAN_CUPO } },
      });
      const estado = ocupados < curso.cupo_maximo ? 'INSCRITO' : 'LISTA_ESPERA';

      // Una inscripción cancelada por el propio actor se reactiva (y va al final de la fila)
      const inscripcion = previa
        ? await tx.inscripciones_curso.update({
            where: { inscripcion_id: previa.inscripcion_id },
            data: { estado, inscrito_en: ahora, actualizado_en: ahora },
          })
        : await tx.inscripciones_curso.create({
            data: { curso_id: cursoId, actor_id: actorId, estado, inscrito_en: ahora, actualizado_en: ahora },
          });

      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'CREAR',
          entidad_afectada: 'inscripciones_curso',
          entidad_id: inscripcion.inscripcion_id,
          realizado_por_actor_id: actorId,
          observacion_accion: estado === 'INSCRITO' ? 'Inscripción a curso' : 'Ingreso a lista de espera',
          detalle: { curso_id: cursoId, estado, reactivada: !!previa },
        },
      });

      const posicion =
        estado === 'LISTA_ESPERA'
          ? await tx.inscripciones_curso.count({
              where: { curso_id: cursoId, estado: 'LISTA_ESPERA', inscrito_en: { lte: inscripcion.inscrito_en } },
            })
          : null;
      return {
        inscripcion_id: inscripcion.inscripcion_id,
        curso_id: cursoId,
        estado,
        posicion_lista_espera: posicion,
        message: estado === 'INSCRITO' ? 'Inscripción confirmada' : 'El curso está lleno: quedaste en la lista de espera',
      };
    });
  }

  // ------------------------------------------------------------ actor: cancelar y consultar
  async cancelar(actorId: string, cursoId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockCurso(tx, cursoId);
      const curso = await tx.cursos_y_talleres.findUnique({ where: { curso_id: cursoId } });
      if (!curso || curso.estado === 'BORRADOR') throw new NotFoundException('Curso no encontrado');
      if (['FINALIZADO', 'CANCELADO'].includes(curso.estado)) throw new ConflictException(MENSAJE_ESTADO[curso.estado]);

      const insc = await tx.inscripciones_curso.findUnique({
        where: { curso_id_actor_id: { curso_id: cursoId, actor_id: actorId } },
      });
      if (!insc || !['INSCRITO', 'LISTA_ESPERA'].includes(insc.estado)) {
        throw new NotFoundException('No tienes una inscripción activa en este curso');
      }

      await tx.inscripciones_curso.update({
        where: { inscripcion_id: insc.inscripcion_id },
        data: { estado: 'CANCELADA', actualizado_en: new Date(), revisado_por_admin_id: null },
      });
      const promovidos = await promoverListaEspera(tx, cursoId, curso.cupo_maximo);
      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACTUALIZAR',
          entidad_afectada: 'inscripciones_curso',
          entidad_id: insc.inscripcion_id,
          realizado_por_actor_id: actorId,
          observacion_accion: 'Cancelación de inscripción por el actor',
          detalle: { curso_id: cursoId, estado_anterior: insc.estado, promovidos },
        },
      });
      return { message: 'Inscripción cancelada' };
    });
  }

  async mias(actorId: string) {
    const filas = await this.prisma.inscripciones_curso.findMany({
      where: { actor_id: actorId },
      orderBy: { inscrito_en: 'desc' },
      take: 200,
      include: {
        curso: {
          select: {
            curso_id: true, titulo: true, tipo: true, estado: true, modalidad: true, lugar: true,
            fecha_inicio_curso: true, fecha_fin_curso: true, horas_totales: true,
          },
        },
      },
    });
    return Promise.all(
      filas.map(async (f) => ({
        inscripcion_id: f.inscripcion_id,
        estado: f.estado,
        inscrito_en: f.inscrito_en,
        posicion_lista_espera:
          f.estado === 'LISTA_ESPERA'
            ? await this.prisma.inscripciones_curso.count({
                where: { curso_id: f.curso_id, estado: 'LISTA_ESPERA', inscrito_en: { lte: f.inscrito_en } },
              })
            : null,
        curso: f.curso,
      })),
    );
  }

  // ------------------------------------------------------------ admin
  async listar(cursoId: string, q: ListarInscripcionesDto) {
    const { page = 1, limit = 20 } = q;
    const curso = await this.prisma.cursos_y_talleres.findUnique({ where: { curso_id: cursoId }, select: { curso_id: true } });
    if (!curso) throw new NotFoundException('Curso no encontrado');

    const where = { curso_id: cursoId, ...(q.estado ? { estado: q.estado } : {}) };
    const [total, filas] = await this.prisma.$transaction([
      this.prisma.inscripciones_curso.count({ where }),
      this.prisma.inscripciones_curso.findMany({
        where,
        orderBy: [{ inscrito_en: 'asc' }, { inscripcion_id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { actor: { select: { actor_id: true, nombre_completo: true, correo: true, telefono: true, municipio: true } } },
      }),
    ]);
    return {
      data: filas.map((f) => ({
        inscripcion_id: f.inscripcion_id, estado: f.estado, inscrito_en: f.inscrito_en,
        notas_admin: f.notas_admin, actor: f.actor,
      })),
      total, page, limit,
    };
  }

  async cambiarEstado(cursoId: string, inscripcionId: string, adminId: string, dto: CambiarEstadoInscripcionDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockCurso(tx, cursoId);
      const insc = await tx.inscripciones_curso.findFirst({
        where: { inscripcion_id: inscripcionId, curso_id: cursoId },
        include: { curso: { select: { estado: true, cupo_maximo: true } } },
      });
      if (!insc) throw new NotFoundException('Inscripción no encontrada');
      if (insc.estado === dto.estado) throw new ConflictException(`La inscripción ya está en ${dto.estado}`);
      if (!puedeCambiarInscripcion(insc.estado, dto.estado)) {
        throw new ConflictException(`No se puede pasar de ${insc.estado} a ${dto.estado}`);
      }
      if (['COMPLETADA', 'NO_COMPLETADA'].includes(dto.estado) && !['EN_CURSO', 'FINALIZADO'].includes(insc.curso.estado)) {
        throw new ConflictException('El resultado solo se registra cuando el curso está en curso o finalizado');
      }
      if (dto.estado === 'CANCELADA' && (dto.notas ?? '').length < 5) {
        throw new BadRequestException('Para cancelar una inscripción indica el motivo en "notas"');
      }

      const ahora = new Date();
      const r = await tx.inscripciones_curso.updateMany({
        where: { inscripcion_id: inscripcionId, estado: insc.estado },
        data: { estado: dto.estado, notas_admin: dto.notas ?? insc.notas_admin, revisado_por_admin_id: adminId, actualizado_en: ahora },
      });
      if (r.count !== 1) throw new ConflictException('La inscripción cambió mientras la editabas; recarga');

      // Si deja de estar COMPLETADA, la constancia emitida ya no es válida
      let certificadosRevocados = 0;
      if (insc.estado === 'COMPLETADA') {
        const rev = await tx.certificados.updateMany({
          where: { actor_id: insc.actor_id, curso_id: cursoId, tipo: 'CURSO', revocado_en: null },
          data: { revocado_en: ahora, motivo_revocacion: 'Cambio de resultado de la inscripción', revocado_por_admin_id: adminId },
        });
        certificadosRevocados = rev.count;
      }
      // Si liberó un cupo, entra el primero de la lista de espera
      const promovidos = dto.estado === 'CANCELADA'
        ? await promoverListaEspera(tx, cursoId, insc.curso.cupo_maximo)
        : 0;

      await tx.historial_auditoria.create({
        data: {
          tipo_accion: 'ACCION_ADMINISTRADOR',
          entidad_afectada: 'inscripciones_curso',
          entidad_id: inscripcionId,
          realizado_por_admin_id: adminId,
          observacion_accion: 'CAMBIAR_ESTADO_INSCRIPCION',
          detalle: {
            accion: 'CAMBIAR_ESTADO_INSCRIPCION', de: insc.estado, a: dto.estado, curso_id: cursoId,
            actor_id: insc.actor_id, notas: dto.notas ?? null, certificados_revocados: certificadosRevocados, promovidos,
          },
        },
      });
      return { inscripcion_id: inscripcionId, estado_anterior: insc.estado, estado: dto.estado, promovidos, certificados_revocados: certificadosRevocados };
    });
  }
}
