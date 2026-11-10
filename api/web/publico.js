// Rutas públicas (sin sesión): catálogos, vitrina de actores, cursos, convocatorias y noticias.
const { all, one } = require('./db');
const { fail, wrap, esUuid, auditSafe } = require('./util');
const cat = require('./catalogos');
const P = require('./perfil');
const archivos = require('./archivos');
const { optionalAuth } = require('./seguridad');

/** Imagen de portada guardada como clave de almacenamiento (o URL antigua) -> URL abrible. */
const conImagen = async (f) => { if (f) f.imagen_url = f.imagen_url ? await archivos.urlDe(f.imagen_url) : null; return f; };

const CURSO_COLS = `c.curso_id, c.titulo, c.tipo, c.descripcion, c.instructor, c.modalidad, c.lugar, c.estado, c.categoria, c.requisitos, c.imagen_url,
  c.fecha_inicio_inscripcion, c.fecha_inicio_curso, c.fecha_fin_curso, c.cupo_maximo, c.horas_totales, c.horas_totales AS duracion_horas,
  c.es_proceso_formacion, c.solo_mayores_de_edad,
  (SELECT count(*)::int FROM inscripciones_curso i WHERE i.curso_id=c.curso_id AND i.estado IN ('INSCRITO','COMPLETADA','NO_COMPLETADA')) AS inscritos`;
const conCupos = (c) => { c.cupos_disponibles = Math.max(0, c.cupo_maximo - c.inscritos); return c; };

function registrar(app) {
  app.get('/api/catalogos', wrap(async (_q, res) => res.json({
    generos: cat.GENEROS, tonos_piel: cat.TONOS_PIEL, colores_ojos: cat.COLORES_OJOS, colores_cabello: cat.COLORES_CABELLO,
    dialectos: cat.DIALECTOS, provincias: cat.PROVINCIAS, modalidades: cat.MODALIDADES, tipos_documento: cat.TIPOS_DOCUMENTO,
  })));

  app.get('/api/habilidades', wrap(async (_q, res) =>
    res.json(await all('SELECT habilidad_id, nombre, tipo FROM habilidades ORDER BY tipo, nombre'))));

  // Vitrina con filtros de casting
  app.get('/api/actores', wrap(async (req, res) => {
    const f = req.query, w = [P.VITRINA], v = [];
    const add = (cond, val) => { v.push(val); w.push(cond.replace(/\$\?/g, '$' + v.length)); };
    const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
    if (f.q) add(`(p.nombre_artistico ILIKE $? OR split_part(btrim(a.nombre_completo),' ',1) ILIKE $? OR p.ocupacion ILIKE $?)`, `%${f.q}%`);
    if (f.ciudad) add('(a.ciudad ILIKE $? OR a.municipio ILIKE $?)', `%${f.ciudad}%`);
    if (f.genero) add('p.genero = $?', f.genero);
    if (f.nivel) add('p.nivel_experiencia = $?', f.nivel);
    // La edad que se publica es la aparente: el filtro busca rangos que se solapen con el pedido
    if (num(f.edad_min) !== null) add('p.edad_aparente_max >= $?', num(f.edad_min));
    if (num(f.edad_max) !== null) add('p.edad_aparente_min <= $?', num(f.edad_max));
    if (num(f.est_min) !== null) add('p.estatura_cm >= $?', num(f.est_min));
    if (num(f.est_max) !== null) add('p.estatura_cm <= $?', num(f.est_max));
    for (const k of ['areas', 'esp']) {
      if (list(f[k]).length) add(`EXISTS(SELECT 1 FROM actores_habilidades ah JOIN habilidades h USING(habilidad_id) WHERE ah.actor_id=a.actor_id AND h.nombre = ANY($?))`, list(f[k]));
    }
    if (list(f.rol).length) add(`EXISTS(SELECT 1 FROM experiencias_actor e WHERE e.actor_id=a.actor_id AND e.rol_desempenado ILIKE ANY($?))`, list(f.rol).map((x) => `%${x}%`));
    if (num(f.anios) !== null) add(`EXISTS(SELECT 1 FROM experiencias_actor e WHERE e.actor_id=a.actor_id AND e.anio <= date_part('year', now()) - $?)`, num(f.anios));
    if (list(f.formacion).length) add(`EXISTS(SELECT 1 FROM formacion_actor fo WHERE fo.actor_id=a.actor_id AND (fo.titulo ILIKE ANY($?) OR fo.institucion ILIKE ANY($?)))`, list(f.formacion).map((x) => `%${x}%`));
    if (f.cabello) add('p.color_cabello = $?', f.cabello);
    if (f.ojos) add('p.color_ojos = $?', f.ojos);
    if (f.tono_piel) add('p.tono_piel = $?', f.tono_piel);
    if (f.dialecto || f.acento) add('p.dialecto = $?', f.dialecto || f.acento);
    if (f.provincia) add('p.provincia = $?', f.provincia);
    if (list(f.idiomas).length) add(`EXISTS(SELECT 1 FROM idiomas_actor i WHERE i.actor_id=a.actor_id AND i.idioma ILIKE ANY($?))`, list(f.idiomas));
    if (f.disponible === '1') w.push('p.disponible');
    for (const m of list(f.material)) {
      if (m === 'foto') w.push(`${P.FOTO_KEY} IS NOT NULL`);
      if (m === 'reel') w.push(`EXISTS(SELECT 1 FROM archivos_multimedia mm WHERE mm.actor_id=a.actor_id AND mm.tipo_archivo='REEL_PRESENTACION')`);
      if (m === 'videobook') w.push(`EXISTS(SELECT 1 FROM archivos_multimedia mm WHERE mm.actor_id=a.actor_id AND mm.tipo_archivo='FOTO_BOOK')`);
    }
    const orden = f.orden === 'azar' ? 'random()' : 'nombre';
    const limit = Math.min(Math.max(parseInt(f.limit, 10) || 200, 1), 200);
    res.json(await P.conFotos(await all(`SELECT ${P.COLS_PUBLICAS} ${P.FROM} WHERE ${w.join(' AND ')} ORDER BY ${orden} LIMIT ${limit}`, v)));
  }));

  app.get('/api/actores/:id', optionalAuth, wrap(async (req, res) => {
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Este perfil no está disponible');
    const propio = req.u && (req.u.rol === 'admin' || req.u.id === id);
    if (propio) {
      const a = await P.perfilCompleto(id, 'privada');
      if (!a) throw fail(404, 'Este perfil no está disponible');
      return res.json(a);
    }
    const visible = await one(`SELECT 1 ${P.FROM} WHERE a.actor_id=$1 AND ${P.VITRINA}`, [id]);
    if (!visible) throw fail(404, 'Este perfil no está disponible');
    res.json(await P.perfilCompleto(id, 'publica'));
  }));

  app.post('/api/actores/:id/reportar', wrap(async (req, res) => {
    const id = req.params.id;
    const motivo = String((req.body && req.body.motivo) || '').trim().slice(0, 1000);
    if (motivo.length < 5) throw fail(400, 'Describe brevemente el motivo del reporte');
    if (!esUuid(id) || !(await one(`SELECT 1 ${P.FROM} WHERE a.actor_id=$1 AND ${P.VITRINA}`, [id]))) throw fail(404, 'Este perfil no está disponible');
    const r = await one('INSERT INTO reportes_perfil(actor_id, motivo) VALUES($1,$2) RETURNING reporte_id', [id, motivo]);
    await auditSafe(null, 'CREAR', 'reportes_perfil', r.reporte_id, null, 'Reporte de perfil', { actor_id: id });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------------ cursos
  app.get('/api/cursos', wrap(async (_q, res) => {
    const filas = await all(`SELECT ${CURSO_COLS} FROM cursos_y_talleres c WHERE c.estado IN ('ABIERTO','EN_CURSO') ORDER BY c.fecha_inicio_curso, c.curso_id`);
    res.json(await Promise.all(filas.map((c) => conImagen(conCupos(c)))));
  }));

  app.get('/api/cursos/:id', optionalAuth, wrap(async (req, res) => {
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Curso no encontrado');
    const esAdmin = req.u && req.u.rol === 'admin';
    const c = await one(`SELECT ${CURSO_COLS},
        (SELECT count(*)::int FROM inscripciones_curso i WHERE i.curso_id=c.curso_id AND i.estado='LISTA_ESPERA') AS en_lista_espera
        FROM cursos_y_talleres c WHERE c.curso_id=$1`, [id]);
    if (!c || (c.estado === 'BORRADOR' && !esAdmin) || (!esAdmin && !['ABIERTO', 'EN_CURSO', 'FINALIZADO'].includes(c.estado))) throw fail(404, 'Curso no encontrado');
    conCupos(c);
    if (!esAdmin) delete c.en_lista_espera;
    c.inscrito = false; c.mi_inscripcion = null;
    if (req.u && req.u.rol === 'actor') {
      const i = await one(`SELECT i.estado, i.inscrito_en,
          CASE WHEN i.estado='LISTA_ESPERA' THEN (SELECT count(*)::int FROM inscripciones_curso x WHERE x.curso_id=i.curso_id AND x.estado='LISTA_ESPERA' AND x.inscrito_en <= i.inscrito_en) END AS posicion_lista_espera
          FROM inscripciones_curso i WHERE i.actor_id=$1 AND i.curso_id=$2`, [req.u.id, id]);
      if (i && i.estado !== 'CANCELADA') { c.inscrito = true; c.mi_inscripcion = i; }
    }
    res.json(await conImagen(c));
  }));

  // ------------------------------------------------------------------ convocatorias
  app.get('/api/convocatorias', optionalAuth, wrap(async (req, res) => {
    const filas = await all(`SELECT c.convocatoria_id, c.titulo, c.descripcion, c.requisitos, c.ubicacion, c.modalidad, c.cupo_maximo, c.fecha_apertura, c.fecha_cierre,
        c.estado, c.tipo_oportunidad, c.entidad, c.perfiles_requeridos, c.imagen_url, c.solo_mayores_de_edad,
        c.edad_aparente_min, c.edad_aparente_max, c.estatura_min_cm, c.estatura_max_cm, c.generos, c.provincias, c.municipios
      FROM convocatorias c WHERE c.estado IN ('ACTIVA','PROXIMA') ORDER BY c.fecha_cierre, c.convocatoria_id`);
    if (req.u && req.u.rol === 'actor') {
      const mias = new Map((await all('SELECT convocatoria_id, estado FROM postulaciones_castings WHERE actor_id=$1', [req.u.id])).map((x) => [x.convocatoria_id, x.estado]));
      filas.forEach((r) => { r.postulado = mias.has(r.convocatoria_id); r.mi_estado = mias.get(r.convocatoria_id) || null; });
    }
    res.json(await Promise.all(filas.map(conImagen)));
  }));

  app.get('/api/noticias', wrap(async (_q, res) => res.json(await Promise.all((await all(
    `SELECT noticia_id, titulo, categoria, resumen_para_carta, resumen_para_galeria, enlace, imagen_url, publicado_en
       FROM noticias WHERE NOT borrador AND publicado_en <= now() + interval '1 day' ORDER BY publicado_en DESC`)).map(conImagen)))));
}

module.exports = { registrar, conImagen, CURSO_COLS, conCupos };
