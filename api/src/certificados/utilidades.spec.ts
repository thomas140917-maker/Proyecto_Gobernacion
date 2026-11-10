import {
  CODIGO_REGEX, CargaFirma, canonico, enmascararDocumento, firmaEsValida, firmar, formatearCodigo,
  generarCodigo, nombrePublico, normalizarCodigo,
} from './utilidades';

describe('certificados/utilidades', () => {
  it('genera códigos de 16 caracteres base32, distintos entre sí', () => {
    const codigos = new Set(Array.from({ length: 500 }, generarCodigo));
    expect(codigos.size).toBe(500);
    for (const c of codigos) expect(c).toMatch(CODIGO_REGEX);
  });

  it('normaliza lo que el usuario escribe (minúsculas, guiones, espacios)', () => {
    expect(normalizarCodigo(' abcd-efgh ijkl-mnop ')).toBe('ABCDEFGHIJKLMNOP');
    expect(formatearCodigo('ABCDEFGHIJKLMNOP')).toBe('ABCD-EFGH-IJKL-MNOP');
  });

  it('enmascara el documento y abrevia el nombre de los menores', () => {
    expect(enmascararDocumento('1052000111')).toBe('*******111');
    expect(enmascararDocumento('12')).toBe('12');
    expect(nombrePublico('Ana María Pérez Gómez', true)).toBe('Ana M. P. G.');
    expect(nombrePublico('Ana María Pérez Gómez', false)).toBe('Ana María Pérez Gómez');
  });

  it('el JSON canónico no depende del orden de las claves', () => {
    expect(canonico({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(canonico({ a: { c: null, d: [2, { y: 2, z: 1 }] }, b: 1 }));
  });

  describe('firma de integridad', () => {
    const base = (): CargaFirma => ({
      codigo: 'ABCDEFGHIJKLMNOP', tipo: 'REGISTRO', actor_id: 'a1', curso_id: null,
      emitido_en: new Date('2026-10-05T12:00:00.000Z'), vence_en: new Date('2027-01-03T12:00:00.000Z'),
      datos: { titular: 'Ana', documento: '123' },
    });
    const secreto = 'x'.repeat(40);

    it('valida la firma original aunque jsonb reordene los datos', () => {
      const firma = firmar(base(), secreto);
      expect(firmaEsValida({ ...base(), datos: { documento: '123', titular: 'Ana' } }, firma, secreto)).toBe(true);
    });
    it('detecta cualquier alteración o un secreto distinto', () => {
      const firma = firmar(base(), secreto);
      expect(firmaEsValida({ ...base(), vence_en: new Date('2030-01-01T00:00:00.000Z') }, firma, secreto)).toBe(false);
      expect(firmaEsValida({ ...base(), datos: { titular: 'Otra', documento: '123' } }, firma, secreto)).toBe(false);
      expect(firmaEsValida(base(), firma, 'y'.repeat(40))).toBe(false);
      expect(firmaEsValida(base(), 'corta', secreto)).toBe(false);
    });
  });
});
