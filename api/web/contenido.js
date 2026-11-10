// Gestión de contenido (administrador): cursos, convocatorias, noticias, inscritos y postulantes.
// Reglas espejo de api/src: CursosService, InscripcionesService, ConvocatoriasService, PostulacionesService.
const multer = require('multer');
const { all, one, tx, lock } = require('./db');
const { fail, wrap, nn, bool, entero, json, esUuid, limpiar, sanitize, audit } = require('./util');
const cat = require('./catalogos');
const P = require('./perfil');
const archivos = require('./archivos');
const seg = require('./seguridad');
const { CURSO_COLS, conCupos } = require('./publico');

const A = seg.auth('admin');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 80, fieldSize: 256 * 1024 } });
const OCUPAN = "('INSCRITO','COMPLETADA','NO_COMPLETADA')";
const quien = (req) => ({ rol: 'admin', id: req.u.id });

/** Fechas del formulario: sin zona = hora de Colombia (UTC-5). Solo fecha: inicio del día o (fin) 23:59:59. */
function fecha(v, nombre, { fin = false, requerida = false } = {}) {
  const t = limpiar(nn(v));
  if (t === null) { if (requerida) throw fail(400, `${nombre} es obligatoria`); return null; }
  let s = String(t);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += fin ? 'T23:59:59-05:00' : 'T00:00:00-05:00';
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + (s.length <= 16 ? ':00' : '') + '-05:00';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw fail(400, `${nombre} no es una fecha válida`);
  return d;
}
const txt = (v, max, nombre, min = 0) => {
  const t = limpiar(nn(v));
  if (t === null) return null;
  if (String(t).length > max) throw fail(400, `${nombre} no puede superar ${max} caracteres`);
  if (String(t).length < min) throw fail(400, `${nombre} debe tener al menos ${min} caracteres`);
  return String(t);
};
const lista = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim().startsWith('[') ? json(v) : String(v || '').split(',').map((x) => x.trim()).filter(Boolean));
const listaCat = (v, catalogo, nombre, max) => {
  const l = lista(v);
  if (l.length > max) throw fail(400, `${nombre}: máximo ${max} opciones`);
  const ok = cat.codigos(catalogo);
  if (l.some((x) => !ok.includes(x))) throw fail(400, `${nombre} contiene una opción no válida`);
  return [...new Set(l)];
};
const imagen = async (carpeta, file) => (file ? archivos.guardarPortada(carpeta, file) : undefined);

// ------------------------------------------------------------------ cursos
const TRANS_CURSO = { BORRADOR: ['ABIERTO', 'CANCELADO'], ABIERTO: ['EN_CURSO', 'CANCELADO'], EN_CURSO: ['FINALIZADO', 'CANCELADO'], FINALIZADO: [], CANCELADO: [] };

function validarCurso(b) {
  const titulo = txt(b.titulo, 200, 'El título', 3);
  if (!titulo) throw fail(400, 'El título es obligatorio');
  const descripcion = txt(b.descripcion, 5000, 'La descripción', 10);
  if (!descripcion) throw fail(400, 'Escribe una descripción de al menos 10 caracteres');
  const tipo = String(b.tipo || 'CURSO').toUpperCase();
  if (!['CURSO', 'TALLER'].includes(tipo)) throw fail(400, 'El tipo debe ser CURSO o TALLER');
  const modalidad = String(b.modalidad || 'PRESENCIAL').toUpperCase();
  if (!cat.codigos(cat.MODALIDADES).includes(modalidad)) throw fail(400, 'La modalidad no es válida');
  const inicio = fecha(b.fecha_inicio_curso, 'La fecha de inicio', { requerida: true });
  const fin = fecha(b.fecha_fin_curso, 'La fecha de finalización', { fin: true, requerida: true });
  const insc = fecha(b.fecha_inicio_inscripcion, 'La fecha de inicio de inscripciones') || new Date(Math.min(Date.now(), inicio.getTime()));
  if (insc > inicio) throw fail(400, 'Las inscripciones deben abrir antes de que empiece el curso');
  if (inicio >= fin) throw fail(400, 'La fecha de finalización debe ser posterior a la de inicio');
  if (fin <= new Date()) throw fail(400, 'La fecha de finalización debe ser futura');
  const cupo = entero(b.cupo_maximo);
  if (cupo === null || cupo < 1 || cupo > 1000) throw fail(400, 'El cupo debe estar entre 1 y 1000');
  const horas = entero(b.horas_totales ?? b.duracion_horas);
  if (horas !== null && (horas < 1 || horas > 2000)) throw fail(400, 'Las horas totales deben estar entre 1 y 2000');
  return {
    titulo, tipo, descripcion, instructor: txt(b.instructor, 100, 'El instructor'), modalidad, lugar: txt(b.lugar, 200, 'El lugar'),
    fecha_inicio_inscripcion: insc, fecha_inicio_curso: inicio, fecha_fin_curso: fin, cupo_maximo: cupo, horas_totales: horas,
    es_proceso_formacion: bool(b.es_proceso_formacion), solo_mayores_de_edad: bool(b.solo_mayores_de_edad),
    categoria: txt(b.categoria, 60, 'La categoría'), requisitos: txt(b.requisitos, 4000, 'Los requisitos'),
  };
}
const COLS_CURSO = ['titulo', 'tipo', 'descripcion', 'instructor', 'modalidad', 'lugar', 'fecha_inicio_inscripcion', 'fecha_inicio_curso', 'fecha_fin_curso',
  'cupo_maximo', 'horas_totales', 'es_proceso_formacion', 'solo_mayores_de_edad', 'categoria', 'requisitos'];

async function promover(c, cursoId, cupo) {
  const ocupados = (await c.query(`SELECT count(*)::int n FROM inscripciones_curso WHERE curso_id=$1 AND estado IN ${OCUPAN}`, [cursoId])).rows[0].n;
  const libres = cupo - ocupados;
  if (libres <= 0) return 0;
  const sig = (await c.query(`SELECT inscripcion_id, actor_id FROM inscripciones_curso WHERE curso_id=$1 AND estado='LISTA_ESPERA' ORDER BY inscrito_en ASC LIMIT $2`, [cursoId, libres])).rows;
  for (const s of sig) {
    await c.query(`UPDATE inscripciones_curso SET estado='INSCRITO', actualizado_en=now() WHERE inscripcion_id=$1`, [s.inscripcion_id]);
    await audit(c, 'ACTUALIZAR', 'inscripciones_curso', s.inscripcion_id, null, 'Promoción automática desde la lista de espera', { curso_id: cursoId, actor_id: s.actor_id });
  }
  return sig.length;
}

async function estadoCurso(c, id, estado, motivo, req) {
  const act = (await c.query('SELECT * FROM cursos_y_talleres WHERE curso_id=$1', [id])).rows[0];
  if (!act) throw fail(404, 'Curso no encontrado');
  if (!(TRANS_CURSO[act.estado] || []).includes(estado)) throw fail(409, `No se puede pasar de ${act.estado} a ${estado}`);
  if (estado === 'ABIERTO' && (!act.fecha_fin_curso || new Date(act.fecha_inicio_curso) <= new Date())) throw fail(409, 'Para abrir inscripciones, la fecha de inicio del curso debe ser futura');
  const r = await c.query('UPDATE cursos_y_talleres SET estado=$2::estado_curso_enum, actualizado_en=now() WHERE curso_id=$1 AND estado=$3::estado_curso_enum', [id, estado, act.estado]);
  if (r.rowCount !== 1) throw fail(409, 'El estado cambió mientras lo editabas; recarga');
  let canceladas = 0;
  if (estado === 'CANCELADO') {
    canceladas = (await c.query(
      `UPDATE inscripciones_curso SET estado='CANCELADA', actualizado_en=now(), revisado_por_admin_id=$2, notas_admin='Curso cancelado' WHERE curso_id=$1 AND estado IN ('INSCRITO','LISTA_ESPERA')`, [id, req.u.id])).rowCount;
  }
  await audit(c, 'ACCION_ADMINISTRADOR', 'cursos_y_talleres', id, quien(req), 'CAMBIAR_ESTADO_CURSO',
    { accion: 'CAMBIAR_ESTADO', de: act.estado, a: estado, motivo: nn(motivo), inscripciones_canceladas: canceladas });
  return { estado_anterior: act.estado, estado, inscripciones_canceladas: canceladas };
}

// ------------------------------------------------------------------ convocatorias
const TRANS_CONV = { PROXIMA: ['ACTIVA', 'CERRADA'], ACTIVA: ['EN_PAUSA', 'CERRADA'], EN_PAUSA: ['ACTIVA', 'CERRADA'], CERRADA: [] };
const COLS_CONV = ['titulo', 'descripcion', 'requisitos', 'ubicacion', 'modalidad', 'cupo_maximo', 'fecha_apertura', 'fecha_cierre', 'edad_aparente_min', 'edad_aparente_max',
  'estatura_min_cm', 'estatura_max_cm', 'generos', 'tonos_piel', 'colores_ojos', 'colores_cabello', 'dialectos', 'provincias', 'municipios', 'solo_mayores_de_edad',
  'tipo_oportunidad', 'entidad', 'perfiles_requeridos'];

async function validarConv(b) {
  const titulo = txt(b.titulo, 200, 'El título', 3);
  if (!titulo) throw fail(400, 'El título es obligatorio');
  const descripcion = txt(b.descripcion, 5000, 'La descripción', 10);
  if (!descripcion) throw fail(400, 'Escribe una descripción de al menos 10 caracteres');
  const modalidad = String(b.modalidad || 'PRESENCIAL').toUpperCase();
  if (!cat.codigos(cat.MODALIDADES).includes(modalidad)) throw fail(400, 'La modalidad no es válida');
  const cierre = fecha(b.fecha_cierre, 'La fecha de cierre', { fin: true, requerida: true });
  const apertura = fecha(b.fecha_apertura, 'La fecha de apertura');
  if (cierre <= new Date()) throw fail(400, 'La fecha de cierre debe ser futura');
  if (apertura && apertura >= cierre) throw fail(400, 'La fecha de apertura debe ser anterior a la de cierre');
  const cupo = entero(b.cupo_maximo);
  if (cupo === null || cupo < 1 || cupo > 1000) throw fail(400, 'Las vacantes deben estar entre 1 y 1000');
  const num = (k, mn, mx, nombre) => { const x = entero(b[k]); if (x !== null && (x < mn || x > mx)) throw fail(400, `${nombre} debe estar entre ${mn} y ${mx}`); return x; };
  const emin = num('edad_aparente_min', 0, 100, 'La edad mínima'), emax = num('edad_aparente_max', 0, 100, 'La edad máxima');
  const smin = num('estatura_min_cm', 50, 250, 'La estatura mínima'), smax = num('estatura_max_cm', 50, 250, 'La estatura máxima');
  if (emin !== null && emax !== null && emin > emax) throw fail(400, 'La edad mínima no puede ser mayor que la máxima');
  if (smin !== null && smax !== null && smin > smax) throw fail(400, 'La estatura mínima no puede ser mayor que la máxima');
  const habilidades = [];
  for (const h of json(b.habilidades)) {
    let id = h.habilidad_id;
    if (!esUuid(id) && h.nombre) id = (await one('SELECT habilidad_id FROM habilidades WHERE nombre=$1', [String(h.nombre)]) || {}).habilidad_id;
    if (!esUuid(id)) throw fail(400, 'Alguna destreza indicada no existe');
    habilidades.push({ habilidad_id: id, obligatoria: h.obligatoria !== false });
  }
  if (habilidades.length > 15 || new Set(habilidades.map((h) => h.habilidad_id)).size !== habilidades.length) throw fail(400, 'Hay destrezas repetidas o demasiadas (máximo 15)');
  return {
    apertura,
    habilidades,
    cols: {
      titulo, descripcion, requisitos: txt(b.requisitos, 4000, 'Los requisitos'), ubicacion: txt(b.ubicacion, 100, 'La ubicación'), modalidad, cupo_maximo: cupo,
      fecha_apertura: apertura, fecha_cierre: cierre, edad_aparente_min: emin, edad_aparente_max: emax, estatura_min_cm: smin, estatura_max_cm: smax,
      generos: listaCat(b.generos, cat.GENEROS, 'Géneros', 4), tonos_piel: listaCat(b.tonos_piel, cat.TONOS_PIEL, 'Tonos de piel', 5),
      colores_ojos: listaCat(b.colores_ojos, cat.COLORES_OJOS, 'Colores de ojos', 6), colores_cabello: listaCat(b.colores_cabello, cat.COLORES_CABELLO, 'Colores de cabello', 6),
      dialectos: listaCat(b.dialectos, cat.DIALECTOS, 'Dialectos', 10), provincias: listaCat(b.provincias, cat.PROVINCIAS, 'Provincias', 14),
      municipios: lista(b.municipios).map((m) => String(m).slice(0, 100)).slice(0, 30), solo_mayores_de_edad: bool(b.solo_mayores_de_edad),
      tipo_oportunidad: txt(b.tipo_oportunidad, 40, 'El tipo de oportunidad'), entidad: txt(b.entidad, 120, 'La entidad'), perfiles_requeridos: txt(b.perfiles_requeridos, 4000, 'Los perfiles requeridos'),
    },
  };
}
async function guardarHabConv(c, id, habilidades) {
  await c.query('DELETE FROM convocatorias_habilidades WHERE convocatoria_id=$1', [id]);
  for (const h of habilidades) await c.query('INSERT INTO convocatorias_habilidades(convocatoria_id,habilidad_id,obligatoria) VALUES($1,$2,$3)', [id, h.habilidad_id, h.obligatoria]);
}
async function estadoConv(c, id, estado, motivo, req) {
  const act = (await c.query('SELECT * FROM convocatorias WHERE convocatoria_id=$1', [id])).rows[0];
  if (!act) throw fail(404, 'Convocatoria no encontrada');
  if (!(TRANS_CONV[act.estado] || []).includes(estado)) throw fail(409, `No se puede pasar de ${act.estado} a ${estado}`);
  if (estado === 'ACTIVA' && new Date(act.fecha_cierre) <= new Date()) throw fail(409, 'La fecha de cierre ya pasó: edita la convocatoria con una fecha futura antes de activarla');
  const r = await c.query('UPDATE convocatorias SET estado=$2::estado_convocatoria_enum, actualizado_en=now() WHERE convocatoria_id=$1 AND estado=$3::estado_convocatoria_enum', [id, estado, act.estado]);
  if (r.rowCount !== 1) throw fail(409, 'El estado cambió mientras lo editabas; recarga la convocatoria');
  await audit(c, 'ACCION_ADMINISTRADOR', 'convocatorias', id, quien(req), 'CAMBIAR_ESTADO_CONVOCATORIA', { accion: 'CAMBIAR_ESTADO', de: act.estado, a: estado, motivo: nn(motivo) });
  return { estado_anterior: act.estado, estado };
}

// ------------------------------------------------------------------ noticias
function validarNoticia(b, nuevo) {
  const titulo = txt(b.titulo, 200, 'El título', 3);
  if (!titulo) throw fail(400, 'El título es obligatorio');
  const galeria = sanitize(b.resumen_para_galeria || '').trim();
  return {
    titulo, categoria: txt(b.categoria, 40, 'La categoría'), publicado_en: fecha(b.publicado_en, 'La fecha de publicación') || (nuevo ? new Date() : undefined),
    resumen_para_carta: txt(b.resumen_para_carta, 200, 'El resumen') || (nuevo ? titulo.slice(0, 200) : undefined),
    resumen_para_galeria: galeria || (nuevo ? ' ' : undefined), enlace: txt(b.enlace, 500, 'El enlace'), borrador: bool(b.borrador),
  };
}

function registrar(app) {
  // ------------------------------------------------------------------ listado general
  app.get('/api/admin/contenido', A, wrap(async (_q, res) => {
    const cursos = await all(`SELECT ${CURSO_COLS},
        (SELECT count(*)::int FROM inscripciones_curso i WHERE i.curso_id=c.curso_id AND i.estado='LISTA_ESPERA') AS en_lista_espera
        FROM cursos_y_talleres c ORDER BY c.creado_en DESC`);
    const convocatorias = await all(`SELECT c.*, (SELECT count(*)::int FROM postulaciones_castings p WHERE p.convocatoria_id=c.convocatoria_id) AS postulantes,
        (SELECT count(*)::int FROM postulaciones_castings p WHERE p.convocatoria_id=c.convocatoria_id AND p.estado='SELECCIONADO') AS seleccionados,
        COALESCE((SELECT json_agg(json_build_object('habilidad_id',h.habilidad_id,'nombre',h.nombre,'obligatoria',ch.obligatoria))
                    FROM convocatorias_habilidades ch JOIN habilidades h USING(habilidad_id) WHERE ch.convocatoria_id=c.convocatoria_id),'[]') AS habilidades
        FROM convocatorias c ORDER BY c.creado_en DESC`);
    const noticias = await all('SELECT * FROM noticias ORDER BY publicado_en DESC');
    for (const f of [...cursos, ...convocatorias, ...noticias]) f.imagen_url = f.imagen_url ? await archivos.urlDe(f.imagen_url) : null;
    cursos.forEach(conCupos);
    res.json({ cursos, convocatorias, noticias });
  }));

  // ------------------------------------------------------------------ cursos
  app.post('/api/admin/cursos', A, upload.single('imagen'), wrap(async (req, res) => {
    const b = req.body || {}, d = validarCurso(b);
    const img = await imagen('portadas/cursos', req.file);
    try {
      const out = await tx(async (c) => {
        const cols = [...COLS_CURSO, 'creado_por_admin_id', 'imagen_url'];
        const vals = [...COLS_CURSO.map((k) => d[k]), req.u.id, img || null];
        const id = (await c.query(`INSERT INTO cursos_y_talleres(${cols.join(',')},estado) VALUES(${cols.map((_, i) => `$${i + 1}`).join(',')},'BORRADOR') RETURNING curso_id`, vals)).rows[0].curso_id;
        await audit(c, 'ACCION_ADMINISTRADOR', 'cursos_y_talleres', id, quien(req), 'CREAR_CURSO', { accion: 'CREAR', tipo: d.tipo });
        if (bool(b.publicar)) await estadoCurso(c, id, 'ABIERTO', null, req);
        return { id };
      });
      res.json(out);
    } catch (e) { if (img) await archivos.eliminar([img]); throw e; }
  }));

  app.put('/api/admin/cursos/:id', A, upload.single('imagen'), wrap(async (req, res) => {
    const id = req.params.id, b = req.body || {};
    if (!esUuid(id)) throw fail(404, 'Curso no encontrado');
    const d = validarCurso(b);
    const img = await imagen('portadas/cursos', req.file);
    let borrar = [];
    try {
      await tx(async (c) => {
        await lock(c, id);
        const act = (await c.query('SELECT * FROM cursos_y_talleres WHERE curso_id=$1', [id])).rows[0];
        if (!act) throw fail(404, 'Curso no encontrado');
        if (!['BORRADOR', 'ABIERTO'].includes(act.estado)) throw fail(409, `Un curso ${act.estado} ya no se puede editar`);
        const ocupados = (await c.query(`SELECT count(*)::int n FROM inscripciones_curso WHERE curso_id=$1 AND estado IN ${OCUPAN}`, [id])).rows[0].n;
        if (d.cupo_maximo < ocupados) throw fail(409, `Ya hay ${ocupados} inscritos: el cupo no puede ser menor`);
        const cols = [...COLS_CURSO], vals = COLS_CURSO.map((k) => d[k]);
        if (img) { cols.push('imagen_url'); vals.push(img); if (act.imagen_url && !P.esLocal(act.imagen_url)) borrar = [act.imagen_url]; }
        else if (bool(b.quitar_imagen)) { cols.push('imagen_url'); vals.push(null); if (act.imagen_url && !P.esLocal(act.imagen_url)) borrar = [act.imagen_url]; }
        await c.query(`UPDATE cursos_y_talleres SET ${cols.map((k, i) => `${k}=$${i + 2}`).join(',')}, actualizado_en=now() WHERE curso_id=$1`, [id, ...vals]);
        const promovidos = await promover(c, id, d.cupo_maximo);
        await audit(c, 'ACCION_ADMINISTRADOR', 'cursos_y_talleres', id, quien(req), 'ACTUALIZAR_CURSO', { accion: 'ACTUALIZAR', promovidos });
        if (bool(b.publicar) && act.estado === 'BORRADOR') await estadoCurso(c, id, 'ABIERTO', null, req);
      });
      await archivos.eliminar(borrar);
      res.json({ ok: true });
    } catch (e) { if (img) await archivos.eliminar([img]); throw e; }
  }));

  app.put('/api/admin/cursos/:id/estado', A, wrap(async (req, res) => {
    if (!esUuid(req.params.id)) throw fail(404, 'Curso no encontrado');
    const estado = String((req.body || {}).estado || '');
    if (!Object.keys(TRANS_CURSO).includes(estado)) throw fail(400, 'Estado inválido');
    const r = await tx(async (c) => { await lock(c, req.params.id); return estadoCurso(c, req.params.id, estado, req.body.motivo, req); });
    res.json({ ok: true, ...r });
  }));

  app.delete('/api/admin/cursos/:id', A, wrap(async (req, res) => {
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Curso no encontrado');
    let borrar = [];
    await tx(async (c) => {
      await lock(c, id);
      const curso = (await c.query('SELECT * FROM cursos_y_talleres WHERE curso_id=$1', [id])).rows[0];
      if (!curso) throw fail(404, 'Curso no encontrado');
      const insc = (await c.query('SELECT count(*)::int n FROM inscripciones_curso WHERE curso_id=$1', [id])).rows[0].n;
      const cert = (await c.query('SELECT count(*)::int n FROM certificados WHERE curso_id=$1', [id])).rows[0].n;
      if (curso.estado !== 'BORRADOR' || insc > 0 || cert > 0) throw fail(409, 'Solo se puede eliminar un curso en borrador sin inscripciones; cancélalo en su lugar');
      await c.query('DELETE FROM cursos_y_talleres WHERE curso_id=$1', [id]);
      if (curso.imagen_url && !P.esLocal(curso.imagen_url)) borrar = [curso.imagen_url];
      await audit(c, 'ACCION_ADMINISTRADOR', 'cursos_y_talleres', id, quien(req), 'ELIMINAR_CURSO', { accion: 'ELIMINAR', titulo: curso.titulo });
    });
    await archivos.eliminar(borrar);
    res.json({ ok: true });
  }));

  // Inscritos de un curso
  app.get('/api/admin/cursos/:id/inscritos', A, wrap(async (req, res) => {
    if (!esUuid(req.params.id)) throw fail(404, 'Curso no encontrado');
    const filas = await all(
      `SELECT i.inscripcion_id, a.actor_id, COALESCE(NULLIF(p.nombre_artistico,''), a.nombre_completo) AS nombre, a.nombre_completo, a.correo, a.telefono, a.municipio,
              ${P.FOTO_KEY} AS foto_key, i.progreso, i.estado, i.inscrito_en, i.notas_admin
         FROM inscripciones_curso i JOIN actores a USING(actor_id) LEFT JOIN perfiles_actores p USING(actor_id)
        WHERE i.curso_id=$1 ORDER BY i.inscrito_en, i.inscripcion_id`, [req.params.id]);
    res.json(await P.conFotos(filas));
  }));

  // Cambiar el resultado/estado de una inscripción y/o su progreso
  app.put('/api/admin/inscripciones/:id', A, wrap(async (req, res) => {
    const id = req.params.id, b = req.body || {};
    if (!esUuid(id)) throw fail(404, 'Inscripción no encontrada');
    const out = await tx(async (c) => {
      const pre = (await c.query('SELECT curso_id FROM inscripciones_curso WHERE inscripcion_id=$1', [id])).rows[0];
      if (!pre) throw fail(404, 'Inscripción no encontrada');
      await lock(c, pre.curso_id);
      const insc = (await c.query(`SELECT i.*, c.estado AS curso_estado, c.cupo_maximo FROM inscripciones_curso i JOIN cursos_y_talleres c USING(curso_id) WHERE i.inscripcion_id=$1`, [id])).rows[0];
      let progreso = insc.progreso;
      if (b.progreso !== undefined) {
        const p = entero(b.progreso);
        if (p === null || p < 0 || p > 100) throw fail(400, 'El progreso debe estar entre 0 y 100');
        progreso = p;
        await c.query('UPDATE inscripciones_curso SET progreso=$2, actualizado_en=now() WHERE inscripcion_id=$1', [id, p]);
        await audit(c, 'ACCION_ADMINISTRADOR', 'inscripciones_curso', id, quien(req), 'CAMBIAR_ESTADO_INSCRIPCION', { accion: 'ACTUALIZAR_PROGRESO', progreso: p, curso_id: insc.curso_id });
      }
      let estado = insc.estado, promovidos = 0, revocados = 0;
      if (b.estado && b.estado !== insc.estado) {
        const TRANS = { INSCRITO: ['COMPLETADA', 'NO_COMPLETADA', 'CANCELADA'], LISTA_ESPERA: ['CANCELADA'], COMPLETADA: ['NO_COMPLETADA'], NO_COMPLETADA: ['COMPLETADA'], CANCELADA: [] };
        if (!(TRANS[insc.estado] || []).includes(b.estado)) throw fail(409, `No se puede pasar de ${insc.estado} a ${b.estado}`);
        if (['COMPLETADA', 'NO_COMPLETADA'].includes(b.estado) && !['EN_CURSO', 'FINALIZADO'].includes(insc.curso_estado)) throw fail(409, 'El resultado solo se registra cuando el curso está en curso o finalizado');
        const notas = txt(b.notas, 1000, 'Las notas');
        if (b.estado === 'CANCELADA' && (notas || '').length < 5) throw fail(400, 'Para cancelar una inscripción indica el motivo (mínimo 5 caracteres)');
        const r = await c.query(`UPDATE inscripciones_curso SET estado=$2::estado_inscripcion_enum, notas_admin=COALESCE($3,notas_admin), revisado_por_admin_id=$4, actualizado_en=now()
                                  WHERE inscripcion_id=$1 AND estado=$5::estado_inscripcion_enum`, [id, b.estado, notas, req.u.id, insc.estado]);
        if (r.rowCount !== 1) throw fail(409, 'La inscripción cambió mientras la editabas; recarga');
        if (insc.estado === 'COMPLETADA') {
          revocados = (await c.query(`UPDATE certificados SET revocado_en=now(), motivo_revocacion='Cambio de resultado de la inscripción', revocado_por_admin_id=$3
                                       WHERE actor_id=$1 AND curso_id=$2 AND tipo='CURSO' AND revocado_en IS NULL`, [insc.actor_id, insc.curso_id, req.u.id])).rowCount;
        }
        if (b.estado === 'CANCELADA') promovidos = await promover(c, insc.curso_id, insc.cupo_maximo);
        await audit(c, 'ACCION_ADMINISTRADOR', 'inscripciones_curso', id, quien(req), 'CAMBIAR_ESTADO_INSCRIPCION',
          { accion: 'CAMBIAR_ESTADO_INSCRIPCION', de: insc.estado, a: b.estado, curso_id: insc.curso_id, actor_id: insc.actor_id, notas, certificados_revocados: revocados, promovidos });
        estado = b.estado;
      }
      return { ok: true, estado, progreso, promovidos, certificados_revocados: revocados };
    });
    res.json(out);
  }));

  // ------------------------------------------------------------------ convocatorias
  app.post('/api/admin/convocatorias', A, upload.single('imagen'), wrap(async (req, res) => {
    const b = req.body || {}, d = await validarConv(b);
    const img = await imagen('portadas/convocatorias', req.file);
    try {
      const out = await tx(async (c) => {
        const estado = bool(b.borrador) ? 'EN_PAUSA' : d.apertura && d.apertura > new Date() ? 'PROXIMA' : 'ACTIVA';
        const ks = [...COLS_CONV, 'creado_por_admin_id', 'imagen_url'];
        const vs = [...COLS_CONV.map((k) => d.cols[k]), req.u.id, img || null];
        const id = (await c.query(`INSERT INTO convocatorias(${ks.join(',')},estado) VALUES(${ks.map((_, i) => `$${i + 1}`).join(',')},$${ks.length + 1}::estado_convocatoria_enum) RETURNING convocatoria_id`, [...vs, estado])).rows[0].convocatoria_id;
        await guardarHabConv(c, id, d.habilidades);
        await audit(c, 'ACCION_ADMINISTRADOR', 'convocatorias', id, quien(req), 'CREAR_CONVOCATORIA', { accion: 'CREAR', estado });
        return { id };
      });
      res.json(out);
    } catch (e) { if (img) await archivos.eliminar([img]); throw e; }
  }));

  app.put('/api/admin/convocatorias/:id', A, upload.single('imagen'), wrap(async (req, res) => {
    const id = req.params.id, b = req.body || {};
    if (!esUuid(id)) throw fail(404, 'Convocatoria no encontrada');
    const d = await validarConv(b);
    const img = await imagen('portadas/convocatorias', req.file);
    let borrar = [];
    try {
      await tx(async (c) => {
        const act = (await c.query('SELECT * FROM convocatorias WHERE convocatoria_id=$1', [id])).rows[0];
        if (!act) throw fail(404, 'Convocatoria no encontrada');
        if (act.estado === 'CERRADA') throw fail(409, 'Una convocatoria cerrada no se puede editar');
        const sel = (await c.query(`SELECT count(*)::int n FROM postulaciones_castings WHERE convocatoria_id=$1 AND estado='SELECCIONADO'`, [id])).rows[0].n;
        if (d.cols.cupo_maximo < sel) throw fail(409, `Ya hay ${sel} seleccionados: las vacantes no pueden ser menos`);
        const ks = [...COLS_CONV], vs = COLS_CONV.map((k) => d.cols[k]);
        if (img) { ks.push('imagen_url'); vs.push(img); if (act.imagen_url && !P.esLocal(act.imagen_url)) borrar = [act.imagen_url]; }
        else if (bool(b.quitar_imagen)) { ks.push('imagen_url'); vs.push(null); if (act.imagen_url && !P.esLocal(act.imagen_url)) borrar = [act.imagen_url]; }
        await c.query(`UPDATE convocatorias SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(',')}, actualizado_en=now() WHERE convocatoria_id=$1`, [id, ...vs]);
        await guardarHabConv(c, id, d.habilidades);
        await audit(c, 'ACCION_ADMINISTRADOR', 'convocatorias', id, quien(req), 'ACTUALIZAR_CONVOCATORIA', { accion: 'ACTUALIZAR' });
        if (b.estado && b.estado !== act.estado) await estadoConv(c, id, String(b.estado), null, req);
      });
      await archivos.eliminar(borrar);
      res.json({ ok: true });
    } catch (e) { if (img) await archivos.eliminar([img]); throw e; }
  }));

  app.put('/api/admin/convocatorias/:id/estado', A, wrap(async (req, res) => {
    if (!esUuid(req.params.id)) throw fail(404, 'Convocatoria no encontrada');
    const estado = String((req.body || {}).estado || '');
    if (!Object.keys(TRANS_CONV).includes(estado)) throw fail(400, 'Estado inválido');
    const r = await tx((c) => estadoConv(c, req.params.id, estado, req.body.motivo, req));
    res.json({ ok: true, ...r });
  }));

  app.delete('/api/admin/convocatorias/:id', A, wrap(async (req, res) => {
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Convocatoria no encontrada');
    let borrar = [];
    await tx(async (c) => {
      const conv = (await c.query('SELECT * FROM convocatorias WHERE convocatoria_id=$1', [id])).rows[0];
      if (!conv) throw fail(404, 'Convocatoria no encontrada');
      const n = (await c.query('SELECT count(*)::int n FROM postulaciones_castings WHERE convocatoria_id=$1', [id])).rows[0].n;
      if (n > 0) throw fail(409, 'Esta convocatoria ya tiene postulaciones: ciérrala en lugar de eliminarla');
      await c.query('DELETE FROM convocatorias WHERE convocatoria_id=$1', [id]);
      if (conv.imagen_url && !P.esLocal(conv.imagen_url)) borrar = [conv.imagen_url];
      await audit(c, 'ELIMINAR', 'convocatorias', id, quien(req), 'Eliminó convocatoria: ' + conv.titulo);
    });
    await archivos.eliminar(borrar);
    res.json({ ok: true });
  }));

  app.get('/api/admin/convocatorias/:id/postulantes', A, wrap(async (req, res) => {
    if (!esUuid(req.params.id)) throw fail(404, 'Convocatoria no encontrada');
    const filas = await all(
      `SELECT pc.postulacion_id, pc.estado, pc.estado AS etapa, pc.compatibilidad, pc.detalle_compatibilidad, pc.notas_admin, pc.postulado_en, ${P.COLS_ADMIN},
              (SELECT g.esta_verificado FROM acudientes_legales g WHERE g.actor_id=a.actor_id ORDER BY g.esta_verificado DESC LIMIT 1) AS acudiente_verificado
         FROM postulaciones_castings pc JOIN actores a ON a.actor_id=pc.actor_id JOIN perfiles_actores p ON p.actor_id=a.actor_id
        WHERE pc.convocatoria_id=$1 ORDER BY pc.compatibilidad DESC, pc.postulado_en`, [req.params.id]);
    res.json(await P.conFotos(filas));
  }));

  app.put('/api/admin/postulaciones/:id', A, wrap(async (req, res) => {
    const id = req.params.id, b = req.body || {};
    if (!esUuid(id)) throw fail(404, 'Postulación no encontrada');
    const estado = String(b.estado || b.etapa || '');
    const TRANS = { POSTULADO: ['EN_REVISION', 'PRESELECCIONADO', 'RECHAZADO'], EN_REVISION: ['POSTULADO', 'PRESELECCIONADO', 'RECHAZADO'],
      PRESELECCIONADO: ['EN_REVISION', 'SELECCIONADO', 'RECHAZADO'], SELECCIONADO: ['PRESELECCIONADO', 'RECHAZADO'], RECHAZADO: ['EN_REVISION'] };
    if (!Object.keys(TRANS).includes(estado)) throw fail(400, 'Estado inválido');
    const notas = txt(b.notas, 2000, 'Las notas');
    const out = await tx(async (c) => {
      const ini = (await c.query('SELECT convocatoria_id FROM postulaciones_castings WHERE postulacion_id=$1', [id])).rows[0];
      if (!ini) throw fail(404, 'Postulación no encontrada');
      await lock(c, ini.convocatoria_id);
      const p = (await c.query(`SELECT pc.*, c.cupo_maximo FROM postulaciones_castings pc JOIN convocatorias c USING(convocatoria_id) WHERE pc.postulacion_id=$1`, [id])).rows[0];
      if (b.estado_anterior && b.estado_anterior !== p.estado) throw fail(409, `La tarjeta ya está en ${p.estado}; recarga el tablero`);
      if (p.estado === estado) throw fail(409, `La postulación ya está en ${estado}`);
      if (!TRANS[p.estado].includes(estado)) throw fail(409, `No se puede pasar de ${p.estado} a ${estado}`);
      if (estado === 'RECHAZADO' && (notas || '').length < 10) throw fail(400, 'Para rechazar indica el motivo (mínimo 10 caracteres)');
      if (estado === 'SELECCIONADO') {
        const n = (await c.query(`SELECT count(*)::int n FROM postulaciones_castings WHERE convocatoria_id=$1 AND estado='SELECCIONADO'`, [p.convocatoria_id])).rows[0].n;
        if (n >= p.cupo_maximo) throw fail(409, `Ya se completaron las ${p.cupo_maximo} vacantes de la convocatoria`);
      }
      const r = await c.query(`UPDATE postulaciones_castings SET estado=$2::estado_postulacion_enum, notas_admin=COALESCE($3,notas_admin), revisado_por_admin_id=$4, actualizado_en=now()
                                WHERE postulacion_id=$1 AND estado=$5::estado_postulacion_enum`, [id, estado, notas, req.u.id, p.estado]);
      if (r.rowCount !== 1) throw fail(409, 'La postulación cambió mientras la editabas; recarga el tablero');
      await audit(c, 'ACCION_ADMINISTRADOR', 'postulaciones_castings', id, quien(req), 'CAMBIAR_ESTADO_POSTULACION',
        { accion: 'CAMBIAR_ESTADO_POSTULACION', de: p.estado, a: estado, convocatoria_id: p.convocatoria_id, actor_id: p.actor_id, notas });
      return { ok: true, estado_anterior: p.estado, estado };
    });
    res.json(out);
  }));

  // ------------------------------------------------------------------ noticias
  const imgNoticia = (f) => imagen('portadas/noticias', f);
  app.post('/api/admin/noticias', A, upload.single('imagen'), wrap(async (req, res) => {
    const d = validarNoticia(req.body || {}, true);
    const img = await imgNoticia(req.file);
    try {
      const out = await tx(async (c) => {
        const ks = ['titulo', 'categoria', 'publicado_en', 'resumen_para_carta', 'resumen_para_galeria', 'enlace', 'borrador'];
        const id = (await c.query(`INSERT INTO noticias(creado_por_admin_id,imagen_url,${ks.join(',')}) VALUES($1,$2,${ks.map((_, i) => `$${i + 3}`).join(',')}) RETURNING noticia_id`,
          [req.u.id, img || null, ...ks.map((k) => d[k])])).rows[0].noticia_id;
        await audit(c, 'CREAR', 'noticias', id, quien(req), 'Creó noticia: ' + d.titulo);
        return { id };
      });
      res.json(out);
    } catch (e) { if (img) await archivos.eliminar([img]); throw e; }
  }));
  app.put('/api/admin/noticias/:id', A, upload.single('imagen'), wrap(async (req, res) => {
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Noticia no encontrada');
    const d = validarNoticia(req.body || {}, false);
    const img = await imgNoticia(req.file);
    let borrar = [];
    try {
      await tx(async (c) => {
        const act = (await c.query('SELECT imagen_url FROM noticias WHERE noticia_id=$1', [id])).rows[0];
        if (!act) throw fail(404, 'Noticia no encontrada');
        const ks = ['titulo', 'categoria', 'enlace', 'borrador'].concat(['publicado_en', 'resumen_para_carta', 'resumen_para_galeria'].filter((k) => d[k] !== undefined));
        const vs = ks.map((k) => d[k]);
        if (img) { ks.push('imagen_url'); vs.push(img); if (act.imagen_url && !P.esLocal(act.imagen_url)) borrar = [act.imagen_url]; }
        else if (bool((req.body || {}).quitar_imagen)) { ks.push('imagen_url'); vs.push(null); if (act.imagen_url && !P.esLocal(act.imagen_url)) borrar = [act.imagen_url]; }
        await c.query(`UPDATE noticias SET ${ks.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE noticia_id=$1`, [id, ...vs]);
        await audit(c, 'ACTUALIZAR', 'noticias', id, quien(req), 'Editó noticia: ' + d.titulo);
      });
      await archivos.eliminar(borrar);
      res.json({ ok: true });
    } catch (e) { if (img) await archivos.eliminar([img]); throw e; }
  }));
  app.delete('/api/admin/noticias/:id', A, wrap(async (req, res) => {
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Noticia no encontrada');
    let borrar = [];
    await tx(async (c) => {
      const n = (await c.query('SELECT titulo, imagen_url FROM noticias WHERE noticia_id=$1', [id])).rows[0];
      if (!n) throw fail(404, 'Noticia no encontrada');
      await c.query('DELETE FROM noticias WHERE noticia_id=$1', [id]);
      if (n.imagen_url && !P.esLocal(n.imagen_url)) borrar = [n.imagen_url];
      await audit(c, 'ELIMINAR', 'noticias', id, quien(req), 'Eliminó noticia: ' + n.titulo);
    });
    await archivos.eliminar(borrar);
    res.json({ ok: true });
  }));
}

module.exports = { registrar };
