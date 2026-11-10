import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, cursos_y_talleres, estado_curso_enum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CambiarEstadoCursoDto, CursoDto, ListarCursosDto } from './dto/cursos.dto';
import { lockCurso, promoverListaEspera } from './lista-espera';
import { ESTADOS_QUE_OCUPAN_CUPO, puedeCambiarCurso } from './transiciones';

const VISIBLES_AL_PUBLICO: estado_curso_enum[] = ['ABIERTO', 'EN_CURSO'];
type Conteo = { ocupados: number; lista_espera: number };

@Injectable()
export class CursosService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------ CRUD (admin)
  async crear(dto: CursoDto, adminId: string) {
    const columnas = this.validar(dto);
    const curso = await this.prisma.$transaction(async (tx) => {
      const c = await tx.cursos_y_talleres.create({
        data: { ...columnas, creado_por_admin_id: adminId, estado: 'BORRADOR' }, // nace oculto
      });
      await this.auditar(tx, adminId, c.curso_id, 'CREAR_CURSO', { accion: 'CREAR', tipo: c.tipo });
      return c;
    });
    return this.presentar(curso, { ocupados: 0, lista_espera: 0 }, true);
  }

  async actualizar(id: string, dto: CursoDto, adminId: string) {
    const columnas = this.validar(dto);
    return this.prisma.$transaction(async (tx) => {
      await lockCurso(tx, id);
      const actual = await tx.cursos_y_talleres.findUnique({ where: { curso_id: id } });
      if (!actual) throw new NotFoundException('Curso no encontrado');
      if (!['BORRADOR', 'ABIERTO'].includes(actual.estado)) {
        throw new ConflictException(`Un curso ${actual.estado} ya no se puede editar`);
      }
      const ocupados = await tx.inscripciones_curso.count({
        where: { curso_id: id, estado: { in: ESTADOS_QUE_OCUPAN_CUPO } },
      });
      if (columnas.cupo_maximo < ocupados) {
        throw new ConflictException(`Ya hay ${ocupados} inscritos: el cupo no puede ser menor`);
      }
      const c = await tx.cursos_y_talleres.update({
        where: { curso_id: id },
        data: { ...columnas, actualizado_en: new Date() },
      });
      // Si el cupo creció, la lista de espera ocupa los nuevos lugares
      const promovidos = await promoverListaEspera(tx, id, c.cupo_maximo);
      await this.auditar(tx, adminId, id, 'ACTUALIZAR_CURSO', { accion: 'ACTUALIZAR', promovidos });
      return this.presentar(c, await this.conteo(tx, id), true);
    });
  }

  async eliminar(id: string, adminId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockCurso(tx, id);
      const curso = await tx.cursos_y_talleres.findUnique({ where: { curso_id: id } });
      if (!curso) throw new NotFoundException('Curso no encontrado');
      const [inscripciones, certificados] = await Promise.all([
        tx.inscripciones_curso.count({ where: { curso_id: id } }),
        tx.certificados.count({ where: { curso_id: id } }),
      ]);
      if (curso.estado !== 'BORRADOR' || inscripciones > 0 || certificados > 0) {
        throw new ConflictException('Solo se puede eliminar un curso en BORRADOR sin inscripciones; cancélalo en su lugar');
      }
      await tx.cursos_y_talleres.delete({ where: { curso_id: id } });
      await this.auditar(tx, adminId, id, 'ELIMINAR_CURSO', { accion: 'ELIMINAR', titulo: curso.titulo });
    });
    return { message: 'Curso eliminado' };
  }

  // ------------------------------------------------------------ estados
  async cambiarEstado(id: string, dto: CambiarEstadoCursoDto, adminId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockCurso(tx, id);
      const actual = await tx.cursos_y_talleres.findUnique({ where: { curso_id: id } });
      if (!actual) throw new NotFoundException('Curso no encontrado');
      if (!puedeCambiarCurso(actual.estado, dto.estado)) {
        throw new ConflictException(`No se puede pasar de ${actual.estado} a ${dto.estado}`);
      }
      if (dto.estado === 'ABIERTO' && (!actual.fecha_fin_curso || actual.fecha_inicio_curso <= new Date())) {
        throw new ConflictException('Para abrir inscripciones, la fecha de inicio del curso debe ser futura');
      }

      const r = await tx.cursos_y_talleres.updateMany({
        where: { curso_id: id, estado: actual.estado },
        data: { estado: dto.estado, actualizado_en: new Date() },
      });
      if (r.count !== 1) throw new ConflictException('El estado cambió mientras lo editabas; recarga');

      let canceladas = 0;
      if (dto.estado === 'CANCELADO') {
        // Quienes estaban inscritos o en espera quedan cancelados (queda en la auditoría)
        const res = await tx.inscripciones_curso.updateMany({
          where: { curso_id: id, estado: { in: ['INSCRITO', 'LISTA_ESPERA'] } },
          data: { estado: 'CANCELADA', actualizado_en: new Date(), revisado_por_admin_id: adminId, notas_admin: 'Curso cancelado' },
        });
        canceladas = res.count;
      }
      await this.auditar(tx, adminId, id, 'CAMBIAR_ESTADO_CURSO', {
        accion: 'CAMBIAR_ESTADO', de: actual.estado, a: dto.estado, motivo: dto.motivo ?? null, inscripciones_canceladas: canceladas,
      });
      return { curso_id: id, estado_anterior: actual.estado, estado: dto.estado, inscripciones_canceladas: canceladas };
    });
  }

  // ------------------------------------------------------------ consulta
  async listar(q: ListarCursosDto, esAdmin: boolean) {
    const { page = 1, limit = 20 } = q;
    const where: Prisma.cursos_y_talleresWhereInput = {
      ...(esAdmin ? (q.estado ? { estado: q.estado } : {}) : { estado: { in: VISIBLES_AL_PUBLICO } }),
      ...(q.tipo ? { tipo: q.tipo } : {}),
    };
    const [total, filas] = await this.prisma.$transaction([
      this.prisma.cursos_y_talleres.count({ where }),
      this.prisma.cursos_y_talleres.findMany({
        where,
        orderBy: [{ fecha_inicio_curso: 'asc' }, { curso_id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { actividades: true } } },
      }),
    ]);

    const conteos = await this.conteos(filas.map((f) => f.curso_id));
    return {
      data: filas.map((c) => this.presentar(c, conteos.get(c.curso_id) ?? { ocupados: 0, lista_espera: 0 }, esAdmin, c._count.actividades)),
      total, page, limit,
    };
  }

  async obtener(id: string, esAdmin: boolean) {
    const c = await this.prisma.cursos_y_talleres.findUnique({
      where: { curso_id: id },
      include: { _count: { select: { actividades: true } } },
    });
    if (!c || (!esAdmin && !VISIBLES_AL_PUBLICO.includes(c.estado))) throw new NotFoundException('Curso no encontrado');
    return this.presentar(c, await this.conteo(this.prisma, id), esAdmin, c._count.actividades);
  }

  // ------------------------------------------------------------ utilidades
  private validar(dto: CursoDto) {
    const inscripcion = new Date(dto.fecha_inicio_inscripcion);
    const inicio = new Date(dto.fecha_inicio_curso);
    const fin = new Date(dto.fecha_fin_curso);
    if (inscripcion > inicio) throw new BadRequestException('Las inscripciones deben abrir antes de que empiece el curso');
    if (inicio >= fin) throw new BadRequestException('fecha_fin_curso debe ser posterior a fecha_inicio_curso');
    if (fin <= new Date()) throw new BadRequestException('fecha_fin_curso debe ser una fecha futura');
    return {
      titulo: dto.titulo,
      tipo: dto.tipo,
      descripcion: dto.descripcion,
      instructor: dto.instructor ?? null,
      modalidad: dto.modalidad,
      lugar: dto.lugar ?? null,
      fecha_inicio_inscripcion: inscripcion,
      fecha_inicio_curso: inicio,
      fecha_fin_curso: fin,
      cupo_maximo: dto.cupo_maximo,
      horas_totales: dto.horas_totales ?? null,
      es_proceso_formacion: dto.es_proceso_formacion ?? false,
      solo_mayores_de_edad: dto.solo_mayores_de_edad ?? false,
    };
  }

  private async conteo(db: Prisma.TransactionClient | PrismaService, cursoId: string): Promise<Conteo> {
    const [ocupados, lista_espera] = await Promise.all([
      db.inscripciones_curso.count({ where: { curso_id: cursoId, estado: { in: ESTADOS_QUE_OCUPAN_CUPO } } }),
      db.inscripciones_curso.count({ where: { curso_id: cursoId, estado: 'LISTA_ESPERA' } }),
    ]);
    return { ocupados, lista_espera };
  }

  private async conteos(ids: string[]): Promise<Map<string, Conteo>> {
    const mapa = new Map<string, Conteo>();
    if (!ids.length) return mapa;
    const filas = await this.prisma.inscripciones_curso.groupBy({
      by: ['curso_id', 'estado'],
      where: { curso_id: { in: ids }, estado: { in: [...ESTADOS_QUE_OCUPAN_CUPO, 'LISTA_ESPERA'] } },
      _count: { _all: true },
    });
    for (const f of filas) {
      const c = mapa.get(f.curso_id) ?? { ocupados: 0, lista_espera: 0 };
      if (f.estado === 'LISTA_ESPERA') c.lista_espera += f._count._all;
      else c.ocupados += f._count._all;
      mapa.set(f.curso_id, c);
    }
    return mapa;
  }

  /** El público ve cupos disponibles; la cola de espera y quién lo creó son datos internos. */
  private presentar(c: cursos_y_talleres, conteo: Conteo, esAdmin: boolean, totalActividades?: number) {
    const { creado_por_admin_id, ...resto } = c;
    return {
      ...resto,
      cupos_disponibles: Math.max(0, c.cupo_maximo - conteo.ocupados),
      ...(totalActividades !== undefined ? { total_actividades: totalActividades } : {}),
      ...(esAdmin ? { creado_por_admin_id, inscritos: conteo.ocupados, en_lista_espera: conteo.lista_espera } : {}),
    };
  }

  private auditar(
    tx: Prisma.TransactionClient, adminId: string, cursoId: string, observacion: string,
    detalle: Prisma.InputJsonObject,
  ) {
    return tx.historial_auditoria.create({
      data: {
        tipo_accion: 'ACCION_ADMINISTRADOR',
        entidad_afectada: 'cursos_y_talleres',
        entidad_id: cursoId,
        realizado_por_admin_id: adminId,
        observacion_accion: observacion,
        detalle,
      },
    });
  }
}
