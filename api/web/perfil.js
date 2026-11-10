// Consultas de perfiles compartidas por las rutas públicas, del actor y del administrador.
const { all, one } = require('./db');
const archivos = require('./archivos');
const { analizarEnlaceVideo } = require('./videos');

const HOY_BOGOTA = "(now() AT TIME ZONE 'America/Bogota')::date";
/** Fecha de nacimiento máxima para ser adulto hoy (misma regla que fechaLimiteMayoriaEdad del backend). */
const ES_ADULTO = `a.fecha_nacimiento <= (${HOY_BOGOTA} - interval '18 years')::date`;
const EDAD = `date_part('year', age(${HOY_BOGOTA}, a.fecha_nacimiento))::int`;

/** Condición de la vitrina pública (igual que VitrinaService.baseWhere + restricción del administrador). */
const VITRINA = `p.estado = 'APROBADO' AND p.autoriza_vitrina_publica AND a.esta_activo AND NOT p.restringido AND ${ES_ADULTO}`;

const HAB_AREAS = `COALESCE((SELECT array_agg(h.nombre ORDER BY h.nombre) FROM actores_habilidades ah JOIN habilidades h USING(habilidad_id)
            WHERE ah.actor_id=a.actor_id AND h.tipo='AREA'), '{}')`;
const HAB_ESP = `COALESCE((SELECT array_agg(h.nombre ORDER BY h.nombre) FROM actores_habilidades ah JOIN habilidades h USING(habilidad_id)
            WHERE ah.actor_id=a.actor_id AND h.tipo<>'AREA'), '{}')`;
const FOTO_KEY = `COALESCE(NULLIF(p.foto_perfil_url,''), (SELECT m.url_archivo FROM archivos_multimedia m
            WHERE m.actor_id=a.actor_id AND m.tipo_archivo='FOTO_PERFIL' ORDER BY m.subido_en DESC LIMIT 1))`;

const FROM = 'FROM actores a JOIN perfiles_actores p USING(actor_id)';

/** Tarjeta PÚBLICA: nunca expone apellidos (si no hay nombre artístico, solo el primer nombre), edad real ni datos de contacto. */
const COLS_PUBLICAS = `a.actor_id,
  COALESCE(NULLIF(p.nombre_artistico,''), split_part(btrim(a.nombre_completo),' ',1)) AS nombre,
  a.municipio, a.ciudad, p.genero, p.estatura_cm, p.edad_aparente_min, p.edad_aparente_max,
  p.tono_piel, p.color_ojos, p.color_cabello, p.dialecto, p.provincia,
  p.ocupacion, p.nivel_experiencia AS nivel, p.disponible, p.disponibilidad_viajar,
  ${HAB_AREAS} AS areas, ${HAB_ESP} AS especialidades, ${FOTO_KEY} AS foto_key`;

/** Tarjeta de ADMINISTRACIÓN / propia: incluye nombre completo, edad real y estado. */
const COLS_ADMIN = `a.actor_id,
  COALESCE(NULLIF(p.nombre_artistico,''), a.nombre_completo) AS nombre, a.nombre_completo,
  a.ciudad, a.municipio, p.genero, p.estatura_cm, p.edad_aparente_min, p.edad_aparente_max,
  p.tono_piel, p.color_ojos, p.color_cabello, p.dialecto, p.provincia,
  p.ocupacion, p.nivel_experiencia AS nivel, p.disponible, p.disponibilidad_viajar, p.estado, p.restringido,
  p.autoriza_vitrina_publica, p.numero_solicitud, a.creado_en, ${EDAD} AS edad, (NOT (${ES_ADULTO})) AS es_menor,
  ${HAB_AREAS} AS areas, ${HAB_ESP} AS especialidades, ${FOTO_KEY} AS foto_key`;

const esLocal = (k) => !k || k.startsWith('/') || /^https?:\/\//i.test(k);
const miniaturaDe = (k) => (esLocal(k) ? k : archivos.claveMiniatura(k) || k);

/** Reemplaza foto_key por las URLs `foto` (miniatura) y `foto_grande`. */
async function conFoto(fila, claveEsPendiente) {
  if (!fila) return fila;
  const k = fila.foto_key;
  delete fila.foto_key;
  fila.foto = k ? await archivos.urlDe(miniaturaDe(k)) : null;
  fila.foto_grande = k ? await archivos.urlDe(k) : null;
  return fila;
}
const conFotos = (filas) => Promise.all(filas.map((f) => conFoto(f)));

/** `numero` visible: CIN-AAAA-0001 */
const numeroSolicitud = (creado, n) => `CIN-${new Date(creado).getUTCFullYear()}-${String(n || 0).padStart(4, '0')}`;

/** Multimedia de un actor presentada para el navegador (URLs firmadas / enlaces con url_embed). */
async function multimediaDe(actorId, { privado }) {
  const filas = await all(
    `SELECT multimedia_id, tipo_archivo, url_archivo, url_miniatura, almacenamiento, titulo, ancho, alto, tamano_bytes, proveedor_video, subido_en
       FROM archivos_multimedia WHERE actor_id=$1 ${privado ? '' : "AND tipo_archivo <> 'DOCUMENTO'"} ORDER BY subido_en`, [actorId]);
  const salida = { fotos: [], videos: [], enlaces: [], documentos: [] };
  for (const m of filas) {
    if (m.tipo_archivo === 'FOTO_PERFIL') continue; // va en la tarjeta (foto / foto_grande)
    const base = { multimedia_id: m.multimedia_id, titulo: m.titulo, tipo: m.tipo_archivo };
    if (m.almacenamiento === 'EXTERNO') {
      const e = analizarEnlaceVideo(m.url_archivo);
      const item = { ...base, url: m.url_archivo, proveedor: m.proveedor_video, url_embed: e ? e.url_embed : null };
      (m.tipo_archivo === 'REEL_PRESENTACION' ? salida.videos : salida.enlaces).push(item);
    } else if (m.tipo_archivo === 'FOTO_BOOK') {
      const k = m.url_miniatura || m.url_archivo;
      salida.fotos.push({ ...base, url: await archivos.urlDe(m.url_archivo), miniatura: await archivos.urlDe(k), ancho: m.ancho, alto: m.alto });
    } else if (m.tipo_archivo === 'DOCUMENTO') {
      salida.documentos.push({ ...base, url: await archivos.urlDe(m.url_archivo, true) });
    } else if (/^\/uploads\//.test(m.url_archivo) && /\.(mp4|webm|mov)$/i.test(m.url_archivo)) {
      // Videos subidos como archivo en la versión anterior del sitio: se siguen reproduciendo
      salida.videos.push({ ...base, url: m.url_archivo, archivo: true });
    }
  }
  return salida;
}

/** Datos extra no moderados (habilidades, idiomas, formación, trayectoria, redes). */
async function secundarios(actorId) {
  const [habilidades, idiomas, formacion, experiencias, redes] = await Promise.all([
    all(`SELECT h.habilidad_id, h.nombre, h.tipo, ah.nivel, ah.descripcion_otra FROM actores_habilidades ah JOIN habilidades h USING(habilidad_id)
          WHERE ah.actor_id=$1 ORDER BY h.tipo, h.nombre`, [actorId]),
    all('SELECT idioma, nivel FROM idiomas_actor WHERE actor_id=$1 ORDER BY idioma', [actorId]),
    all('SELECT periodo, titulo, institucion FROM formacion_actor WHERE actor_id=$1 ORDER BY periodo DESC NULLS LAST', [actorId]),
    all('SELECT nombre_proyecto, tipo_produccion, rol_desempenado, anio, director_o_productora FROM experiencias_actor WHERE actor_id=$1 ORDER BY anio DESC', [actorId]),
    all('SELECT plataforma, url_perfil FROM redes_sociales_actor WHERE actor_id=$1', [actorId]),
  ]);
  return { habilidades, idiomas, formacion, experiencias, redes };
}

const DETALLE_PUBLICO = `, p.biografia, p.tiene_experiencia, p.contextura, p.talla_ropa, p.talla_calzado`;
const DETALLE_PRIVADO = `${DETALLE_PUBLICO}, p.agencia_nombre, p.agencia_correo, p.motivo_rechazo, p.motivo_restriccion,
  a.correo, a.telefono, a.tipo_documento, a.numero_documento, to_char(a.fecha_nacimiento,'YYYY-MM-DD') AS fecha_nacimiento`;

/** Perfil completo. vista: 'publica' (vitrina) | 'privada' (el propio actor o un administrador). */
async function perfilCompleto(id, vista) {
  const privada = vista === 'privada';
  const a = await one(`SELECT ${privada ? COLS_ADMIN : COLS_PUBLICAS}${privada ? DETALLE_PRIVADO : DETALLE_PUBLICO} ${FROM} WHERE a.actor_id=$1`, [id]);
  if (!a) return null;
  await conFoto(a);
  const [sec, mm] = await Promise.all([secundarios(id), multimediaDe(id, { privado: privada })]);
  Object.assign(a, sec, { fotos: mm.fotos, videos: mm.videos, enlaces: mm.enlaces });
  // Tallas y agencia son datos de contacto profesional: solo en la vista privada
  if (!privada) { delete a.talla_ropa; delete a.talla_calzado; }
  if (privada) {
    a.documentos = mm.documentos;
    a.numero = numeroSolicitud(a.creado_en, a.numero_solicitud);
    a.acudiente = (await one(
      `SELECT acudiente_id, nombre_acudiente, documento_acudiente, telefono_acudiente, correo_acudiente,
              url_documento_autorizacion, esta_verificado FROM acudientes_legales WHERE actor_id=$1 ORDER BY esta_verificado DESC LIMIT 1`, [id])) || null;
    if (a.acudiente) { a.acudiente.tiene_documento = !!a.acudiente.url_documento_autorizacion; delete a.acudiente.url_documento_autorizacion; }
  }
  return a;
}

module.exports = {
  HOY_BOGOTA, ES_ADULTO, EDAD, VITRINA, FROM, COLS_PUBLICAS, COLS_ADMIN, FOTO_KEY,
  conFoto, conFotos, miniaturaDe, numeroSolicitud, multimediaDe, secundarios, perfilCompleto, esLocal,
};
