// Utilidades compartidas del módulo web.
const { pool } = require('./db');

/** Error HTTP controlado: fail(409, 'mensaje', { campo: ... }) */
const fail = (status, message, extra) => Object.assign(new Error(message), { status, extra });

/** Envuelve un handler async: convierte errores en JSON { error } con el código correcto. */
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    if (e && e.status) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
    if (e && e.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
    if (e && e.code === '23514') return res.status(400).json({ error: 'Alguno de los datos no es válido: ' + (e.detail || e.message) });
    if (e && e.code === '22P02') return res.status(400).json({ error: 'Identificador o dato con formato inválido.' });
    console.error('[web]', e);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  });

const nn = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : typeof v === 'string' ? v.trim() : v);
const bool = (v) => v === true || v === 'true' || v === '1' || v === 'on' || v === 1;
const entero = (v) => {
  const n = nn(v);
  if (n === null) return null;
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : null;
};
/** Parsea un campo JSON que llega como texto en multipart. */
const json = (v, def = []) => {
  if (v === undefined || v === null || v === '') return def;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return def; }
};
const esUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const uuidOr404 = (v, msg = 'No encontrado') => { if (!esUuid(v)) throw fail(404, msg); return v; };

/** Quita caracteres de control y recorta (igual que @Trim del backend). */
const limpiar = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim() : v);

/** HTML del editor de noticias: solo etiquetas básicas. */
function sanitize(html = '') {
  return String(html)
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (m, close, tag, attrs) => {
      tag = tag.toLowerCase();
      if (!['b', 'strong', 'i', 'em', 'u', 'p', 'br', 'ul', 'ol', 'li', 'a', 'div'].includes(tag)) return '';
      if (tag === 'a' && !close) {
        const href = (attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1] || '';
        return /^https?:\/\//i.test(href) ? `<a href="${href.replace(/"/g, '')}" target="_blank" rel="noopener">` : '<a>';
      }
      return `<${close}${tag}>`;
    });
}

/**
 * Auditoría (misma tabla y mismos códigos de observación que el backend).
 * tipo: CREAR | ACTUALIZAR | ELIMINAR | ACCION_ADMINISTRADOR
 * quien: { rol: 'admin'|'actor', id } | null
 */
function audit(db, tipo, entidad, entidadId, quien, obs, detalle) {
  return (db || pool).query(
    `INSERT INTO historial_auditoria(tipo_accion, entidad_afectada, entidad_id, realizado_por_admin_id, realizado_por_actor_id, observacion_accion, detalle)
     VALUES ($1::tipo_accion_auditoria_enum, $2, $3, $4, $5, $6, $7::jsonb)`,
    [tipo, entidad, entidadId, quien && quien.rol === 'admin' ? quien.id : null, quien && quien.rol === 'actor' ? quien.id : null,
      obs, detalle ? JSON.stringify(detalle) : null],
  );
}
const auditSafe = (...a) => audit(...a).catch((e) => console.error('[web] auditoría:', e.message));

const codigoSolicitud = (anio, n) => `CIN-${new Date(anio).getFullYear()}-${String(n || 0).padStart(4, '0')}`;

module.exports = { fail, wrap, nn, bool, entero, json, esUuid, uuidOr404, limpiar, sanitize, audit, auditSafe, codigoSolicitud };
