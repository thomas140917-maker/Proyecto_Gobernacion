// Autenticación del módulo web. Usa EXACTAMENTE el mismo esquema que el backend NestJS:
//  - contraseña: SHA-256 (base64) -> bcrypt cost 12      (api/src/common/password.util.ts)
//  - JWT HS256 con iss/aud/rol                            (api/src/auth/jwt.constants.ts)
//  - bloqueo tras 5 fallos (15 min) y sesión inválida si cambió la contraseña (admin)
// Así un token emitido aquí sirve en /api/v1 y viceversa.
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { createHash } = require('crypto');
const cfg = require('./config');
const { one, pool } = require('./db');
const { fail } = require('./util');

const COST = 12;
const prehash = (p) => createHash('sha256').update(p, 'utf8').digest('base64');
const hashPassword = (p) => bcrypt.hash(prehash(p), COST);
const verifyPassword = (p, h) => bcrypt.compare(prehash(p), h);
let DUMMY;
const dummy = () => (DUMMY ??= bcrypt.hashSync(prehash('contrasena-ficticia'), COST));

/** Reglas de contraseña del registro (igual que RegistroPublicoDto). */
function validarContrasena(c) {
  if (typeof c !== 'string' || c.length < 8 || c.length > 128 || !/[A-Za-z]/.test(c) || !/\d/.test(c)) {
    throw fail(400, 'La contraseña debe tener al menos 8 caracteres e incluir letras y números');
  }
}

const firmarAdmin = (a) => jwt.sign(
  { sub: a.admin_id, correo: a.correo, nombre: `${a.nombre} ${a.apellido}`, rol: 'ADMIN' },
  cfg.JWT_SECRET, { expiresIn: '8h', algorithm: 'HS256', issuer: cfg.JWT_ISSUER, audience: cfg.AUD_ADMIN });
const firmarActor = (a) => jwt.sign(
  { sub: a.actor_id, correo: a.correo, rol: 'ACTOR' },
  cfg.JWT_SECRET, { expiresIn: '4h', algorithm: 'HS256', issuer: cfg.JWT_ISSUER, audience: cfg.AUD_ACTOR });

const MSG_LOGIN = 'Correo o contraseña incorrectos, o cuenta bloqueada temporalmente';

/**
 * Compara la contraseña. Si no coincide con el esquema actual, prueba el esquema del proyecto anterior
 * (bcrypt directo) y, si sirve, migra el hash al esquema nuevo (migración perezosa al iniciar sesión).
 */
async function comprobar(clave, hash, tabla, idCol, id) {
  const hash0 = hash || dummy();
  if (await verifyPassword(clave, hash0)) return true;
  if (hash && (await bcrypt.compare(clave, hash).catch(() => false))) {
    await pool.query(`UPDATE ${tabla} SET contrasena_hash=$1 WHERE ${idCol}=$2`, [await hashPassword(clave), id]);
    return true;
  }
  return false;
}

async function registrarFallo(tabla, idCol, id) {
  const r = await one(`UPDATE ${tabla} SET intentos_fallidos = intentos_fallidos + 1 WHERE ${idCol}=$1 RETURNING intentos_fallidos`, [id]);
  if (r && r.intentos_fallidos >= cfg.MAX_LOGIN_FALLOS) {
    await pool.query(`UPDATE ${tabla} SET intentos_fallidos=0, bloqueado_hasta = now() + ($2 || ' minutes')::interval WHERE ${idCol}=$1`, [id, String(cfg.BLOQUEO_MIN)]);
  }
}

/** Intenta como administrador y luego como actor. Devuelve el payload que espera el frontend. */
async function login(correo, contrasena) {
  const mail = String(correo || '').trim().toLowerCase();
  const clave = String(contrasena || '');
  if (!mail || !clave) throw fail(400, 'Escribe tu correo y tu contraseña');

  const adm = await one('SELECT * FROM administradores WHERE correo=$1', [mail]);
  if (adm) {
    const bloq = adm.bloqueado_hasta && new Date(adm.bloqueado_hasta) > new Date();
    const ok = await comprobar(clave, adm.contrasena_hash, 'administradores', 'admin_id', adm.admin_id);
    if (adm.esta_activo && !bloq && ok) {
      if (adm.intentos_fallidos > 0 || adm.bloqueado_hasta) {
        await pool.query('UPDATE administradores SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE admin_id=$1', [adm.admin_id]);
      }
      return { token: firmarAdmin(adm), rol: 'admin', nombre: adm.nombre, foto: null };
    }
    if (adm.esta_activo && !bloq && !ok) await registrarFallo('administradores', 'admin_id', adm.admin_id);
    throw fail(401, MSG_LOGIN);
  }

  const act = await one(
    `SELECT a.*, p.nombre_artistico FROM actores a LEFT JOIN perfiles_actores p USING(actor_id) WHERE a.correo=$1`, [mail]);
  const bloq = act && act.bloqueado_hasta && new Date(act.bloqueado_hasta) > new Date();
  const ok = await comprobar(clave, act && act.contrasena_hash, 'actores', 'actor_id', act && act.actor_id);
  if (act && act.esta_activo && !bloq && ok) {
    if (act.intentos_fallidos > 0 || act.bloqueado_hasta) {
      await pool.query('UPDATE actores SET intentos_fallidos=0, bloqueado_hasta=NULL WHERE actor_id=$1', [act.actor_id]);
    }
    return { token: firmarActor(act), rol: 'actor', nombre: act.nombre_artistico || act.nombre_completo, foto: null };
  }
  if (act && act.esta_activo && !bloq && !ok) await registrarFallo('actores', 'actor_id', act.actor_id);
  throw fail(401, MSG_LOGIN);
}

// ------------------------------------------------------------ sesión (middlewares)
/** Devuelve { rol: 'admin'|'actor', id } o null (valida firma, vigencia y estado en BD como SesionService). */
async function sesionDe(req) {
  const [tipo, token] = String(req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return null;
  for (const [aud, rol] of [[cfg.AUD_ADMIN, 'ADMIN'], [cfg.AUD_ACTOR, 'ACTOR']]) {
    let p;
    try { p = jwt.verify(token, cfg.JWT_SECRET, { algorithms: ['HS256'], issuer: cfg.JWT_ISSUER, audience: aud }); } catch { continue; }
    if (p.rol !== rol) return null;
    if (rol === 'ADMIN') {
      const a = await one('SELECT esta_activo, contrasena_actualizada_en FROM administradores WHERE admin_id=$1', [p.sub]);
      if (!a || !a.esta_activo) return null;
      if (Math.floor(new Date(a.contrasena_actualizada_en).getTime() / 1000) > p.iat) return null;
      return { rol: 'admin', id: p.sub, nombre: p.nombre };
    }
    const a = await one('SELECT esta_activo FROM actores WHERE actor_id=$1', [p.sub]);
    if (!a || !a.esta_activo) return null;
    return { rol: 'actor', id: p.sub };
  }
  return null;
}

const auth = (rol) => async (req, res, next) => {
  try {
    const s = await sesionDe(req);
    if (!s || (rol && s.rol !== rol)) {
      return res.status(401).json({ error: 'Tu sesión expiró o no tienes permiso. Inicia sesión de nuevo.' });
    }
    req.u = s;
    next();
  } catch (e) { next(e); }
};
const optionalAuth = async (req, _res, next) => {
  try { req.u = await sesionDe(req); } catch { req.u = null; }
  next();
};

module.exports = { hashPassword, verifyPassword, validarContrasena, firmarActor, firmarAdmin, login, auth, optionalAuth };
