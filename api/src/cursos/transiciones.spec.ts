import { ESTADOS_QUE_OCUPAN_CUPO, puedeCambiarCurso, puedeCambiarInscripcion } from './transiciones';

describe('transiciones de formación', () => {
  it('curso: flujo normal y estados finales', () => {
    expect(puedeCambiarCurso('BORRADOR', 'ABIERTO')).toBe(true);
    expect(puedeCambiarCurso('ABIERTO', 'EN_CURSO')).toBe(true);
    expect(puedeCambiarCurso('EN_CURSO', 'FINALIZADO')).toBe(true);
    expect(puedeCambiarCurso('BORRADOR', 'EN_CURSO')).toBe(false);
    for (const a of ['BORRADOR', 'ABIERTO', 'EN_CURSO', 'FINALIZADO', 'CANCELADO'] as const) {
      expect(puedeCambiarCurso('FINALIZADO', a)).toBe(false);
      expect(puedeCambiarCurso('CANCELADO', a)).toBe(false);
    }
  });
  it('inscripción: la lista de espera solo se cancela (la promoción es automática)', () => {
    expect(puedeCambiarInscripcion('LISTA_ESPERA', 'COMPLETADA')).toBe(false);
    expect(puedeCambiarInscripcion('LISTA_ESPERA', 'INSCRITO')).toBe(false);
    expect(puedeCambiarInscripcion('LISTA_ESPERA', 'CANCELADA')).toBe(true);
  });
  it('inscripción: se puede corregir COMPLETADA <-> NO_COMPLETADA pero no reabrir una cancelada', () => {
    expect(puedeCambiarInscripcion('COMPLETADA', 'NO_COMPLETADA')).toBe(true);
    expect(puedeCambiarInscripcion('NO_COMPLETADA', 'COMPLETADA')).toBe(true);
    expect(puedeCambiarInscripcion('CANCELADA', 'INSCRITO')).toBe(false);
  });
  it('quienes participan o participaron ocupan cupo; espera y cancelados no', () => {
    expect(ESTADOS_QUE_OCUPAN_CUPO).toEqual(['INSCRITO', 'COMPLETADA', 'NO_COMPLETADA']);
  });
});
