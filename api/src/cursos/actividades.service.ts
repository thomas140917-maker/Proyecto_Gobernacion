import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsuarioSesion } from '../auth/bearer';
import { PrismaService } from '../prisma/prisma.service';
import { ActividadDto } from './dto/cursos.dto';

@Injectable()
export class ActividadesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Admin: todas. Actor: solo si participa en el curso (los enlaces de sesión no son públicos). */
  async listar(cursoId: string, usuario: UsuarioSesion) {
    const curso = await this.prisma.cursos_y_talleres.findUnique({ where: { curso_id: cursoId }, select: { estado: true } });
    if (!curso || (usuario.tipo === 'ACTOR' && curso.estado === 'BORRADOR')) throw new NotFoundException('Curso no encontrado');

    if (usuario.tipo === 'ACTOR') {
      const insc = await this.prisma.inscripciones_curso.findUnique({
        where: { curso_id_actor_id: { curso_id: cursoId, actor_id: usuario.id } },
        select: { estado: true },
      });
      if (!insc || !['INSCRITO', 'COMPLETADA', 'NO_COMPLETADA'].includes(insc.estado)) {
        throw new ForbiddenException('Solo los inscritos pueden ver las actividades del curso');
      }
    }
    return this.prisma.actividades_curso.findMany({
      where: { curso_id: cursoId },
      orderBy: [{ orden: 'asc' }, { fecha_inicio: 'asc' }, { actividad_id: 'asc' }],
    });
  }

  async crear(cursoId: string, dto: ActividadDto, adminId: string) {
    await this.exigirCurso(cursoId);
    const datos = this.validar(dto);
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.actividades_curso.create({ data: { ...datos, curso_id: cursoId } });
      await this.auditar(tx, adminId, a.actividad_id, 'CREAR_ACTIVIDAD', { accion: 'CREAR', curso_id: cursoId });
      return a;
    });
  }

  async actualizar(cursoId: string, actividadId: string, dto: ActividadDto, adminId: string) {
    await this.exigirActividad(cursoId, actividadId);
    const datos = this.validar(dto);
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.actividades_curso.update({ where: { actividad_id: actividadId }, data: datos });
      await this.auditar(tx, adminId, actividadId, 'ACTUALIZAR_ACTIVIDAD', { accion: 'ACTUALIZAR', curso_id: cursoId });
      return a;
    });
  }

  async eliminar(cursoId: string, actividadId: string, adminId: string) {
    await this.exigirActividad(cursoId, actividadId);
    await this.prisma.$transaction(async (tx) => {
      await tx.actividades_curso.delete({ where: { actividad_id: actividadId } });
      await this.auditar(tx, adminId, actividadId, 'ELIMINAR_ACTIVIDAD', { accion: 'ELIMINAR', curso_id: cursoId });
    });
    return { message: 'Actividad eliminada' };
  }

  // ------------------------------------------------------------ utilidades
  private async exigirCurso(cursoId: string) {
    const c = await this.prisma.cursos_y_talleres.findUnique({ where: { curso_id: cursoId }, select: { curso_id: true } });
    if (!c) throw new NotFoundException('Curso no encontrado');
  }

  private async exigirActividad(cursoId: string, actividadId: string) {
    const a = await this.prisma.actividades_curso.findFirst({ where: { actividad_id: actividadId, curso_id: cursoId }, select: { actividad_id: true } });
    if (!a) throw new NotFoundException('Actividad no encontrada');
  }

  private validar(dto: ActividadDto) {
    const inicio = dto.fecha_inicio ? new Date(dto.fecha_inicio) : null;
    const fin = dto.fecha_fin ? new Date(dto.fecha_fin) : null;
    if (inicio && fin && inicio > fin) throw new BadRequestException('fecha_inicio no puede ser posterior a fecha_fin');
    // Si parece un enlace (tiene esquema), debe ser https: se renderiza como link en el frontend.
    const lugar = dto.lugar_o_enlace ?? null;
    if (lugar && /^[a-z][a-z0-9+.-]*:/i.test(lugar) && !/^https:\/\//i.test(lugar)) {
      throw new BadRequestException('Los enlaces deben empezar con https://');
    }
    return {
      tipo: dto.tipo ?? 'SESION',
      titulo: dto.titulo,
      descripcion: dto.descripcion ?? null,
      fecha_inicio: inicio,
      fecha_fin: fin,
      lugar_o_enlace: lugar,
      orden: dto.orden ?? 0,
    };
  }

  private auditar(
    tx: Prisma.TransactionClient, adminId: string, actividadId: string, observacion: string,
    detalle: Prisma.InputJsonObject,
  ) {
    return tx.historial_auditoria.create({
      data: {
        tipo_accion: 'ACCION_ADMINISTRADOR',
        entidad_afectada: 'actividades_curso',
        entidad_id: actividadId,
        realizado_por_admin_id: adminId,
        observacion_accion: observacion,
        detalle,
      },
    });
  }
}
