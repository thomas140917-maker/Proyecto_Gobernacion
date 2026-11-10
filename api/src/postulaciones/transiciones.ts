import { estado_postulacion_enum } from '@prisma/client';

/** Movimientos permitidos en el Kanban. Se puede reconsiderar un rechazo pasándolo a EN_REVISION. */
export const TRANSICIONES_POSTULACION: Record<estado_postulacion_enum, estado_postulacion_enum[]> = {
  POSTULADO: ['EN_REVISION', 'PRESELECCIONADO', 'RECHAZADO'],
  EN_REVISION: ['POSTULADO', 'PRESELECCIONADO', 'RECHAZADO'],
  PRESELECCIONADO: ['EN_REVISION', 'SELECCIONADO', 'RECHAZADO'],
  SELECCIONADO: ['PRESELECCIONADO', 'RECHAZADO'],
  RECHAZADO: ['EN_REVISION'],
};

export const puedeCambiarPostulacion = (de: estado_postulacion_enum, a: estado_postulacion_enum) =>
  TRANSICIONES_POSTULACION[de].includes(a);
