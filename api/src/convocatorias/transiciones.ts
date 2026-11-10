import { estado_convocatoria_enum } from '@prisma/client';

/** PROXIMA -> ACTIVA <-> EN_PAUSA; cualquiera puede cerrarse; CERRADA es final. */
export const TRANSICIONES_CONVOCATORIA: Record<estado_convocatoria_enum, estado_convocatoria_enum[]> = {
  PROXIMA: ['ACTIVA', 'CERRADA'],
  ACTIVA: ['EN_PAUSA', 'CERRADA'],
  EN_PAUSA: ['ACTIVA', 'CERRADA'],
  CERRADA: [],
};

export const puedeCambiarConvocatoria = (de: estado_convocatoria_enum, a: estado_convocatoria_enum) =>
  TRANSICIONES_CONVOCATORIA[de].includes(a);
