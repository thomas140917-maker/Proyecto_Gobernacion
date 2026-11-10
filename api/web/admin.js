// Rutas del administrador: aprobación de perfiles (versiones), cambios, reportes, acudientes, resumen e historial.
// Reglas espejo de api/src/admin (AdminPerfilesService, AdminAcudientesService).
const { all, one, tx, lock } = require('./db');
const { fail, wrap, nn, bool, esUuid, audit } = require('./util');
const P = require('./perfil');
const archivos = require('./archivos');
const seg = require('./seguridad');
const { CAMPOS, cambios } = require('./actor');

const A = seg.auth('admin');
const norm = (v) => (v === undefined || v === '' ? null : v);

/** Texto legible para los códigos de acción que guarda el backend. */
const ETIQUETAS = {
  APROBAR_PERFIL: 'Aprobó un perfil', RECHAZAR_PERFIL: 'Rechazó un perfil', VERIFICAR_ACUDIENTE: 'Verificó a un acudiente',
  VER_DOCUMENTO_AUTORIZACION: 'Consultó la autorización de un acudiente',
  CREAR_CONVOCATORIA: 'Creó una convocatoria', ACTUALIZAR_CONVOCATORIA: 'Editó una convocatoria', CAMBIAR_ESTADO_CONVOCATORIA: 'Cambió el estado de una convocatoria',
  CREAR_CURSO: 'Creó un curso', ACTUALIZAR_CURSO: 'Editó un curso', ELIMINAR_CURSO: 'Eliminó un curso', CAMBIAR_ESTADO_CURSO: 'Cambió el estado de un curso',
  CAMBIAR_ESTADO_POSTULACION: 'Movió una postulación', CAMBIAR_ESTADO_INSCRIPCION: 'Cambió el estado de una inscripción',
  EMITIR_CERTIFICADO: 'Emitió un certificado', REVOCAR_CERTIFICADO: 'Revocó un certificado',
};
const HIST_SELECT = `h.log_id, h.tipo_accion, h.entidad_afectada, h.entidad_id, h.observacion_accion, h.creado_en,
  COALESCE(ad.nombre, NULLIF(pa.nombre_artistico,''), ac.nombre_completo,
           CASE WHEN h.observacion_accion ~ '^(Transición|Promoción) automática' THEN 'Sistema' ELSE 'Visitante' END) AS quien,
  CASE WHEN h.realizado_por_admin_id IS NOT NULL THEN 'Administrador'
       WHEN h.realizado_por_actor_id IS NOT NULL THEN 'Usuario'
       WHEN h.observacion_accion ~ '^(Transición|Promoción) automática' THEN 'Sistema' ELSE 'Usuario' END AS rol,
  COALESCE((SELECT COALESCE(NULLIF(p2.nombre_artistico,''), a2.nombre_completo) FROM actores a2 LEFT JOIN perfiles_actores p2 USING(actor_id)
              WHERE h.entidad_afectada IN ('perfiles_actores','actores') AND a2.actor_id = h.entidad_id),
           (SELECT titulo FROM cursos_y_talleres WHERE h.entidad_afectada='cursos_y_talleres' AND curso_id = h.entidad_id),
           (SELECT titulo FROM convocatorias WHERE h.entidad_afectada='convocatorias' AND convocatoria_id = h.entidad_id),
           (SELECT titulo FROM noticias WHERE h.entidad_afectada='noticias' AND noticia_id = h.entidad_id)) AS sujeto`;
const HIST_FROM = `FROM historial_auditoria h
  LEFT JOIN administradores ad ON ad.admin_id=h.realizado_por_admin_id
  LEFT JOIN actores ac ON ac.actor_id=h.realizado_por_actor_id
  LEFT JOIN perfiles_actores pa ON pa.actor_id=h.realizado_por_actor_id`;
const humanizar = (m) => {
  m.observacion_accion = ETIQUETAS[m.observacion_accion] || m.observacion_accion;
  if (m.sujeto) m.observacion_accion += ` — ${m.sujeto}`;
  return m;
};

// ------------------------------------------------------------------ resolución de versiones (aprobar / rechazar)
async function cargarPendiente(c, actorId, versionId) {
  const actor = (await c.query('SELECT actor_id FROM actores WHERE actor_id=$1', [actorId])).rows[0];
  if (!actor) throw fail(404, 'Actor no encontrado');
  const ac = (await c.query('SELECT esta_verificado FROM acudientes_legales WHERE actor_id=$1', [actorId])).rows;
  const pend = (await c.query(`SELECT * FROM perfiles_versiones WHERE actor_id=$1 AND estado='PENDIENTE'`, [actorId])).rows[0];
  if (!pend) throw fail(409, 'El actor no tiene una versión pendiente de revisión');
  if (versionId && versionId !== pend.version_id) throw fail(409, 'La versión pendiente cambió desde que la revisaste; vuelve a cargar el diff');
  return { pend, acudientes: ac };
}

async function aprobarVersion(c, actorId, adminId, versionId) {
  await lock(c, actorId);
  const { pend, acudientes } = await cargarPendiente(c, actorId, versionId);
  if (acudientes.length && !acudientes.some((a) => a.esta_verificado)) throw fail(409, 'El actor es menor de edad: primero debe verificarse a su acudiente legal');
  const antes = (await c.query('SELECT foto_perfil_url FROM perfiles_actores WHERE actor_id=$1', [actorId])).rows[0];
  const vig = (await c.query(`SELECT * FROM perfiles_versiones WHERE actor_id=$1 AND estado='APROBADA'`, [actorId])).rows[0];
  // Orden por el índice único parcial (una sola APROBADA por actor)
  if (vig) await c.query(`UPDATE perfiles_versiones SET estado='HISTORICA' WHERE version_id=$1`, [vig.version_id]);
  const r = await c.query(
    `UPDATE perfiles_versiones SET estado='APROBADA', revisado_en=now(), revisado_por_admin_id=$2, motivo_rechazo=NULL WHERE version_id=$1 AND estado='PENDIENTE'`, [pend.version_id, adminId]);
  if (r.rowCount !== 1) throw fail(409, 'La versión ya fue resuelta por otro administrador');
  const d = pend.datos;
  await c.query(
    `UPDATE perfiles_actores SET nombre_artistico=$2, tiene_experiencia=$3, biografia=$4, foto_perfil_url=$5, estatura_cm=$6, color_ojos=$7, color_cabello=$8,
        tono_piel=$9, contextura=$10, genero=$11, edad_aparente_min=$12, edad_aparente_max=$13, dialecto=$14, provincia=$15,
        estado='APROBADO', motivo_rechazo=NULL, revisado_en=now(), revisado_por_admin_id=$16, actualizado_en=now() WHERE actor_id=$1`,
    [actorId, norm(d.nombre_artistico), !!d.tiene_experiencia, norm(d.biografia), norm(d.foto_perfil_url), norm(d.estatura_cm), norm(d.color_ojos), norm(d.color_cabello),
      norm(d.tono_piel), norm(d.contextura), norm(d.genero), norm(d.edad_aparente_min), norm(d.edad_aparente_max), norm(d.dialecto), norm(d.provincia), adminId]);

  // La foto aprobada pasa a ser la FOTO_PERFIL de la multimedia (la usa la vitrina del backend)
  const borrar = [];
  const nueva = norm(d.foto_perfil_url);
  if (nueva && nueva !== (antes && antes.foto_perfil_url)) {
    const previas = (await c.query(`DELETE FROM archivos_multimedia WHERE actor_id=$1 AND tipo_archivo='FOTO_PERFIL' RETURNING almacenamiento, url_archivo, url_miniatura`, [actorId])).rows;
    for (const p of previas) if (p.almacenamiento === 'S3' && p.url_archivo !== nueva && !P.esLocal(p.url_archivo)) borrar.push(p.url_archivo, p.url_miniatura);
    const miniatura = P.esLocal(nueva) ? null : archivos.claveMiniatura(nueva);
    await c.query(
      `INSERT INTO archivos_multimedia(actor_id,tipo_archivo,almacenamiento,url_archivo,url_miniatura,mime_type) VALUES($1,'FOTO_PERFIL','S3',$2,$3,$4)`,
      [actorId, nueva, miniatura, miniatura ? 'image/webp' : null]);
    if (antes && antes.foto_perfil_url && antes.foto_perfil_url !== nueva && !P.esLocal(antes.foto_perfil_url)) borrar.push(antes.foto_perfil_url, archivos.claveMiniatura(antes.foto_perfil_url));
  }
  const mod = cambios(vig && vig.datos, d);
  await audit(c, 'ACCION_ADMINISTRADOR', 'perfiles_actores', actorId, { rol: 'admin', id: adminId }, 'APROBAR_PERFIL',
    { accion: 'APROBAR', version_id: pend.version_id, numero_version: pend.numero_version, version_anterior_historica: vig ? vig.version_id : null, campos_modificados: mod });
  return { borrar, numero_version: pend.numero_version, version_id: pend.version_id };
}

async function rechazarVersion(c, actorId, adminId, motivo, versionId) {
  await lock(c, actorId);
  motivo = String(motivo || '').trim();
  if (motivo.length < 20) throw fail(400, 'La justificación debe tener al menos 20 caracteres');
  if (motivo.length > 1000) throw fail(400, 'La justificación no puede superar 1000 caracteres');
  const { pend } = await cargarPendiente(c, actorId, versionId);
  const r = await c.query(
    `UPDATE perfiles_versiones SET estado='RECHAZADA', motivo_rechazo=$2, revisado_en=now(), revisado_por_admin_id=$3 WHERE version_id=$1 AND estado='PENDIENTE'`, [pend.version_id, motivo, adminId]);
  if (r.rowCount !== 1) throw fail(409, 'La versión ya fue resuelta por otro administrador');
  const vig = (await c.query(`SELECT 1 FROM perfiles_versiones WHERE actor_id=$1 AND estado='APROBADA'`, [actorId])).rows[0];
  if (!vig) {
    await c.query(`UPDATE perfiles_actores SET estado='RECHAZADO', motivo_rechazo=$2, revisado_en=now(), revisado_por_admin_id=$3, actualizado_en=now() WHERE actor_id=$1`, [actorId, motivo, adminId]);
  }
  // Foto propuesta que no se usará: se elimina del almacenamiento
  const borrar = [];
  const actual = (await c.query('SELECT foto_perfil_url FROM perfiles_actores WHERE actor_id=$1', [actorId])).rows[0];
  const foto = pend.datos && pend.datos.foto_perfil_url;
  if (foto && foto !== (actual && actual.foto_perfil_url) && !P.esLocal(foto)) borrar.push(foto, archivos.claveMiniatura(foto));
  await audit(c, 'ACCION_ADMINISTRADOR', 'perfiles_actores', actorId, { rol: 'admin', id: adminId }, 'RECHAZAR_PERFIL',
    { accion: 'RECHAZAR', version_id: pend.version_id, numero_version: pend.numero_version, motivo, perfil_publico_vigente: !!vig });
  return { borrar, estado_perfil: vig ? 'APROBADO' : 'RECHAZADO' };
}

function registrar(app) {
  // ------------------------------------------------------------------ resumen
  app.get('/api/admin/resumen', A, wrap(async (_q, res) => {
    const n = async (s) => +(await one(s)).n;
    res.json({
      pendientes: await n(`SELECT count(*) n FROM perfiles_actores p WHERE p.estado='PENDIENTE'`),
      cambios: await n(`SELECT count(*) n FROM perfiles_versiones v WHERE v.estado='PENDIENTE' AND EXISTS (SELECT 1 FROM perfiles_versiones x WHERE x.actor_id=v.actor_id AND x.estado='APROBADA')`),
      reportes: await n(`SELECT count(*) n FROM reportes_perfil WHERE estado='PENDIENTE'`),
      cursos_espera: await n(`SELECT count(*) n FROM cursos_y_talleres WHERE estado='BORRADOR'`),
      convocatorias: await n(`SELECT count(*) n FROM convocatorias WHERE estado IN ('ACTIVA','PROXIMA')`),
      acudientes: await n(`SELECT count(*) n FROM acudientes_legales WHERE NOT esta_verificado`),
      actividad: (await all(`SELECT ${HIST_SELECT} ${HIST_FROM} ORDER BY h.creado_en DESC LIMIT 5`)).map(humanizar),
    });
  }));

  // ------------------------------------------------------------------ aprobación de perfiles
  app.get('/api/admin/solicitudes', A, wrap(async (req, res) => {
    const estado = ['PENDIENTE', 'APROBADO', 'RECHAZADO'].includes(req.query.estado) ? req.query.estado : 'PENDIENTE';
    const conteo = await all('SELECT estado, count(*)::int n FROM perfiles_actores GROUP BY estado');
    const perfiles = await P.conFotos(await all(
      `SELECT ${P.COLS_ADMIN}, p.motivo_rechazo, p.revisado_en,
          (SELECT g.esta_verificado FROM acudientes_legales g WHERE g.actor_id=a.actor_id ORDER BY g.esta_verificado DESC LIMIT 1) AS acudiente_verificado,
          (SELECT v.creado_en FROM perfiles_versiones v WHERE v.actor_id=a.actor_id AND v.estado='PENDIENTE') AS enviado_en
         ${P.FROM} WHERE p.estado=$1 ORDER BY a.creado_en DESC`, [estado]));
    res.json({ conteo: Object.fromEntries(conteo.map((r) => [r.estado, r.n])), perfiles });
  }));

  app.get('/api/admin/perfiles/:id', A, wrap(async (req, res) => {
    if (!esUuid(req.params.id)) throw fail(404, 'Perfil no encontrado');
    const a = await P.perfilCompleto(req.params.id, 'privada');
    if (!a) throw fail(404, 'Perfil no encontrado');
    const [pend, vig] = await Promise.all([
      one(`SELECT version_id, numero_version, datos, creado_en FROM perfiles_versiones WHERE actor_id=$1 AND estado='PENDIENTE'`, [req.params.id]),
      one(`SELECT numero_version, datos FROM perfiles_versiones WHERE actor_id=$1 AND estado='APROBADA'`, [req.params.id]),
    ]);
    a.version_pendiente = null;
    if (pend) {
      const campos = CAMPOS.map((campo) => ({ campo, publicado: norm(vig && vig.datos[campo]), borrador: norm(pend.datos[campo]) }))
        .map((c) => ({ ...c, cambiado: c.publicado !== c.borrador }));
      const foto = campos.find((c) => c.campo === 'foto_perfil_url');
      a.version_pendiente = {
        version_id: pend.version_id, numero_version: pend.numero_version, enviado_en: pend.creado_en, es_primera_version: !vig,
        total_cambios: campos.filter((c) => c.cambiado).length,
        campos: campos.filter((c) => c.campo !== 'foto_perfil_url'),
        foto_nueva: foto && foto.cambiado && foto.borrador ? await archivos.urlDe(foto.borrador) : null,
        foto_actual: foto && foto.publicado ? await archivos.urlDe(foto.publicado) : null,
      };
    }
    res.json(a);
  }));

  // Aprobar / rechazar la versión pendiente (primer registro o cambios posteriores)
  app.put('/api/admin/solicitudes/:id', A, wrap(async (req, res) => {
    const { estado, motivo, version_id } = req.body || {};
    const id = req.params.id;
    if (!esUuid(id)) throw fail(404, 'Actor no encontrado');
    if (!['APROBADO', 'RECHAZADO'].includes(estado)) throw fail(400, 'Estado inválido: usa APROBADO o RECHAZADO');
    const r = await tx((c) => (estado === 'APROBADO' ? aprobarVersion(c, id, req.u.id, version_id) : rechazarVersion(c, id, req.u.id, motivo, version_id)));
    await archivos.eliminar(r.borrar);
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------------ cambios, reportes y restricciones
  app.get('/api/admin/cambios', A, wrap(async (_q, res) => {
    const vers = await all(
      `SELECT ${P.COLS_ADMIN}, v.version_id, v.numero_version, v.datos AS borrador, v.creado_en AS enviado_en, vg.datos AS publicado
         FROM perfiles_versiones v JOIN actores a ON a.actor_id=v.actor_id JOIN perfiles_actores p ON p.actor_id=a.actor_id
         JOIN perfiles_versiones vg ON vg.actor_id=a.actor_id AND vg.estado='APROBADA'
        WHERE v.estado='PENDIENTE' ORDER BY v.creado_en DESC`);
    const lista = [];
    for (const v of vers) {
      const campos = CAMPOS.filter((c) => c !== 'foto_perfil_url').map((campo) => ({ campo, publicado: norm(v.publicado[campo]), borrador: norm(v.borrador[campo]) }))
        .filter((c) => c.publicado !== c.borrador);
      const fotoCambio = norm(v.borrador.foto_perfil_url) !== norm(v.publicado.foto_perfil_url);
      const base = await P.conFoto({ ...v, foto_key: v.foto_key });
      lista.push({
        actor_id: v.actor_id, nombre: v.nombre, nombre_completo: v.nombre_completo, ciudad: v.ciudad, municipio: v.municipio, numero_version: v.numero_version,
        version_id: v.version_id, enviado_en: v.enviado_en, foto: base.foto, campos,
        foto_nueva: fotoCambio && v.borrador.foto_perfil_url ? await archivos.urlDe(v.borrador.foto_perfil_url) : null,
        foto_actual: v.publicado.foto_perfil_url ? await archivos.urlDe(v.publicado.foto_perfil_url) : null,
      });
    }
    res.json({
      cambios: lista,
      reportes: await P.conFotos(await all(`SELECT r.reporte_id, r.motivo, r.creado_en AS reportado_en, ${P.COLS_ADMIN} FROM reportes_perfil r
                         JOIN actores a ON a.actor_id=r.actor_id JOIN perfiles_actores p ON p.actor_id=a.actor_id WHERE r.estado='PENDIENTE' ORDER BY r.creado_en DESC`)),
      restringidos: await P.conFotos(await all(`SELECT ${P.COLS_ADMIN}, p.motivo_restriccion ${P.FROM} WHERE p.restringido ORDER BY nombre`)),
    });
  }));

  app.put('/api/admin/cambios/:id', A, wrap(async (req, res) => {
    const id = req.params.id, { accion, motivo, version_id } = req.body || {};
    if (!esUuid(id)) throw fail(404, 'Actor no encontrado');
    if (!['aprobar', 'rechazar'].includes(accion)) throw fail(400, 'Acción inválida');
    const r = await tx((c) => (accion === 'aprobar' ? aprobarVersion(c, id, req.u.id, version_id) : rechazarVersion(c, id, req.u.id, motivo, version_id)));
    await archivos.eliminar(r.borrar);
    res.json({ ok: true });
  }));

  app.put('/api/admin/reportes/:rid', A, wrap(async (req, res) => {
    if (!esUuid(req.params.rid)) throw fail(404, 'Reporte no encontrado');
    const aplicar = (req.body && req.body.accion) === 'aplicar';
    await tx(async (c) => {
      const r = (await c.query('SELECT actor_id, motivo, estado FROM reportes_perfil WHERE reporte_id=$1', [req.params.rid])).rows[0];
      if (!r) throw fail(404, 'Reporte no encontrado');
      if (r.estado !== 'PENDIENTE') throw fail(409, 'Este reporte ya fue resuelto');
      await c.query('UPDATE reportes_perfil SET estado=$2 WHERE reporte_id=$1', [req.params.rid, aplicar ? 'APLICADA' : 'DENEGADA']);
      if (aplicar) await c.query('UPDATE perfiles_actores SET restringido=true, motivo_restriccion=$2, actualizado_en=now() WHERE actor_id=$1', [r.actor_id, r.motivo]);
      await audit(c, 'ACCION_ADMINISTRADOR', 'perfiles_actores', r.actor_id, req.u, aplicar ? 'Aplicó restricción: ' + r.motivo : 'Denegó un reporte de perfil', { reporte_id: req.params.rid });
    });
    res.json({ ok: true });
  }));

  app.put('/api/admin/restriccion/:id', A, wrap(async (req, res) => {
    if (!esUuid(req.params.id)) throw fail(404, 'Perfil no encontrado');
    const on = bool(req.body && req.body.restringido);
    const motivo = nn(req.body && req.body.motivo);
    if (on && !motivo) throw fail(400, 'Indica el motivo de la restricción');
    await tx(async (c) => {
      const r = await c.query('UPDATE perfiles_actores SET restringido=$2, motivo_restriccion=$3, actualizado_en=now() WHERE actor_id=$1', [req.params.id, on, on ? String(motivo).slice(0, 1000) : null]);
      if (r.rowCount !== 1) throw fail(404, 'Perfil no encontrado');
      await audit(c, 'ACCION_ADMINISTRADOR', 'perfiles_actores', req.params.id, req.u, on ? 'Aplicó restricción: ' + motivo : 'Quitó la restricción del perfil');
    });
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------------ acudientes
  app.put('/api/admin/acudientes/:actorId/verificar', A, wrap(async (req, res) => {
    if (!esUuid(req.params.actorId)) throw fail(404, 'Acudiente no encontrado');
    await tx(async (c) => {
      const g = (await c.query('SELECT acudiente_id, esta_verificado FROM acudientes_legales WHERE actor_id=$1 ORDER BY esta_verificado ASC LIMIT 1', [req.params.actorId])).rows[0];
      if (!g) throw fail(404, 'Acudiente no encontrado');
      const r = await c.query('UPDATE acudientes_legales SET esta_verificado=true, verificado_por_admin_id=$2 WHERE acudiente_id=$1 AND esta_verificado=false', [g.acudiente_id, req.u.id]);
      if (r.rowCount !== 1) throw fail(409, 'El acudiente ya estaba verificado');
      await audit(c, 'ACCION_ADMINISTRADOR', 'acudientes_legales', g.acudiente_id, req.u, 'VERIFICAR_ACUDIENTE', { accion: 'VERIFICAR_ACUDIENTE', actor_id: req.params.actorId });
    });
    res.json({ ok: true });
  }));

  // El documento de autorización es un dato sensible: solo lo ve un administrador y queda registrado quién lo consultó
  app.get('/api/admin/acudientes/:actorId/documento', A, wrap(async (req, res) => {
    if (!esUuid(req.params.actorId)) throw fail(404, 'Documento no disponible');
    const g = await one('SELECT acudiente_id, url_documento_autorizacion AS clave FROM acudientes_legales WHERE actor_id=$1 ORDER BY esta_verificado DESC LIMIT 1', [req.params.actorId]);
    if (!g || !g.clave) throw fail(404, 'Documento no disponible');
    const buf = await archivos.leer(g.clave);
    if (!buf) throw fail(404, 'El documento no está disponible en el almacenamiento');
    await audit(null, 'ACCION_ADMINISTRADOR', 'acudientes_legales', g.acudiente_id, req.u, 'VER_DOCUMENTO_AUTORIZACION', { accion: 'VER_DOCUMENTO_AUTORIZACION', actor_id: req.params.actorId });
    const ext = (g.clave.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
    res.setHeader('Content-Type', { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png' }[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(buf);
  }));

  // ------------------------------------------------------------------ historial / auditoría
  app.get('/api/admin/historial', A, wrap(async (req, res) => {
    const hoy = new Date();
    const fecha = (s, d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : d);
    const hasta = fecha(req.query.hasta, hoy.toISOString().slice(0, 10));
    const desde = fecha(req.query.desde, new Date(hoy - 29 * 864e5).toISOString().slice(0, 10));
    const w = ['h.creado_en::date BETWEEN $1::date AND $2::date'], v = [desde, hasta];
    if (['CREAR', 'ACTUALIZAR', 'ELIMINAR', 'ACCION_ADMINISTRADOR'].includes(req.query.tipo)) { v.push(req.query.tipo); w.push(`h.tipo_accion = $${v.length}::tipo_accion_auditoria_enum`); }
    if (req.query.rol === 'admin') w.push('h.realizado_por_admin_id IS NOT NULL');
    if (req.query.rol === 'usuario') w.push('h.realizado_por_admin_id IS NULL');
    const where = w.join(' AND ');
    const stats = await one(`SELECT count(*)::int total,
        count(*) FILTER (WHERE h.realizado_por_admin_id IS NULL)::int usuarios,
        count(*) FILTER (WHERE h.realizado_por_admin_id IS NOT NULL)::int admin,
        count(*) FILTER (WHERE h.entidad_afectada IN ('cursos_y_talleres','convocatorias','noticias'))::int contenido
      FROM historial_auditoria h WHERE ${where}`, v);
    const porDia = await all(`SELECT to_char(d,'DD/MM') dia,
        count(h.log_id) FILTER (WHERE h.realizado_por_admin_id IS NULL)::int usuarios,
        count(h.log_id) FILTER (WHERE h.realizado_por_admin_id IS NOT NULL)::int admin
      FROM generate_series(GREATEST($1::date, $2::date - 92), $2::date, '1 day') d
      LEFT JOIN historial_auditoria h ON h.creado_en::date = d::date AND ${where}
      GROUP BY d ORDER BY d`, v);
    const movimientos = (await all(`SELECT ${HIST_SELECT} ${HIST_FROM} WHERE ${where} ORDER BY h.creado_en DESC LIMIT 150`, v)).map(humanizar);
    res.json({ desde, hasta, stats, porDia, movimientos });
  }));
}

module.exports = { registrar, aprobarVersion, rechazarVersion, humanizar };
