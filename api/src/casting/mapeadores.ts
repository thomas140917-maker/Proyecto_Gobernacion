import { calcularEdad } from '../common/fechas';
import { PerfilCasting, RequisitosCasting } from './compatibilidad';

interface ActorParaCasting {
  fecha_nacimiento: Date;
  municipio: string;
  perfil: {
    genero: string | null; edad_aparente_min: number | null; edad_aparente_max: number | null;
    estatura_cm: number | null; tono_piel: string | null; color_ojos: string | null;
    color_cabello: string | null; dialecto: string | null; provincia: string | null;
  } | null;
  habilidades: { habilidad_id: string }[];
}

export function perfilCastingDesdeActor(a: ActorParaCasting): PerfilCasting {
  const p = a.perfil;
  return {
    genero: p?.genero ?? null,
    edad_aparente_min: p?.edad_aparente_min ?? null,
    edad_aparente_max: p?.edad_aparente_max ?? null,
    estatura_cm: p?.estatura_cm ?? null,
    tono_piel: p?.tono_piel ?? null,
    color_ojos: p?.color_ojos ?? null,
    color_cabello: p?.color_cabello ?? null,
    dialecto: p?.dialecto ?? null,
    provincia: p?.provincia ?? null,
    municipio: a.municipio,
    habilidades: new Set(a.habilidades.map((h) => h.habilidad_id)),
    es_mayor_de_edad: calcularEdad(a.fecha_nacimiento) >= 18,
  };
}

interface ConvocatoriaParaCasting {
  generos: string[]; edad_aparente_min: number | null; edad_aparente_max: number | null;
  estatura_min_cm: number | null; estatura_max_cm: number | null;
  tonos_piel: string[]; colores_ojos: string[]; colores_cabello: string[];
  dialectos: string[]; provincias: string[]; municipios: string[];
  solo_mayores_de_edad: boolean;
  habilidades: { habilidad_id: string; obligatoria: boolean; habilidad?: { nombre: string } | null }[];
}

export function requisitosDesdeConvocatoria(c: ConvocatoriaParaCasting): RequisitosCasting {
  return {
    generos: c.generos, edad_aparente_min: c.edad_aparente_min, edad_aparente_max: c.edad_aparente_max,
    estatura_min_cm: c.estatura_min_cm, estatura_max_cm: c.estatura_max_cm,
    tonos_piel: c.tonos_piel, colores_ojos: c.colores_ojos, colores_cabello: c.colores_cabello,
    dialectos: c.dialectos, provincias: c.provincias, municipios: c.municipios,
    solo_mayores_de_edad: c.solo_mayores_de_edad,
    habilidades: c.habilidades.map((h) => ({
      habilidad_id: h.habilidad_id, obligatoria: h.obligatoria, nombre: h.habilidad?.nombre,
    })),
  };
}
