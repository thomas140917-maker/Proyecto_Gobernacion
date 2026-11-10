import { PerfilCasting, RequisitosCasting, evaluarCompatibilidad } from './compatibilidad';

const perfil = (o: Partial<PerfilCasting> = {}): PerfilCasting => ({
  genero: 'FEMENINO', edad_aparente_min: 22, edad_aparente_max: 30, estatura_cm: 165,
  tono_piel: 'TRIGUENA', color_ojos: 'CAFES', color_cabello: 'NEGRO', dialecto: 'BOYACENSE',
  provincia: 'CENTRO', municipio: 'Tunja', habilidades: new Set(['canto', 'baile']), es_mayor_de_edad: true, ...o,
});
const req = (o: Partial<RequisitosCasting> = {}): RequisitosCasting => ({
  generos: [], edad_aparente_min: null, edad_aparente_max: null, estatura_min_cm: null, estatura_max_cm: null,
  tonos_piel: [], colores_ojos: [], colores_cabello: [], dialectos: [], provincias: [], municipios: [],
  solo_mayores_de_edad: false, habilidades: [], ...o,
});

describe('evaluarCompatibilidad', () => {
  it('sin requisitos: cumple y compatibilidad 100', () => {
    expect(evaluarCompatibilidad(perfil(), req())).toMatchObject({ cumple: true, compatibilidad: 100 });
  });

  it('un requisito duro incumplido bloquea y explica por qué', () => {
    const r = evaluarCompatibilidad(perfil(), req({ generos: ['MASCULINO'] }));
    expect(r.cumple).toBe(false);
    expect(r.incumplimientos[0]).toContain('género');
  });

  it('edad aparente: acepta rangos que se cruzan y rechaza los que no', () => {
    expect(evaluarCompatibilidad(perfil(), req({ edad_aparente_min: 28, edad_aparente_max: 40 })).cumple).toBe(true);
    expect(evaluarCompatibilidad(perfil(), req({ edad_aparente_min: 31, edad_aparente_max: 40 })).cumple).toBe(false);
    expect(evaluarCompatibilidad(perfil({ edad_aparente_min: null, edad_aparente_max: null }), req({ edad_aparente_min: 20 })).cumple).toBe(false);
  });

  it('estatura: límites inclusivos y perfil sin estatura no cumple', () => {
    expect(evaluarCompatibilidad(perfil(), req({ estatura_min_cm: 165, estatura_max_cm: 165 })).cumple).toBe(true);
    expect(evaluarCompatibilidad(perfil(), req({ estatura_min_cm: 170 })).cumple).toBe(false);
    expect(evaluarCompatibilidad(perfil({ estatura_cm: null }), req({ estatura_max_cm: 180 })).cumple).toBe(false);
  });

  it('destrezas obligatorias bloquean; las deseables solo restan puntaje', () => {
    const faltaOblig = evaluarCompatibilidad(perfil(), req({ habilidades: [{ habilidad_id: 'canto', obligatoria: true }, { habilidad_id: 'esgrima', obligatoria: true, nombre: 'Esgrima' }] }));
    expect(faltaOblig.cumple).toBe(false);
    expect(faltaOblig.incumplimientos[0]).toContain('Esgrima');

    const faltaDeseable = evaluarCompatibilidad(perfil(), req({ habilidades: [{ habilidad_id: 'esgrima', obligatoria: false }] }));
    expect(faltaDeseable.cumple).toBe(true);
    expect(faltaDeseable.compatibilidad).toBe(0);
  });

  it('criterios blandos no bloquean pero bajan la compatibilidad (comparación sin mayúsculas/espacios)', () => {
    const r = evaluarCompatibilidad(perfil(), req({ tonos_piel: [' trigueña'.replace('ñ', 'n')], colores_ojos: ['VERDES'] }));
    expect(r.cumple).toBe(true);
    expect(r.compatibilidad).toBe(50); // tono (5) cumple, ojos (5) no
    expect(r.opcionales_no_cumplidos).toHaveLength(1);
  });

  it('ubicación: cumple por provincia o por municipio', () => {
    expect(evaluarCompatibilidad(perfil(), req({ provincias: ['NORTE'], municipios: ['tunja'] })).compatibilidad).toBe(100);
    expect(evaluarCompatibilidad(perfil(), req({ provincias: ['NORTE'] })).compatibilidad).toBe(0);
  });

  it('solo mayores de edad bloquea a menores sin afectar el puntaje', () => {
    const r = evaluarCompatibilidad(perfil({ es_mayor_de_edad: false }), req({ solo_mayores_de_edad: true }));
    expect(r.cumple).toBe(false);
    expect(r.compatibilidad).toBe(100); // peso 0: no entra al promedio
  });
});
