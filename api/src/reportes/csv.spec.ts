import { aCsv, celdaCsv } from './csv';

describe('csv', () => {
  it('escapa comas, comillas y saltos de línea', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(celdaCsv('l1\nl2')).toBe('"l1\nl2"');
  });
  it('neutraliza inyección de fórmulas pero no toca los números', () => {
    for (const peligroso of ['=1+1', '+cmd|calc', '-2+3', '@SUM(A1)', '\t=x']) {
      expect(celdaCsv(peligroso).startsWith("'") || celdaCsv(peligroso).startsWith('"\'')).toBe(true);
    }
    expect(celdaCsv(-5)).toBe('-5');
    expect(celdaCsv(12.5)).toBe('12.5');
    expect(celdaCsv(null)).toBe('');
  });
  it('agrega BOM y usa CRLF', () => {
    const csv = aCsv([['a', 'b'], [1, 'ñandú']]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFFa,b\r\n1,ñandú\r\n');
  });
});
