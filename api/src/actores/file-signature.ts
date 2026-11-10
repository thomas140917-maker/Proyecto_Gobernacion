/**
 * El mimetype lo declara el cliente y se puede falsificar. Aquí se comprueban los
 * primeros bytes del archivo ("magic bytes") contra el tipo declarado.
 */
const FIRMAS: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString('ascii') === '%PDF-',
};

export function firmaValidaBuffer(mime: string, b: Buffer): boolean {
  const verificar = FIRMAS[mime];
  return !!verificar && b.length >= 12 && verificar(b);
}
