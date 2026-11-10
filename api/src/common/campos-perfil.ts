/** Campos editables del perfil que viajan en cada versión (doble estado). */
export const CAMPOS_PERFIL = [
  'nombre_artistico',
  'tiene_experiencia',
  'biografia',
  'foto_perfil_url',
  'estatura_cm',
  'color_ojos',
  'color_cabello',
  'tono_piel',
  'contextura',
  'genero',
  'edad_aparente_min',
  'edad_aparente_max',
  'dialecto',
  'provincia',
] as const;

export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];
export type DatosPerfil = Record<CampoPerfil, string | number | boolean | null>;

/** Normaliza: undefined y '' pasan a null; descarta cualquier clave que no sea del perfil. */
export function snapshotPerfil(origen: Partial<Record<CampoPerfil, unknown>>): DatosPerfil {
  const salida = {} as DatosPerfil;
  for (const campo of CAMPOS_PERFIL) {
    const v = origen?.[campo];
    salida[campo] = v === undefined || v === '' ? null : (v as string | number | boolean);
  }
  return salida;
}

/** Convierte el snapshot en columnas tipadas de perfiles_actores. */
export function aColumnasPerfil(d: DatosPerfil) {
  return {
    nombre_artistico: d.nombre_artistico as string | null,
    tiene_experiencia: Boolean(d.tiene_experiencia),
    biografia: d.biografia as string | null,
    foto_perfil_url: d.foto_perfil_url as string | null,
    estatura_cm: d.estatura_cm as number | null,
    color_ojos: d.color_ojos as string | null,
    color_cabello: d.color_cabello as string | null,
    tono_piel: d.tono_piel as string | null,
    contextura: d.contextura as string | null,
    genero: d.genero as string | null,
    edad_aparente_min: d.edad_aparente_min as number | null,
    edad_aparente_max: d.edad_aparente_max as number | null,
    dialecto: d.dialecto as string | null,
    provincia: d.provincia as string | null,
  };
}
