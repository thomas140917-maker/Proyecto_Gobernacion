import { estado_curso_enum, estado_inscripcion_enum } from '@prisma/client';

/** BORRADOR (oculto) -> ABIERTO (inscripciones) -> EN_CURSO -> FINALIZADO. Cancelar es posible hasta terminar. */
export const TRANSICIONES_CURSO: Record<estado_curso_enum, estado_curso_enum[]> = {
  BORRADOR: ['ABIERTO', 'CANCELADO'],
  ABIERTO: ['EN_CURSO', 'CANCELADO'],
  EN_CURSO: ['FINALIZADO', 'CANCELADO'],
  FINALIZADO: [],
  CANCELADO: [],
};
export const puedeCambiarCurso = (de: estado_curso_enum, a: estado_curso_enum) =>
  TRANSICIONES_CURSO[de].includes(a);

/** Cambios que puede hacer un admin sobre una inscripción (la lista de espera se promueve sola). */
export const TRANSICIONES_INSCRIPCION: Record<estado_inscripcion_enum, estado_inscripcion_enum[]> = {
  INSCRITO: ['COMPLETADA', 'NO_COMPLETADA', 'CANCELADA'],
  LISTA_ESPERA: ['CANCELADA'],
  COMPLETADA: ['NO_COMPLETADA'],
  NO_COMPLETADA: ['COMPLETADA'],
  CANCELADA: [],
};
export const puedeCambiarInscripcion = (de: estado_inscripcion_enum, a: estado_inscripcion_enum) =>
  TRANSICIONES_INSCRIPCION[de].includes(a);

/** Estados que ocupan un cupo del curso. */
export const ESTADOS_QUE_OCUPAN_CUPO: estado_inscripcion_enum[] = ['INSCRITO', 'COMPLETADA', 'NO_COMPLETADA'];
