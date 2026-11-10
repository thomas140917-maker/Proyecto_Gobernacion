export type Fecha = { y: number; m: number; d: number };

/** Fecha de hoy en Colombia (evita errores de edad cerca de la medianoche UTC). */
export function hoyBogota(): Fecha {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .split('-')
    .map(Number);
  return { y, m, d };
}

/** Devuelve la fecha (UTC 00:00) o null si el texto no es una fecha real YYYY-MM-DD. */
export function parseFechaISO(valor: string): Date | null {
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) return null;
  return fecha;
}

export function calcularEdad(nacimiento: Date, hoy: Fecha = hoyBogota()): number {
  let edad = hoy.y - nacimiento.getUTCFullYear();
  const mes = nacimiento.getUTCMonth() + 1;
  const dia = nacimiento.getUTCDate();
  if (hoy.m < mes || (hoy.m === mes && hoy.d < dia)) edad--;
  return edad;
}

/**
 * Fecha de nacimiento máxima para ser mayor de 18 años HOY (hora de Colombia).
 * Un actor es adulto si fecha_nacimiento <= este valor. Maneja el 29 de febrero.
 */
export function fechaLimiteMayoriaEdad(hoy: Fecha = hoyBogota()): Date {
  const anio = hoy.y - 18;
  const ultimoDiaMes = new Date(Date.UTC(anio, hoy.m, 0)).getUTCDate();
  return new Date(Date.UTC(anio, hoy.m - 1, Math.min(hoy.d, ultimoDiaMes)));
}
