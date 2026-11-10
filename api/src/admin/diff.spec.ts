import { compararPerfil } from './diff';

describe('compararPerfil', () => {
  const base = { nombre_artistico: 'Ana', biografia: 'Hola', estatura_cm: 165, tiene_experiencia: false };

  it('sin versión pública, todo lo que tenga valor cuenta como cambio', () => {
    const r = compararPerfil(null, base);
    const cambiados = r.campos.filter((c) => c.cambiado).map((c) => c.campo);
    expect(cambiados).toEqual(['nombre_artistico', 'tiene_experiencia', 'biografia', 'estatura_cm']);
  });

  it('marca solo los campos modificados', () => {
    const r = compararPerfil(base, { ...base, biografia: 'Nueva bio', estatura_cm: 165 });
    expect(r.total_cambios).toBe(1);
    expect(r.campos.find((c) => c.campo === 'biografia')).toMatchObject({
      publicado: 'Hola', borrador: 'Nueva bio', cambiado: true,
    });
  });

  it('trata undefined, null y cadena vacía como lo mismo', () => {
    expect(compararPerfil({ biografia: null }, { biografia: '' }).total_cambios).toBe(0);
    expect(compararPerfil({}, { color_ojos: undefined }).total_cambios).toBe(0);
  });
});
