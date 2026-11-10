// Arma los datos de entrada de evaluarCompatibilidad (equivale a casting/mapeadores.ts).
const { one, all } = require('./db');
const { evaluarCompatibilidad } = require('./compat');
const P = require('./perfil');

/** Evalúa a un actor frente a una convocatoria. Devuelve null si alguno no existe. */
async function evaluar(db, actorId, convocatoriaId) {
  const q = (db && db.query) ? (sql, p) => db.query(sql, p).then((r) => r.rows) : all;
  const [a] = await q(
    `SELECT a.municipio, (${P.ES_ADULTO}) AS es_mayor, p.genero, p.edad_aparente_min, p.edad_aparente_max, p.estatura_cm,
            p.tono_piel, p.color_ojos, p.color_cabello, p.dialecto, p.provincia
       FROM actores a LEFT JOIN perfiles_actores p USING(actor_id) WHERE a.actor_id=$1`, [actorId]);
  const [c] = await q('SELECT * FROM convocatorias WHERE convocatoria_id=$1', [convocatoriaId]);
  if (!a || !c) return null;
  const hab = await q('SELECT habilidad_id FROM actores_habilidades WHERE actor_id=$1', [actorId]);
  const req = await q(
    `SELECT ch.habilidad_id, ch.obligatoria, h.nombre FROM convocatorias_habilidades ch JOIN habilidades h USING(habilidad_id) WHERE ch.convocatoria_id=$1`, [convocatoriaId]);
  const n = (v) => (v === null || v === undefined ? null : v);
  return evaluarCompatibilidad(
    {
      genero: n(a.genero), edad_aparente_min: n(a.edad_aparente_min), edad_aparente_max: n(a.edad_aparente_max), estatura_cm: n(a.estatura_cm),
      tono_piel: n(a.tono_piel), color_ojos: n(a.color_ojos), color_cabello: n(a.color_cabello), dialecto: n(a.dialecto), provincia: n(a.provincia),
      municipio: a.municipio, habilidades: new Set(hab.map((h) => h.habilidad_id)), es_mayor_de_edad: !!a.es_mayor,
    },
    {
      generos: c.generos || [], edad_aparente_min: n(c.edad_aparente_min), edad_aparente_max: n(c.edad_aparente_max),
      estatura_min_cm: n(c.estatura_min_cm), estatura_max_cm: n(c.estatura_max_cm),
      tonos_piel: c.tonos_piel || [], colores_ojos: c.colores_ojos || [], colores_cabello: c.colores_cabello || [],
      dialectos: c.dialectos || [], provincias: c.provincias || [], municipios: c.municipios || [],
      solo_mayores_de_edad: !!c.solo_mayores_de_edad,
      habilidades: req.map((h) => ({ habilidad_id: h.habilidad_id, obligatoria: h.obligatoria, nombre: h.nombre })),
    },
  );
}

module.exports = { evaluar };
