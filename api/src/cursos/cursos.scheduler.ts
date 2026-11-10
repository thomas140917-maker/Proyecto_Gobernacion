import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, estado_curso_enum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cada minuto: ABIERTO -> EN_CURSO cuando llega la fecha de inicio, y -> FINALIZADO al terminar.
 * Idempotente: varias instancias de la API corriendo a la vez no causan problemas.
 */
@Injectable()
export class CursosScheduler {
  private readonly logger = new Logger(CursosScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('* * * * *')
  async actualizarEstados() {
    const ahora = new Date();
    try {
      await this.transicion('EN_CURSO', {
        estado: 'ABIERTO', fecha_inicio_curso: { lte: ahora }, fecha_fin_curso: { gt: ahora },
      });
      await this.transicion('FINALIZADO', {
        estado: { in: ['ABIERTO', 'EN_CURSO'] }, fecha_fin_curso: { lte: ahora },
      });
    } catch (e) {
      this.logger.error(`Error actualizando estados de cursos: ${(e as Error).message}`);
    }
  }

  private async transicion(a: estado_curso_enum, where: Prisma.cursos_y_talleresWhereInput) {
    const afectados = await this.prisma.cursos_y_talleres.findMany({ where, select: { curso_id: true, estado: true } });
    if (!afectados.length) return;
    const ids = afectados.map((c) => c.curso_id);

    await this.prisma.$transaction([
      this.prisma.cursos_y_talleres.updateMany({
        where: { AND: [where, { curso_id: { in: ids } }] },
        data: { estado: a, actualizado_en: new Date() },
      }),
      this.prisma.historial_auditoria.createMany({
        data: afectados.map((c) => ({
          tipo_accion: 'ACTUALIZAR' as const,
          entidad_afectada: 'cursos_y_talleres',
          entidad_id: c.curso_id,
          observacion_accion: `Transición automática ${c.estado} -> ${a}`,
          detalle: { accion: 'TRANSICION_AUTOMATICA', de: c.estado, a },
        })),
      }),
    ]);
    this.logger.log(`${ids.length} curso(s) -> ${a}`);
  }
}
