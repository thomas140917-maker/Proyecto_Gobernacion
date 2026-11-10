import { puedeCambiarConvocatoria } from './transiciones';

describe('transiciones de convocatoria', () => {
  it('permite el flujo normal', () => {
    expect(puedeCambiarConvocatoria('PROXIMA', 'ACTIVA')).toBe(true);
    expect(puedeCambiarConvocatoria('ACTIVA', 'EN_PAUSA')).toBe(true);
    expect(puedeCambiarConvocatoria('EN_PAUSA', 'ACTIVA')).toBe(true);
    expect(puedeCambiarConvocatoria('EN_PAUSA', 'CERRADA')).toBe(true);
  });
  it('CERRADA es final y no hay retrocesos a PROXIMA', () => {
    for (const a of ['PROXIMA', 'ACTIVA', 'EN_PAUSA', 'CERRADA'] as const) {
      expect(puedeCambiarConvocatoria('CERRADA', a)).toBe(false);
    }
    expect(puedeCambiarConvocatoria('ACTIVA', 'PROXIMA')).toBe(false);
  });
});
