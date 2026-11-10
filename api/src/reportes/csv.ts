/**
 * Celda CSV segura: escapa comillas/comas/saltos y neutraliza "inyección de fórmulas"
 * (texto que empieza con = + - @ se ejecutaría como fórmula al abrirlo en Excel).
 */
export function celdaCsv(valor: unknown): string {
  if (typeof valor === 'number') return String(valor);
  let s = valor === null || valor === undefined ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con BOM UTF-8 (Excel respeta tildes y eñes) y saltos CRLF. */
export const aCsv = (filas: unknown[][]) => `\uFEFF${filas.map((f) => f.map(celdaCsv).join(',')).join('\r\n')}\r\n`;
