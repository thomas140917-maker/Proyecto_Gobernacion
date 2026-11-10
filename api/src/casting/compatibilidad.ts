export interface PerfilCasting {
  genero: string | null;
  edad_aparente_min: number | null;
  edad_aparente_max: number | null;
  estatura_cm: number | null;
  tono_piel: string | null;
  color_ojos: string | null;
  color_cabello: string | null;
  dialecto: string | null;
  provincia: string | null;
  municipio: string | null;
  habilidades: Set<string>; // ids
  es_mayor_de_edad: boolean;
}

export interface RequisitosCasting {
  generos: string[];
  edad_aparente_min: number | null;
  edad_aparente_max: number | null;
  estatura_min_cm: number | null;
  estatura_max_cm: number | null;
  tonos_piel: string[];
  colores_ojos: string[];
  colores_cabello: string[];
  dialectos: string[];
  provincias: string[];
  municipios: string[];
  solo_mayores_de_edad: boolean;
  habilidades: { habilidad_id: string; obligatoria: boolean; nombre?: string }[];
}

export interface CriterioEvaluado {
  criterio: string;
  tipo: 'DURO' | 'BLANDO';
  peso: number;
  logro: number; // 0..1
  cumple: boolean;
  mensaje?: string;
}

export interface ResultadoCompatibilidad {
  cumple: boolean; // cumple TODOS los requisitos duros
  incumplimientos: string[]; // duros no cumplidos (bloquean la postulación)
  opcionales_no_cumplidos: string[]; // blandos no cumplidos (solo restan compatibilidad)
  compatibilidad: number; // 0..100
  detalle: CriterioEvaluado[];
}

/** Pesos: duros = obligatorios para postularse; blandos = solo suman a la compatibilidad. */
const PESO = {
  genero: 15, edad_aparente: 20, estatura: 15, habilidades_obligatorias: 25,
  tono_piel: 5, color_ojos: 5, color_cabello: 5, dialecto: 5, ubicacion: 10, habilidades_deseables: 15,
} as const;

const norm = (s?: string | null) => (s ?? '').trim().toUpperCase();
const enLista = (lista: string[], valor?: string | null) => !!valor && lista.map(norm).includes(norm(valor));
const rango = (min: number | null, max: number | null) =>
  min !== null && max !== null ? `${min}-${max}` : min !== null ? `desde ${min}` : `hasta ${max}`;

export function evaluarCompatibilidad(p: PerfilCasting, r: RequisitosCasting): ResultadoCompatibilidad {
  const detalle: CriterioEvaluado[] = [];
  const agregar = (
    criterio: string, tipo: 'DURO' | 'BLANDO', peso: number, logro: number, mensaje: string,
  ) => detalle.push({ criterio, tipo, peso, logro, cumple: logro >= 1, mensaje: logro >= 1 ? undefined : mensaje });

  // ---------------- requisitos DUROS ----------------
  if (r.solo_mayores_de_edad) {
    agregar('solo_mayores_de_edad', 'DURO', 0, p.es_mayor_de_edad ? 1 : 0, 'Esta convocatoria es solo para mayores de 18 años');
  }

  if (r.generos.length) {
    agregar('genero', 'DURO', PESO.genero, enLista(r.generos, p.genero) ? 1 : 0,
      p.genero ? `Tu género no coincide con los solicitados (${r.generos.join(', ')})` : 'Tu perfil no indica género');
  }

  if (r.edad_aparente_min !== null || r.edad_aparente_max !== null) {
    let logro = 0;
    let mensaje = 'Tu perfil no indica edad aparente';
    if (p.edad_aparente_min !== null && p.edad_aparente_max !== null) {
      // hay coincidencia si el rango del actor se cruza con el solicitado
      const okMax = r.edad_aparente_max === null || p.edad_aparente_min <= r.edad_aparente_max;
      const okMin = r.edad_aparente_min === null || p.edad_aparente_max >= r.edad_aparente_min;
      logro = okMax && okMin ? 1 : 0;
      mensaje = `Tu edad aparente (${p.edad_aparente_min}-${p.edad_aparente_max}) no coincide con la solicitada (${rango(r.edad_aparente_min, r.edad_aparente_max)})`;
    }
    agregar('edad_aparente', 'DURO', PESO.edad_aparente, logro, mensaje);
  }

  if (r.estatura_min_cm !== null || r.estatura_max_cm !== null) {
    let logro = 0;
    let mensaje = 'Tu perfil no indica estatura';
    if (p.estatura_cm !== null) {
      logro =
        (r.estatura_min_cm === null || p.estatura_cm >= r.estatura_min_cm) &&
        (r.estatura_max_cm === null || p.estatura_cm <= r.estatura_max_cm) ? 1 : 0;
      mensaje = `Tu estatura (${p.estatura_cm} cm) está fuera del rango solicitado (${rango(r.estatura_min_cm, r.estatura_max_cm)} cm)`;
    }
    agregar('estatura', 'DURO', PESO.estatura, logro, mensaje);
  }

  const obligatorias = r.habilidades.filter((h) => h.obligatoria);
  if (obligatorias.length) {
    const faltan = obligatorias.filter((h) => !p.habilidades.has(h.habilidad_id));
    agregar('habilidades_obligatorias', 'DURO', PESO.habilidades_obligatorias,
      (obligatorias.length - faltan.length) / obligatorias.length,
      `Faltan destrezas obligatorias: ${faltan.map((h) => h.nombre ?? h.habilidad_id).join(', ')}`);
  }

  // ---------------- criterios BLANDOS (preferencias) ----------------
  if (r.tonos_piel.length) {
    agregar('tono_piel', 'BLANDO', PESO.tono_piel, enLista(r.tonos_piel, p.tono_piel) ? 1 : 0,
      `Tono de piel preferido: ${r.tonos_piel.join(', ')}`);
  }
  if (r.colores_ojos.length) {
    agregar('color_ojos', 'BLANDO', PESO.color_ojos, enLista(r.colores_ojos, p.color_ojos) ? 1 : 0,
      `Color de ojos preferido: ${r.colores_ojos.join(', ')}`);
  }
  if (r.colores_cabello.length) {
    agregar('color_cabello', 'BLANDO', PESO.color_cabello, enLista(r.colores_cabello, p.color_cabello) ? 1 : 0,
      `Color de cabello preferido: ${r.colores_cabello.join(', ')}`);
  }
  if (r.dialectos.length) {
    agregar('dialecto', 'BLANDO', PESO.dialecto, enLista(r.dialectos, p.dialecto) ? 1 : 0,
      `Dialecto preferido: ${r.dialectos.join(', ')}`);
  }
  if (r.provincias.length || r.municipios.length) {
    const ok = enLista(r.provincias, p.provincia) || enLista(r.municipios, p.municipio);
    agregar('ubicacion', 'BLANDO', PESO.ubicacion, ok ? 1 : 0,
      `Ubicación preferida: ${[...r.provincias, ...r.municipios].join(', ')}`);
  }
  const deseables = r.habilidades.filter((h) => !h.obligatoria);
  if (deseables.length) {
    const tiene = deseables.filter((h) => p.habilidades.has(h.habilidad_id)).length;
    agregar('habilidades_deseables', 'BLANDO', PESO.habilidades_deseables, tiene / deseables.length,
      `Destrezas deseables: ${deseables.map((h) => h.nombre ?? h.habilidad_id).join(', ')}`);
  }

  // ---------------- resultado ----------------
  const pesoTotal = detalle.reduce((a, d) => a + d.peso, 0);
  const pesoLogrado = detalle.reduce((a, d) => a + d.peso * d.logro, 0);
  return {
    cumple: detalle.filter((d) => d.tipo === 'DURO').every((d) => d.cumple),
    incumplimientos: detalle.filter((d) => d.tipo === 'DURO' && !d.cumple).map((d) => d.mensaje as string),
    opcionales_no_cumplidos: detalle.filter((d) => d.tipo === 'BLANDO' && !d.cumple).map((d) => d.mensaje as string),
    compatibilidad: pesoTotal === 0 ? 100 : Math.round((100 * pesoLogrado) / pesoTotal),
    detalle,
  };
}
