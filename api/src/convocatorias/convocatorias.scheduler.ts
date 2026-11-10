import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, estado_convocatoria_enum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Cada minuto: abre las PROXIMA cuya fecha_apertura llegó y cierra las que vencieron.
 * Es idempotente, así que varias instancias de la API corriendo a la vez no causan problemas.
 */
@Injectable()
export class ConvocatoriasScheduler {
  private readonly logger = new Logger(ConvocatoriasScheduler.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('* * * * *')
  async actualizarEstados() {
    const ahora = new Date();
    try {
      await this.transicion('PROXIMA', 'ACTIVA', {
        estado: 'PROXIMA', fecha_apertura: { lte: ahora }, fecha_cierre: { gt: ahora },
      });
      await this.transicion(['PROXIMA', 'ACTIVA', 'EN_PAUSA'], 'CERRADA', {
        estado: { in: ['PROXIMA', 'ACTIVA', 'EN_PAUSA'] }, fecha_cierre: { lte: ahora },
      });
    } catch (e) {
      this.logger.error(`Error actualizando estados de convocatorias: ${(e as Error).message}`);
    }
  }

  private async transicion(
    de: estado_convocatoria_enum | estado_convocatoria_enum[],
    a: estado_convocatoria_enum,
    where: Prisma.convocatoriasWhereInput,
  ) {
    const afectadas = await this.prisma.convocatorias.findMany({ where, select: { convocatoria_id: true, estado: true } });
    if (!afectadas.length) return;
    const ids = afectadas.map((c) => c.convocatoria_id);

    await this.prisma.$transaction([
      this.prisma.convocatorias.updateMany({
        where: { AND: [where, { convocatoria_id: { in: ids } }] },
        data: { estado: a, actualizado_en: new Date() },
      }),
      this.prisma.historial_auditoria.createMany({
        data: afectadas.map((c) => ({
          tipo_accion: 'ACTUALIZAR' as const,
          entidad_afectada: 'convocatorias',
          entidad_id: c.convocatoria_id,
          observacion_accion: `Transición automática ${c.estado} -> ${a}`,
          detalle: { accion: 'TRANSICION_AUTOMATICA', de: c.estado, a },
        })),
      }),
    ]);
    this.logger.log(`${ids.length} convocatoria(s): ${Array.isArray(de) ? de.join('/') : de} -> ${a}`);
  }
}
