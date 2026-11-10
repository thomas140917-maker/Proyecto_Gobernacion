import { puedeCambiarPostulacion } from './transiciones';

describe('transiciones de postulación', () => {
  it('no se puede saltar directo a SELECCIONADO desde POSTULADO o EN_REVISION', () => {
    expect(puedeCambiarPostulacion('POSTULADO', 'SELECCIONADO')).toBe(false);
    expect(puedeCambiarPostulacion('EN_REVISION', 'SELECCIONADO')).toBe(false);
    expect(puedeCambiarPostulacion('PRESELECCIONADO', 'SELECCIONADO')).toBe(true);
  });
  it('un rechazo solo se reconsidera pasando por EN_REVISION', () => {
    expect(puedeCambiarPostulacion('RECHAZADO', 'EN_REVISION')).toBe(true);
    expect(puedeCambiarPostulacion('RECHAZADO', 'SELECCIONADO')).toBe(false);
  });
});
