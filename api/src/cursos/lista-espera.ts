import { Prisma } from '@prisma/client';
import { ESTADOS_QUE_OCUPAN_CUPO } from './transiciones';

/**
 * Llena los cupos libres con la lista de espera (FIFO por inscrito_en).
 * DEBE llamarse dentro de una transacción que ya tenga el lock advisory del curso.
 */
export async function promoverListaEspera(
  tx: Prisma.TransactionClient,
  cursoId: string,
  cupoMaximo: number,
): Promise<number> {
  const ocupados = await tx.inscripciones_curso.count({
    where: { curso_id: cursoId, estado: { in: ESTADOS_QUE_OCUPAN_CUPO } },
  });
  const libres = cupoMaximo - ocupados;
  if (libres <= 0) return 0;

  const siguientes = await tx.inscripciones_curso.findMany({
    where: { curso_id: cursoId, estado: 'LISTA_ESPERA' },
    orderBy: { inscrito_en: 'asc' },
    take: libres,
    select: { inscripcion_id: true, actor_id: true },
  });
  if (!siguientes.length) return 0;

  await tx.inscripciones_curso.updateMany({
    where: { inscripcion_id: { in: siguientes.map((s) => s.inscripcion_id) } },
    data: { estado: 'INSCRITO', actualizado_en: new Date() },
  });
  await tx.historial_auditoria.createMany({
    data: siguientes.map((s) => ({
      tipo_accion: 'ACTUALIZAR' as const,
      entidad_afectada: 'inscripciones_curso',
      entidad_id: s.inscripcion_id,
      observacion_accion: 'Promoción automática desde la lista de espera',
      detalle: { curso_id: cursoId, actor_id: s.actor_id },
    })),
  });
  return siguientes.length;
}

export const lockCurso = (tx: Prisma.TransactionClient, cursoId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cursoId}))`;
