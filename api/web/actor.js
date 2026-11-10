// Rutas del actor: registro, perfil (con versiones), panel, cursos y postulaciones.
// Reglas espejo de api/src: ActoresService, PerfilService, MultimediaService, InscripcionesService, PostulacionesService.
const { randomUUID } = require('crypto');
const multer = require('multer');
const { pool, all, one, tx, lock } = require('./db');
const { fail, wrap, nn, bool, entero, json, esUuid, limpiar, audit, auditSafe } = require('./util');
const cat = require('./catalogos');
const P = require('./perfil');
const archivos = require('./archivos');
const seg = require('./seguridad');
const { analizarEnlaceVideo } = require('./videos');
const { evaluar } = require('./casting');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 14, fields: 120, fieldSize: 256 * 1024, parts: 140 },
});
const camposRegistro = upload.fields([
  { name: 'foto', maxCount: 1 }, { name: 'fotos', maxCount: 10 }, { name: 'autorizacion', maxCount: 1 },
]);
const camposPerfil = upload.fields([{ name: 'foto', maxCount: 1 }, { name: 'fotos', maxCount: 10 }]);

const CAMPOS = ['nombre_artistico', 'tiene_experiencia', 'biografia', 'foto_perfil_url', 'estatura_cm', 'color_ojos', 'color_cabello',
  'tono_piel', 'contextura', 'genero', 'edad_aparente_min', 'edad_aparente_max', 'dialecto', 'provincia'];
const CUPOS = { FOTO_BOOK: 10, REEL_PRESENTACION: 3, ENLACE_PORTAFOLIO: 5 };
const TELEFONO = /^\+?[0-9\s-]{7,20}$/;
const telefonoOpt = (v) => {
  const t = limpiar(nn(v));
  if (t === null) return null;
  if (!TELEFONO.test(String(t))) throw fail(400, 'El teléfono no es válido.');
  return String(t);
};
const hoyBogota = () => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).split('-').map(Number);
  return { y, m, d };
};
const parseFecha = (s) => {
  const f = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(f.getTime()) || f.toISOString().slice(0, 10) !== s ? null : f;
};
const edadDe = (nac) => {
  const h = hoyBogota();
  let e = h.y - nac.getUTCFullYear();
  if (h.m < nac.getUTCMonth() + 1 || (h.m === nac.getUTCMonth() + 1 && h.d < nac.getUTCDate())) e--;
  return e;
};

const texto = (v, max, nombre, min = 0) => {
  const t = limpiar(nn(v));
  if (t === null) return null;
  if (String(t).length > max) throw fail(400, `${nombre} no puede superar ${max} caracteres`);
  if (String(t).length < min) throw fail(400, `${nombre} debe tener al menos ${min} caracteres`);
  return String(t);
};
const catalogo = (lista, v, nombre) => {
  const t = limpiar(nn(v));
  if (t !== null && !cat.codigos(lista).includes(t)) throw fail(400, `${nombre} no es válido`);
  return t;
};

/** Valida y normaliza los 14 campos moderados del perfil (los mismos de PerfilDto). */
function datosPerfilDesde(b, fotoKey) {
  const emin = entero(b.edad_aparente_min), emax = entero(b.edad_aparente_max);
  if ((emin === null) !== (emax === null)) throw fail(400, 'Indica la edad aparente mínima y máxima juntas, o ninguna');
  if (emin !== null && (emin < 0 || emax > 100 || emin > emax)) throw fail(400, 'La edad aparente debe estar entre 0 y 100, con el mínimo menor o igual al máximo');
  const est = entero(b.estatura_cm ?? b.estatura);
  if (est !== null && (est < 50 || est > 250)) throw fail(400, 'La estatura debe estar entre 50 y 250 cm');
  const datos = {
    nombre_artistico: texto(b.nombre_artistico, 100, 'El nombre artístico'),
    tiene_experiencia: bool(b.tiene_experiencia),
    biografia: texto(b.biografia, 2000, 'La biografía'),
    foto_perfil_url: fotoKey || null,
    estatura_cm: est,
    color_ojos: catalogo(cat.COLORES_OJOS, b.color_ojos, 'El color de ojos'),
    color_cabello: catalogo(cat.COLORES_CABELLO, b.color_cabello, 'El color de cabello'),
    tono_piel: catalogo(cat.TONOS_PIEL, b.tono_piel ?? b.tez, 'El tono de piel'),
    contextura: texto(b.contextura, 50, 'La contextura'),
    genero: catalogo(cat.GENEROS, b.genero, 'El género'),
    edad_aparente_min: emin,
    edad_aparente_max: emax,
    dialecto: catalogo(cat.DIALECTOS, b.dialecto ?? b.acento, 'El dialecto'),
    provincia: catalogo(cat.PROVINCIAS, b.provincia, 'La provincia'),
  };
  return datos;
}
const norm = (v) => (v === undefined || v === '' ? null : v);
const columnas = (d) => CAMPOS.map((c) => norm(d[c]));
const cambios = (a, b) => CAMPOS.filter((c) => norm(a && a[c]) !== norm(b && b[c]));

// ------------------------------------------------------------------ datos secundarios (sin moderación)
function habilidadesDesde(b) {
  let lista = [];
  if (b.habilidades !== undefined) {
    lista = json(b.habilidades).map((h) => ({ nombre: String(h.nombre || '').trim(), tipo: h.tipo || 'ESPECIALIDAD', nivel: nn(h.nivel) }));
  } else {
    lista = [...json(b.areas).map((n) => ({ nombre: String(n).trim(), tipo: 'AREA', nivel: null })),
      ...json(b.especialidades).map((n) => ({ nombre: String(n).trim(), tipo: 'ESPECIALIDAD', nivel: null }))];
  }
  const vistos = new Set();
  lista = lista.filter((h) => h.nombre && h.nombre.length <= 100 && !vistos.has(h.nombre.toLowerCase()) && vistos.add(h.nombre.toLowerCase()));
  if (lista.length > 15) throw fail(400, 'Puedes registrar máximo 15 áreas y destrezas');
  return lista;
}
async function guardarHabilidades(c, id, lista) {
  await c.query('DELETE FROM actores_habilidades WHERE actor_id=$1', [id]);
  for (const h of lista) {
    const r = await c.query(
      `INSERT INTO habilidades(nombre,tipo) VALUES($1,$2) ON CONFLICT(nombre) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING habilidad_id`, [h.nombre, h.tipo]);
    await c.query('INSERT INTO actores_habilidades(actor_id,habilidad_id,nivel) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [id, r.rows[0].habilidad_id, h.nivel]);
  }
}
async function guardarListas(c, id, b) {
  const reemplazar = async (campo, tabla, sql, map) => {
    if (b[campo] === undefined) return;
    await c.query(`DELETE FROM ${tabla} WHERE actor_id=$1`, [id]);
    for (const r of json(b[campo]).slice(0, 40)) { const v = map(r || {}); if (v) await c.query(sql, [id, ...v]); }
  };
  const anio = (v) => { const n = parseInt(v, 10); return n >= 1900 && n <= 2100 ? n : new Date().getUTCFullYear(); };
  await reemplazar('idiomas', 'idiomas_actor', 'INSERT INTO idiomas_actor(actor_id,idioma,nivel) VALUES($1,$2,$3)',
    (r) => (r.idioma ? [String(r.idioma).slice(0, 60), nn(r.nivel) && String(r.nivel).slice(0, 40)] : null));
  await reemplazar('formacion', 'formacion_actor', 'INSERT INTO formacion_actor(actor_id,periodo,titulo,institucion) VALUES($1,$2,$3,$4)',
    (r) => (r.titulo ? [nn(r.periodo) && String(r.periodo).slice(0, 40), String(r.titulo).slice(0, 200), nn(r.institucion) && String(r.institucion).slice(0, 200)] : null));
  await reemplazar('experiencias', 'experiencias_actor',
    'INSERT INTO experiencias_actor(actor_id,nombre_proyecto,tipo_produccion,rol_desempenado,anio,director_o_productora) VALUES($1,$2,$3,$4,$5,$6)',
    (r) => (r.proyecto ? [String(r.proyecto).slice(0, 200), String(r.tipo || 'Otro').slice(0, 100), String(r.rol || 'Sin especificar').slice(0, 100), anio(r.anio), nn(r.director) && String(r.director).slice(0, 200)] : null));
  await reemplazar('redes', 'redes_sociales_actor', 'INSERT INTO redes_sociales_actor(actor_id,plataforma,url_perfil) VALUES($1,$2,$3)',
    (r) => (r.url && /^https?:\/\//i.test(r.url) ? [String(r.plataforma || 'Web').slice(0, 50), String(r.url).slice(0, 500)] : null));
}

/** Inserta una fila de multimedia con su auditoría; valida el cupo con el actor bloqueado. */
async function insertarMultimedia(c, actorId, quien, tipo, datos) {
  if (CUPOS[tipo]) {
    const n = (await c.query('SELECT count(*)::int n FROM archivos_multimedia WHERE actor_id=$1 AND tipo_archivo=$2::tipo_multimedia_enum', [actorId, tipo])).rows[0].n;
    if (n >= CUPOS[tipo]) throw fail(409, tipo === 'FOTO_BOOK' ? 'Ya tienes el máximo de 10 fotos en tu book' : 'Ya tienes el máximo de enlaces permitidos de este tipo');
  }
  const r = await c.query(
    `INSERT INTO archivos_multimedia(actor_id,tipo_archivo,almacenamiento,url_archivo,url_miniatura,mime_type,tamano_bytes,ancho,alto,proveedor_video,id_video,titulo)
     VALUES($1,$2::tipo_multimedia_enum,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING multimedia_id`,
    [actorId, tipo, datos.almacenamiento || 'S3', datos.url_archivo, datos.url_miniatura || null, datos.mime_type || null, datos.tamano_bytes ?? null,
      datos.ancho ?? null, datos.alto ?? null, datos.proveedor_video || null, datos.id_video || null, datos.titulo || null]);
  await audit(c, 'CREAR', 'archivos_multimedia', r.rows[0].multimedia_id, quien, `Alta de multimedia ${tipo}`, { tipo, actor_id: actorId });
  return r.rows[0].multimedia_id;
}
const enlaceDe = (url) => {
  const e = analizarEnlaceVideo(String(url));
  if (!e) throw fail(400, 'El enlace debe ser una URL https de YouTube o Vimeo que apunte a un video válido');
  return { almacenamiento: 'EXTERNO', url_archivo: e.url_canonica, proveedor_video: e.proveedor, id_video: e.id_video };
};

// ------------------------------------------------------------------ perfil del actor (vista propia)
async function miPerfil(id) {
  const a = await P.perfilCompleto(id, 'privada');
  if (!a) return null;
  const [pend, rech, vigente] = await Promise.all([
    one(`SELECT numero_version, datos, creado_en FROM perfiles_versiones WHERE actor_id=$1 AND estado='PENDIENTE'`, [id]),
    one(`SELECT numero_version, motivo_rechazo, revisado_en FROM perfiles_versiones WHERE actor_id=$1 AND estado='RECHAZADA' ORDER BY creado_en DESC LIMIT 1`, [id]),
    one(`SELECT 1 FROM perfiles_versiones WHERE actor_id=$1 AND estado='APROBADA'`, [id]),
  ]);
  a.publicado = { nombre_artistico: a.nombre_artistico, biografia: a.biografia };
  a.tiene_version_publica = !!vigente;
  a.pendiente = null;
  if (pend) {
    // El formulario se rellena con el borrador enviado a revisión (lo público no cambia hasta que se apruebe)
    const d = pend.datos || {};
    for (const c of CAMPOS) if (c !== 'foto_perfil_url') a[c] = d[c] ?? null;
    a.nombre = a.nombre_artistico || a.nombre_completo;
    if (d.foto_perfil_url) {
      const k = d.foto_perfil_url;
      a.foto = await archivos.urlDe(P.miniaturaDe(k));
      a.foto_grande = await archivos.urlDe(k);
    }
    a.pendiente = { numero_version: pend.numero_version, enviado_en: pend.creado_en };
  }
  a.ultima_rechazada = !pend && rech ? rech : null;
  return a;
}

function registrar(app) {
  // ------------------------------------------------------------------ registro público
  app.post('/api/registro', camposRegistro, wrap(async (req, res) => {
    const b = req.body || {}, f = req.files || {};
    const foto = f.foto && f.foto[0], autorizacion = f.autorizacion && f.autorizacion[0], book = f.fotos || [];
    if (!bool(b.acepta_terminos)) throw fail(400, 'Debes aceptar el tratamiento de datos personales (Ley 1581 de 2012).');

    const correo = String(limpiar(b.correo) || '').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 201) throw fail(400, 'Escribe un correo válido.');
    seg.validarContrasena(b.contrasena);
    const nombre = texto(b.nombre_completo, 200, 'El nombre completo', 3);
    if (!nombre) throw fail(400, 'Faltan datos obligatorios del paso 1.');
    const tipoDoc = String(b.tipo_documento || 'CC').toUpperCase();
    if (!cat.TIPOS_DOCUMENTO.includes(tipoDoc)) throw fail(400, 'El tipo de documento no es válido.');
    const doc = String(limpiar(b.numero_documento) || '').replace(/[\s.\-]/g, '').toUpperCase();
    if (doc.length < 5 || doc.length > 50) throw fail(400, 'El número de documento debe tener entre 5 y 50 caracteres.');
    const nac = parseFecha(String(limpiar(b.fecha_nacimiento) || ''));
    if (!nac) throw fail(400, 'La fecha de nacimiento no es válida.');
    const edad = edadDe(nac);
    if (edad < 0 || edad > 110) throw fail(400, 'La fecha de nacimiento está fuera de rango.');
    const esMenor = edad < 18;
    const municipio = texto(b.municipio, 100, 'El municipio', 2);
    if (!municipio) throw fail(400, 'Indica tu municipio.');
    const ciudad = texto(b.ciudad, 100, 'La ciudad', 2) || municipio;
    const telefono = String(limpiar(b.telefono) || '');
    if (!TELEFONO.test(telefono)) throw fail(400, 'El teléfono no es válido.');

    const datos = datosPerfilDesde({ ...b, tiene_experiencia: bool(b.tiene_experiencia) || json(b.experiencias).length > 0 }, null);
    const ocupacion = texto(b.ocupacion, 120, 'La ocupación');
    const nivel = texto(b.nivel, 20, 'El nivel');
    const habilidades = habilidadesDesde(b);
    const reel = nn(b.reel_url) && enlaceDe(b.reel_url);
    const portafolio = nn(b.portafolio_url) && enlaceDe(b.portafolio_url);

    // Acudiente (RF-19)
    let ac = null;
    if (esMenor) {
      ac = {
        nombre: texto(b.nombre_acudiente ?? b.acudiente_nombre, 200, 'El nombre del acudiente'),
        documento: String(limpiar(b.documento_acudiente ?? b.acudiente_documento) || '').replace(/[\s.\-]/g, '').toUpperCase() || null,
        telefono: String(limpiar(b.telefono_acudiente ?? b.acudiente_telefono) || '') || null,
        correo: String(limpiar(b.correo_acudiente ?? b.acudiente_correo) || '').toLowerCase() || null,
      };
      const faltan = [['nombre_acudiente', ac.nombre], ['documento_acudiente', ac.documento], ['telefono_acudiente', ac.telefono], ['correo_acudiente', ac.correo],
        ['documento_autorizacion', autorizacion]].filter(([, v]) => !v).map(([k]) => k);
      if (faltan.length) throw fail(400, 'El actor es menor de 18 años: se requieren los datos del acudiente y su autorización', { campos_faltantes: faltan });
      if (ac.documento === doc) throw fail(400, 'El documento del acudiente no puede ser el del menor');
      if (!TELEFONO.test(ac.telefono)) throw fail(400, 'El teléfono del acudiente no es válido.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ac.correo)) throw fail(400, 'El correo del acudiente no es válido.');
    }

    const dup = await one('SELECT correo FROM actores WHERE correo=$1 OR numero_documento=$2 LIMIT 1', [correo, doc]);
    if (dup) throw fail(409, dup.correo === correo ? 'Ya existe una inscripción con ese correo' : 'Ya existe una inscripción con ese número de documento');

    const hash = await seg.hashPassword(b.contrasena);
    const id = randomUUID();
    const claves = [];
    try {
      let fotoDatos = null, claveAut = null;
      if (foto) { fotoDatos = await archivos.guardarImagen(id, 'foto_perfil', foto); claves.push(...fotoDatos.claves); datos.foto_perfil_url = fotoDatos.claves[0]; }
      if (autorizacion) { claveAut = await archivos.guardarDocumento('autorizaciones', id, autorizacion); claves.push(claveAut); }
      const fotosBook = [];
      for (const ft of book.slice(0, 10)) { const g = await archivos.guardarImagen(id, 'foto_book', ft); claves.push(...g.claves); fotosBook.push(g.fila); }

      const numero = await tx(async (c) => {
        await c.query(
          `INSERT INTO actores(actor_id,correo,contrasena_hash,nombre_completo,tipo_documento,numero_documento,fecha_nacimiento,municipio,ciudad,telefono,acepta_terminos)
           VALUES($1,$2,$3,$4,$5::tipo_documento_enum,$6,$7,$8,$9,$10,true)`, [id, correo, hash, nombre, tipoDoc, doc, nac, municipio, ciudad, telefono]);
        const pr = await c.query(
          `INSERT INTO perfiles_actores(actor_id,nombre_artistico,tiene_experiencia,biografia,foto_perfil_url,estatura_cm,color_ojos,color_cabello,tono_piel,contextura,genero,
              edad_aparente_min,edad_aparente_max,dialecto,provincia,estado,autoriza_vitrina_publica,nivel_experiencia,ocupacion)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'PENDIENTE',$16,$17,$18) RETURNING numero_solicitud`,
          [id, datos.nombre_artistico, datos.tiene_experiencia, datos.biografia, datos.foto_perfil_url, datos.estatura_cm, datos.color_ojos, datos.color_cabello, datos.tono_piel,
            datos.contextura, datos.genero, datos.edad_aparente_min, datos.edad_aparente_max, datos.dialecto, datos.provincia, bool(b.autoriza_vitrina_publica), nivel, ocupacion]);
        await c.query(`INSERT INTO perfiles_versiones(actor_id,numero_version,datos,estado) VALUES($1,1,$2::jsonb,'PENDIENTE')`, [id, JSON.stringify(datos)]);
        if (fotoDatos) await insertarMultimedia(c, id, null, 'FOTO_PERFIL', { ...fotoDatos.fila });
        for (const fila of fotosBook) await insertarMultimedia(c, id, null, 'FOTO_BOOK', fila);
        if (reel) await insertarMultimedia(c, id, null, 'REEL_PRESENTACION', { ...reel, titulo: 'Reel de presentación' });
        if (portafolio) await insertarMultimedia(c, id, null, 'ENLACE_PORTAFOLIO', { ...portafolio, titulo: 'Portafolio' });
        await guardarHabilidades(c, id, habilidades);
        await guardarListas(c, id, { experiencias: b.experiencias, redes: b.redes, idiomas: b.idiomas, formacion: b.formacion });
        if (ac) {
          await c.query(
            `INSERT INTO acudientes_legales(actor_id,nombre_acudiente,documento_acudiente,telefono_acudiente,correo_acudiente,url_documento_autorizacion)
             VALUES($1,$2,$3,$4,$5,$6)`, [id, ac.nombre, ac.documento, ac.telefono, ac.correo, claveAut]);
        }
        await audit(c, 'CREAR', 'actores', id, { rol: 'actor', id }, esMenor ? 'Registro público de actor menor de edad' : 'Registro público de actor');
        return pr.rows[0].numero_solicitud;
      });
      require('./acceso').enviarVerificacion({ actor_id: id, correo, nombre }); // sin bloquear la respuesta
      res.json({
        ok: true, correo_verificacion_enviado: true, numero: `CIN-${new Date().getUTCFullYear()}-${String(numero || 0).padStart(4, '0')}`, es_menor_de_edad: esMenor,
        token: seg.firmarActor({ actor_id: id, correo }), rol: 'actor', nombre: datos.nombre_artistico || nombre,
        message: 'Inscripción recibida. Tu perfil quedó pendiente de revisión.',
      });
    } catch (e) {
      await archivos.eliminar(claves); // sin archivos huérfanos
      throw e;
    }
  }));

  // ------------------------------------------------------------------ sesión actual
  app.get('/api/yo', seg.auth(), wrap(async (req, res) => {
    if (req.u.rol === 'admin') {
      const a = await one('SELECT nombre, apellido, correo FROM administradores WHERE admin_id=$1', [req.u.id]);
      return res.json({ rol: 'admin', nombre: a ? a.nombre : 'Administrador', correo: a && a.correo, foto: null });
    }
    const a = await one(`SELECT a.nombre_completo, a.correo, (a.correo_verificado_en IS NOT NULL) AS correo_verificado, p.nombre_artistico, p.estado, ${P.FOTO_KEY} AS foto_key
                           FROM actores a LEFT JOIN perfiles_actores p USING(actor_id) WHERE a.actor_id=$1`, [req.u.id]);
    if (!a) throw fail(401, 'Tu sesión expiró. Inicia sesión de nuevo.');
    res.json({ rol: 'actor', nombre: a.nombre_artistico || a.nombre_completo, correo: a.correo, correo_verificado: a.correo_verificado, estado: a.estado,
      foto: a.foto_key ? await archivos.urlDe(P.miniaturaDe(a.foto_key)) : null });
  }));

  // ------------------------------------------------------------------ mi perfil
  app.get('/api/mi-perfil', seg.auth('actor'), wrap(async (req, res) => {
    const a = await miPerfil(req.u.id);
    if (!a) throw fail(404, 'Perfil no encontrado');
    res.json(a);
  }));

  app.put('/api/mi-perfil', seg.auth('actor'), camposPerfil, wrap(async (req, res) => {
    const id = req.u.id, b = req.body || {}, f = req.files || {};
    const nuevaFoto = f.foto && f.foto[0], book = f.fotos || [];
    const claves = [];          // archivos creados en esta petición (para limpiar si algo falla)
    const borrar = [];          // archivos que dejan de usarse (se borran al confirmar)
    try {
      const salida = await tx(async (c) => {
        await lock(c, id);
        const perfil = (await c.query('SELECT * FROM perfiles_actores WHERE actor_id=$1', [id])).rows[0];
        if (!perfil) throw fail(404, 'Perfil no encontrado');
        const pend = (await c.query(`SELECT * FROM perfiles_versiones WHERE actor_id=$1 AND estado='PENDIENTE'`, [id])).rows[0];
        const vig = (await c.query(`SELECT * FROM perfiles_versiones WHERE actor_id=$1 AND estado='APROBADA'`, [id])).rows[0];

        // --- foto de perfil (si llega, queda en el borrador hasta que se apruebe)
        let fotoKey = (pend && pend.datos.foto_perfil_url) || perfil.foto_perfil_url || null;
        if (nuevaFoto) {
          const g = await archivos.guardarImagen(id, 'foto_perfil', nuevaFoto);
          claves.push(...g.claves);
          const anterior = pend && pend.datos.foto_perfil_url;
          if (anterior && anterior !== perfil.foto_perfil_url && !P.esLocal(anterior)) borrar.push(anterior, archivos.claveMiniatura(anterior));
          fotoKey = g.claves[0];
        }
        const nuevaConExp = bool(b.tiene_experiencia) || json(b.experiencias).length > 0 || (b.experiencias === undefined && perfil.tiene_experiencia);
        const datos = datosPerfilDesde({ ...b, tiene_experiencia: nuevaConExp }, fotoKey);

        // --- versión (doble estado): el perfil público no cambia hasta que un administrador apruebe
        let envio = false;
        if (pend) {
          envio = cambios(pend.datos, datos).length > 0;
          await c.query('UPDATE perfiles_versiones SET datos=$2::jsonb WHERE version_id=$1', [pend.version_id, JSON.stringify(datos)]);
        } else if (!vig || cambios(vig.datos, datos).length > 0) {
          envio = true;
          const max = (await c.query('SELECT COALESCE(max(numero_version),0) m FROM perfiles_versiones WHERE actor_id=$1', [id])).rows[0].m;
          await c.query(`INSERT INTO perfiles_versiones(actor_id,numero_version,datos,estado) VALUES($1,$2,$3::jsonb,'PENDIENTE')`, [id, max + 1, JSON.stringify(datos)]);
        }
        // Si nunca hubo versión pública y estaba RECHAZADO, vuelve a la cola de revisión
        if (envio && !vig && perfil.estado !== 'PENDIENTE') {
          await c.query(`UPDATE perfiles_actores SET estado='PENDIENTE', motivo_rechazo=NULL, actualizado_en=now() WHERE actor_id=$1`, [id]);
        }
        if (envio) await audit(c, 'ACTUALIZAR', 'perfiles_actores', id, req.u, 'Envío de cambios de perfil a revisión', { reemplaza_borrador: !!pend });

        // --- datos que no pasan por moderación
        await c.query(
          `UPDATE actores SET telefono=COALESCE($2,telefono), municipio=COALESCE($3,municipio), ciudad=COALESCE($4,ciudad) WHERE actor_id=$1`,
          [id, telefonoOpt(b.telefono), texto(b.municipio, 100, 'El municipio', 2), texto(b.ciudad || b.municipio, 100, 'La ciudad', 2)]);
        await c.query(
          `UPDATE perfiles_actores SET nivel_experiencia=$2, ocupacion=$3, disponible=$4, disponibilidad_viajar=$5, talla_ropa=$6, talla_calzado=$7,
              agencia_nombre=$8, agencia_correo=$9, actualizado_en=now() WHERE actor_id=$1`,
          [id, texto(b.nivel, 20, 'El nivel'), texto(b.ocupacion, 120, 'La ocupación'), b.disponible === undefined ? perfil.disponible : bool(b.disponible),
            b.disponibilidad_viajar === undefined ? perfil.disponibilidad_viajar : bool(b.disponibilidad_viajar), texto(b.talla_ropa, 30, 'La talla de ropa'),
            texto(b.talla_calzado, 30, 'La talla de calzado'), texto(b.agencia_nombre, 150, 'La agencia'), texto(b.agencia_correo, 201, 'El correo de la agencia')]);
        if (b.habilidades !== undefined || b.areas !== undefined) await guardarHabilidades(c, id, habilidadesDesde(b));
        await guardarListas(c, id, b);

        // --- multimedia
        for (const mid of json(b.eliminar_multimedia)) {
          if (!esUuid(mid)) continue;
          const r = (await c.query(`DELETE FROM archivos_multimedia WHERE actor_id=$1 AND multimedia_id=$2 AND tipo_archivo <> 'FOTO_PERFIL' RETURNING tipo_archivo, almacenamiento, url_archivo, url_miniatura`, [id, mid])).rows[0];
          if (r) {
            if (r.almacenamiento === 'S3' && !/^\/uploads\//.test(r.url_archivo)) borrar.push(r.url_archivo, r.url_miniatura);
            await audit(c, 'ELIMINAR', 'archivos_multimedia', mid, req.u, `Baja de multimedia ${r.tipo_archivo}`, { tipo: r.tipo_archivo, actor_id: id });
          }
        }
        for (const ft of book) {
          const g = await archivos.guardarImagen(id, 'foto_book', ft);
          claves.push(...g.claves);
          await insertarMultimedia(c, id, req.u, 'FOTO_BOOK', g.fila);
        }
        for (const [campo, tipo, titulo] of [['reel_url', 'REEL_PRESENTACION', 'Reel de presentación'], ['portafolio_url', 'ENLACE_PORTAFOLIO', 'Portafolio']]) {
          if (b[campo] === undefined) continue;
          const url = nn(b[campo]);
          const previos = (await c.query(`SELECT multimedia_id, url_archivo FROM archivos_multimedia WHERE actor_id=$1 AND tipo_archivo=$2::tipo_multimedia_enum AND almacenamiento='EXTERNO' ORDER BY subido_en`, [id, tipo])).rows;
          const nuevo = url ? enlaceDe(url) : null;
          if (!nuevo || !previos.some((p) => p.url_archivo === nuevo.url_archivo)) {
            if (previos[0]) { // el formulario maneja un solo enlace por tipo: reemplaza el primero
              await c.query('DELETE FROM archivos_multimedia WHERE multimedia_id=$1', [previos[0].multimedia_id]);
              await audit(c, 'ELIMINAR', 'archivos_multimedia', previos[0].multimedia_id, req.u, `Baja de multimedia ${tipo}`, { tipo, actor_id: id });
            }
            if (nuevo) await insertarMultimedia(c, id, req.u, tipo, { ...nuevo, titulo });
          }
        }
        if (!envio) await audit(c, 'ACTUALIZAR', 'perfiles_actores', id, req.u, 'Actualización de datos complementarios del perfil');
        return { enRevision: envio || !!pend };
      });
      await archivos.eliminar(borrar);
      res.json({
        ok: true, en_revision: salida.enRevision,
        message: salida.enRevision ? 'Cambios guardados. Lo que aparece en tu perfil público se actualizará cuando un administrador los apruebe.' : 'Cambios guardados.',
      });
    } catch (e) {
      await archivos.eliminar(claves);
      throw e;
    }
  }));

  // Consentimiento de vitrina: inmediato (no pasa por moderación)
  app.put('/api/mi-perfil/vitrina', seg.auth('actor'), wrap(async (req, res) => {
    const autoriza = bool(req.body && req.body.autoriza_vitrina_publica);
    await tx(async (c) => {
      const r = await c.query('UPDATE perfiles_actores SET autoriza_vitrina_publica=$2, actualizado_en=now() WHERE actor_id=$1', [req.u.id, autoriza]);
      if (r.rowCount !== 1) throw fail(404, 'Perfil no encontrado');
      await audit(c, 'ACTUALIZAR', 'perfiles_actores', req.u.id, req.u, autoriza ? 'Autoriza vitrina pública' : 'Retira autorización de vitrina pública', { autoriza_vitrina_publica: autoriza });
    });
    res.json({ ok: true, autoriza_vitrina_publica: autoriza });
  }));

  // ------------------------------------------------------------------ panel
  app.get('/api/mi-panel', seg.auth('actor'), wrap(async (req, res) => {
    const id = req.u.id;
    const perfil = await P.conFoto(await one(`SELECT ${P.COLS_ADMIN}, p.motivo_rechazo FROM actores a JOIN perfiles_actores p USING(actor_id) WHERE a.actor_id=$1`, [id]));
    const pend = await one(`SELECT 1 FROM perfiles_versiones WHERE actor_id=$1 AND estado='PENDIENTE'`, [id]);
    if (perfil) perfil.tiene_cambios_pendientes = !!pend;
    const clases = await all(
      `SELECT c.curso_id, c.titulo, c.imagen_url, c.categoria, c.horas_totales AS duracion_horas, c.fecha_inicio_curso, c.modalidad, c.estado AS curso_estado,
              i.progreso, i.estado, i.inscrito_en,
              CASE WHEN i.estado='LISTA_ESPERA' THEN (SELECT count(*)::int FROM inscripciones_curso x WHERE x.curso_id=i.curso_id AND x.estado='LISTA_ESPERA' AND x.inscrito_en <= i.inscrito_en) END AS posicion_lista_espera
         FROM inscripciones_curso i JOIN cursos_y_talleres c USING(curso_id) WHERE i.actor_id=$1 AND i.estado <> 'CANCELADA' ORDER BY c.fecha_inicio_curso`, [id]);
    for (const c of clases) c.imagen_url = c.imagen_url ? await archivos.urlDe(c.imagen_url) : null;
    const postulaciones = await all(
      `SELECT p.estado, p.estado AS etapa, c.titulo FROM postulaciones_castings p JOIN convocatorias c USING(convocatoria_id) WHERE p.actor_id=$1 ORDER BY p.postulado_en DESC`, [id]);
    res.json({ perfil, clases, postulaciones });
  }));

  // ------------------------------------------------------------------ cursos
  const MENSAJE_CURSO = { EN_CURSO: 'El curso ya comenzó: las inscripciones están cerradas', FINALIZADO: 'El curso ya finalizó', CANCELADO: 'El curso fue cancelado' };
  const OCUPAN = "('INSCRITO','COMPLETADA','NO_COMPLETADA')";

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

  app.post('/api/cursos/:id/inscribir', seg.auth('actor'), wrap(async (req, res) => {
    const cursoId = req.params.id;
    if (!esUuid(cursoId)) throw fail(404, 'Curso no encontrado');
    const r = await tx(async (c) => {
      await lock(c, cursoId);
      const curso = (await c.query('SELECT * FROM cursos_y_talleres WHERE curso_id=$1', [cursoId])).rows[0];
      if (!curso || curso.estado === 'BORRADOR') throw fail(404, 'Curso no encontrado');
      if (curso.estado !== 'ABIERTO') throw fail(409, MENSAJE_CURSO[curso.estado] || 'El curso no está abierto');
      const ahora = new Date();
      if (ahora < new Date(curso.fecha_inicio_inscripcion)) throw fail(409, 'Las inscripciones aún no abren');
      if (ahora >= new Date(curso.fecha_inicio_curso)) throw fail(409, 'Las inscripciones ya cerraron');
      const a = (await c.query(`SELECT a.esta_activo, (NOT (${P.ES_ADULTO})) AS es_menor,
            EXISTS(SELECT 1 FROM acudientes_legales g WHERE g.actor_id=a.actor_id AND g.esta_verificado) AS acudiente_ok FROM actores a WHERE a.actor_id=$1`, [req.u.id])).rows[0];
      if (!a || !a.esta_activo) throw fail(403, 'Cuenta no habilitada');
      if (a.es_menor && curso.solo_mayores_de_edad) throw fail(403, 'Este curso es solo para mayores de 18 años');
      if (a.es_menor && !a.acudiente_ok) throw fail(403, 'Un menor de edad necesita su acudiente legal verificado para inscribirse');
      const previa = (await c.query('SELECT * FROM inscripciones_curso WHERE curso_id=$1 AND actor_id=$2', [cursoId, req.u.id])).rows[0];
      if (previa && previa.estado !== 'CANCELADA') throw fail(409, `Ya tienes una inscripción en este curso (${previa.estado})`);
      if (previa && previa.revisado_por_admin_id) throw fail(403, 'Tu inscripción fue cancelada por la organización; comunícate con el Centro');
      const ocupados = (await c.query(`SELECT count(*)::int n FROM inscripciones_curso WHERE curso_id=$1 AND estado IN ${OCUPAN}`, [cursoId])).rows[0].n;
      const estado = ocupados < curso.cupo_maximo ? 'INSCRITO' : 'LISTA_ESPERA';
      const insc = previa
        ? (await c.query(`UPDATE inscripciones_curso SET estado=$2::estado_inscripcion_enum, inscrito_en=now(), actualizado_en=now(), progreso=0 WHERE inscripcion_id=$1 RETURNING *`, [previa.inscripcion_id, estado])).rows[0]
        : (await c.query(`INSERT INTO inscripciones_curso(curso_id,actor_id,estado) VALUES($1,$2,$3::estado_inscripcion_enum) RETURNING *`, [cursoId, req.u.id, estado])).rows[0];
      await audit(c, 'CREAR', 'inscripciones_curso', insc.inscripcion_id, req.u, estado === 'INSCRITO' ? 'Inscripción a curso' : 'Ingreso a lista de espera', { curso_id: cursoId, estado, reactivada: !!previa });
      const pos = estado === 'LISTA_ESPERA'
        ? (await c.query(`SELECT count(*)::int n FROM inscripciones_curso WHERE curso_id=$1 AND estado='LISTA_ESPERA'
                           AND inscrito_en <= (SELECT inscrito_en FROM inscripciones_curso WHERE inscripcion_id=$2)`, [cursoId, insc.inscripcion_id])).rows[0].n : null;
      return { ok: true, inscripcion_id: insc.inscripcion_id, estado, posicion_lista_espera: pos,
        message: estado === 'INSCRITO' ? 'Inscripción confirmada' : 'El curso está lleno: quedaste en la lista de espera' };
    });
    res.json(r);
  }));

  app.delete('/api/cursos/:id/inscripcion', seg.auth('actor'), wrap(async (req, res) => {
    const cursoId = req.params.id;
    if (!esUuid(cursoId)) throw fail(404, 'Curso no encontrado');
    await tx(async (c) => {
      await lock(c, cursoId);
      const curso = (await c.query('SELECT * FROM cursos_y_talleres WHERE curso_id=$1', [cursoId])).rows[0];
      if (!curso || curso.estado === 'BORRADOR') throw fail(404, 'Curso no encontrado');
      if (['FINALIZADO', 'CANCELADO'].includes(curso.estado)) throw fail(409, MENSAJE_CURSO[curso.estado]);
      const insc = (await c.query('SELECT * FROM inscripciones_curso WHERE curso_id=$1 AND actor_id=$2', [cursoId, req.u.id])).rows[0];
      if (!insc || !['INSCRITO', 'LISTA_ESPERA'].includes(insc.estado)) throw fail(404, 'No tienes una inscripción activa en este curso');
      await c.query(`UPDATE inscripciones_curso SET estado='CANCELADA', actualizado_en=now(), revisado_por_admin_id=NULL WHERE inscripcion_id=$1`, [insc.inscripcion_id]);
      const promovidos = await promover(c, cursoId, curso.cupo_maximo);
      await audit(c, 'ACTUALIZAR', 'inscripciones_curso', insc.inscripcion_id, req.u, 'Cancelación de inscripción por el actor', { curso_id: cursoId, estado_anterior: insc.estado, promovidos });
    });
    res.json({ ok: true, message: 'Inscripción cancelada' });
  }));

  // ------------------------------------------------------------------ convocatorias
  app.post('/api/convocatorias/:id/aplicar', seg.auth('actor'), wrap(async (req, res) => {
    const convId = req.params.id;
    if (!esUuid(convId)) throw fail(404, 'Convocatoria no encontrada');
    const conv = await one('SELECT estado, fecha_cierre FROM convocatorias WHERE convocatoria_id=$1', [convId]);
    if (!conv) throw fail(404, 'Convocatoria no encontrada');
    const MSG = { PROXIMA: 'La convocatoria aún no abre', EN_PAUSA: 'La convocatoria está en pausa', CERRADA: 'La convocatoria está cerrada' };
    if (conv.estado !== 'ACTIVA') throw fail(409, MSG[conv.estado]);
    if (new Date(conv.fecha_cierre) <= new Date()) throw fail(409, 'La convocatoria ya venció');
    const a = await one(`SELECT a.esta_activo, p.estado, (NOT (${P.ES_ADULTO})) AS es_menor,
        EXISTS(SELECT 1 FROM acudientes_legales g WHERE g.actor_id=a.actor_id AND g.esta_verificado) AS acudiente_ok
        FROM actores a LEFT JOIN perfiles_actores p USING(actor_id) WHERE a.actor_id=$1`, [req.u.id]);
    if (!a || !a.esta_activo) throw fail(403, 'Cuenta no habilitada');
    if (a.estado !== 'APROBADO') throw fail(403, 'Tu perfil debe estar aprobado para postularte');
    if (a.es_menor && !a.acudiente_ok) throw fail(403, 'Un menor de edad necesita su acudiente legal verificado para postularse');
    const r = await evaluar(null, req.u.id, convId);
    if (!r.cumple) throw fail(422, 'No cumples los requisitos obligatorios de esta convocatoria', { incumplimientos: r.incumplimientos });
    try {
      const p = await tx(async (c) => {
        const ins = (await c.query(
          `INSERT INTO postulaciones_castings(convocatoria_id,actor_id,estado,compatibilidad,detalle_compatibilidad) VALUES($1,$2,'POSTULADO',$3,$4::jsonb) RETURNING *`,
          [convId, req.u.id, r.compatibilidad, JSON.stringify(r.detalle)])).rows[0];
        await audit(c, 'CREAR', 'postulaciones_castings', ins.postulacion_id, req.u, 'Postulación a convocatoria', { convocatoria_id: convId, compatibilidad: r.compatibilidad });
        return ins;
      });
      res.json({ ok: true, postulacion_id: p.postulacion_id, estado: p.estado, compatibilidad: p.compatibilidad, opcionales_no_cumplidos: r.opcionales_no_cumplidos });
    } catch (e) {
      if (e.code === '23505') throw fail(409, 'Ya te postulaste a esta convocatoria');
      throw e;
    }
  }));

  app.get('/api/mis-aplicaciones', seg.auth('actor'), wrap(async (req, res) => {
    const filas = await all(
      `SELECT p.postulacion_id, p.estado, p.estado AS etapa, p.compatibilidad, p.postulado_en, c.convocatoria_id, c.titulo, c.tipo_oportunidad, c.perfiles_requeridos,
              c.ubicacion, c.fecha_cierre, c.modalidad, c.entidad, c.descripcion, c.requisitos, c.imagen_url, c.estado AS convocatoria_estado
         FROM postulaciones_castings p JOIN convocatorias c USING(convocatoria_id) WHERE p.actor_id=$1 ORDER BY p.postulado_en DESC LIMIT 200`, [req.u.id]);
    for (const f of filas) f.imagen_url = f.imagen_url ? await archivos.urlDe(f.imagen_url) : null;
    res.json(filas);
  }));

  app.delete('/api/postulaciones/:id', seg.auth('actor'), wrap(async (req, res) => {
    const pid = req.params.id;
    if (!esUuid(pid)) throw fail(404, 'Postulación no encontrada');
    await tx(async (c) => {
      const p = (await c.query('SELECT * FROM postulaciones_castings WHERE postulacion_id=$1 AND actor_id=$2', [pid, req.u.id])).rows[0];
      if (!p) throw fail(404, 'Postulación no encontrada');
      if (!['POSTULADO', 'EN_REVISION'].includes(p.estado)) throw fail(409, 'Ya no puedes retirar esta postulación porque avanzó en el proceso');
      const r = await c.query(`DELETE FROM postulaciones_castings WHERE postulacion_id=$1 AND actor_id=$2 AND estado IN ('POSTULADO','EN_REVISION')`, [pid, req.u.id]);
      if (r.rowCount !== 1) throw fail(409, 'La postulación cambió de estado; recarga e intenta de nuevo');
      await audit(c, 'ELIMINAR', 'postulaciones_castings', pid, req.u, 'Retiro de postulación por el actor', { convocatoria_id: p.convocatoria_id, estado: p.estado });
    });
    res.json({ ok: true, message: 'Postulación retirada' });
  }));
}

module.exports = { registrar, miPerfil, datosPerfilDesde, CAMPOS, cambios };
