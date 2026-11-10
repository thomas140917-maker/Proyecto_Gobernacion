import { calcularEdad, parseFechaISO } from './fechas';

describe('fechas', () => {
  const hoy = { y: 2026, m: 10, d: 5 };

  it('un día antes de cumplir 18 sigue siendo menor', () => {
    expect(calcularEdad(new Date('2008-10-06T00:00:00Z'), hoy)).toBe(17);
  });
  it('el día que cumple 18 ya es mayor', () => {
    expect(calcularEdad(new Date('2008-10-05T00:00:00Z'), hoy)).toBe(18);
  });
  it('rechaza fechas inexistentes', () => {
    expect(parseFechaISO('2026-02-30')).toBeNull();
    expect(parseFechaISO('2026-13-01')).toBeNull();
    expect(parseFechaISO('2024-02-29')).not.toBeNull();
  });
});

import { fechaLimiteMayoriaEdad } from './fechas';

describe('fechaLimiteMayoriaEdad', () => {
  it('quien nació ese día cumple 18 hoy', () => {
    expect(fechaLimiteMayoriaEdad({ y: 2026, m: 10, d: 5 }).toISOString().slice(0, 10)).toBe('2008-10-05');
  });
  it('29 de febrero: no adelanta la mayoría de edad de quien nació el 1 de marzo', () => {
    const limite = fechaLimiteMayoriaEdad({ y: 2024, m: 2, d: 29 });
    expect(limite.toISOString().slice(0, 10)).toBe('2006-02-28');
    expect(calcularEdad(new Date('2006-03-01T00:00:00Z'), { y: 2024, m: 2, d: 29 })).toBe(17);
  });
});
