import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32: sin 0/1/8/9 que se confunden con O/I/B/g

/** Código aleatorio de 80 bits (16 caracteres): no se puede adivinar ni enumerar. */
export function generarCodigo(): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of randomBytes(10)) {
    valor = ((valor << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return salida;
}

export const CODIGO_REGEX = /^[A-Z2-7]{16}$/;
export const normalizarCodigo = (entrada: string) => String(entrada ?? '').toUpperCase().replace(/[\s-]/g, '');
export const formatearCodigo = (c: string) => (c.match(/.{1,4}/g) ?? [c]).join('-');

/** "1052000111" -> "*******111": en la verificación pública solo se ven los últimos 3 dígitos. */
export function enmascararDocumento(doc: string): string {
  return '*'.repeat(Math.max(0, doc.length - 3)) + doc.slice(-3);
}

/** Menores de edad: en la verificación pública solo nombre e iniciales ("Ana P. G."). */
export function nombrePublico(nombreCompleto: string, esMenor: boolean): string {
  if (!esMenor) return nombreCompleto;
  const [primero, ...resto] = nombreCompleto.trim().split(/\s+/);
  return [primero, ...resto.map((p) => `${p[0].toUpperCase()}.`)].join(' ');
}

// ---------------------------------------------------------------- firma de integridad (HMAC)
export interface CargaFirma {
  codigo: string;
  tipo: string;
  actor_id: string;
  curso_id: string | null;
  emitido_en: Date;
  vence_en: Date | null;
  datos: unknown;
}

/** JSON con claves ordenadas: jsonb de Postgres no conserva el orden, la firma sí debe ser estable. */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`).join(',')}}`;
}

const textoFirmado = (c: CargaFirma) =>
  canonico([c.codigo, c.tipo, c.actor_id, c.curso_id, c.emitido_en.toISOString(), c.vence_en?.toISOString() ?? null, c.datos]);

export const firmar = (c: CargaFirma, secreto: string) =>
  createHmac('sha256', secreto).update(textoFirmado(c)).digest('base64url');

export function firmaEsValida(c: CargaFirma, firma: string, secreto: string): boolean {
  const esperada = Buffer.from(firmar(c, secreto));
  const dada = Buffer.from(firma);
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}
