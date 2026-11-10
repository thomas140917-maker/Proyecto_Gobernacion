// Verificación de correo y recuperación de contraseña (actores y administradores).
const { randomBytes, createHash } = require('crypto');
const { pool, one, tx } = require('./db');
const { fail, wrap, audit, auditSafe } = require('./util');
const seg = require('./seguridad');
const correo = require('./correo');

const sha = (t) => createHash('sha256').update(t).digest('hex');
const TTL_VERIFICACION_H = 48, TTL_RECUPERACION_MIN = 30;
const TOKEN = /^[a-f0-9]{64}$/;

/** Crea un token nuevo (anula los pendientes del mismo tipo) y devuelve el token en claro. */
async function crearToken(c, tipo, dueno, minutos) {
  const col = dueno.actor_id ? 'actor_id' : 'admin_id', id = dueno.actor_id || dueno.admin_id;
  await c.query(`DELETE FROM tokens_correo WHERE ${col}=$1 AND tipo=$2 AND (usado_en IS NOT NULL OR expira_en < now())`, [id, tipo]);
  await c.query(`UPDATE tokens_correo SET usado_en=now() WHERE ${col}=$1 AND tipo=$2 AND usado_en IS NULL`, [id, tipo]);
  const token = randomBytes(32).toString('hex');
  await c.query(`INSERT INTO tokens_correo(tipo,${col},token_hash,expira_en) VALUES($1,$2,$3,now() + ($4 || ' minutes')::interval)`, [tipo, id, sha(token), String(minutos)]);
  return token;
}

/** Para el registro: crea el token de verificación y envía el correo (sin bloquear ni fallar). */
async function enviarVerificacion(actor) {
  try {
    const token = await tx((c) => crearToken(c, 'VERIFICACION', { actor_id: actor.actor_id }, TTL_VERIFICACION_H * 60));
    await correo.enviarVerificacion(actor.correo, String(actor.nombre).split(/\s+/)[0], token);
  } catch (e) { console.error('[acceso] verificación no enviada:', e.message); }
}

function registrar(app) {
  // ---- "Olvidé mi contraseña": la respuesta es siempre la misma (no revela si el correo existe)
  app.post('/api/olvide-contrasena', wrap(async (req, res) => {
    const mail = String((req.body && req.body.correo) || '').trim().toLowerCase();
    const OK = { ok: true, message: 'Si el correo está registrado, te enviamos un enlace para crear una nueva contraseña. Revisa también la carpeta de spam.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 201) return res.json(OK);
    res.json(OK); // se responde ya: el tiempo de respuesta no delata si existe
    try {
      const adm = await one('SELECT admin_id, nombre FROM administradores WHERE lower(correo)=$1 AND esta_activo', [mail]);
      const act = adm ? null : await one('SELECT actor_id, nombre_completo AS nombre FROM actores WHERE lower(correo)=$1 AND esta_activo', [mail]);
      const dueno = adm ? { admin_id: adm.admin_id } : act ? { actor_id: act.actor_id } : null;
      if (!dueno) return;
      const token = await tx((c) => crearToken(c, 'RECUPERACION', dueno, TTL_RECUPERACION_MIN));
      await correo.enviarRecuperacion(mail, String((adm || act).nombre).split(/\s+/)[0], token);
      await auditSafe(null, 'ACTUALIZAR', adm ? 'administradores' : 'actores', dueno.admin_id || dueno.actor_id, null, 'Solicitud de recuperación de contraseña');
    } catch (e) { console.error('[acceso] recuperación:', e.message); }
  }));

  app.post('/api/restablecer-contrasena', wrap(async (req, res) => {
    const { token, contrasena } = req.body || {};
    if (!TOKEN.test(String(token || ''))) throw fail(400, 'El enlace no es válido o ya venció. Solicita uno nuevo.');
    seg.validarContrasena(contrasena);
    const hash = await seg.hashPassword(contrasena);
    const r = await tx(async (c) => {
      // Consumo atómico: si dos peticiones usan el mismo token, solo una gana
      const t = (await c.query(`UPDATE tokens_correo SET usado_en=now() WHERE token_hash=$1 AND tipo='RECUPERACION' AND usado_en IS NULL AND expira_en > now() RETURNING actor_id, admin_id`, [sha(token)])).rows[0];
      if (!t) throw fail(400, 'El enlace no es válido o ya venció. Solicita uno nuevo.');
      let u;
      if (t.admin_id) {
        u = (await c.query('UPDATE administradores SET contrasena_hash=$2, contrasena_actualizada_en=now(), intentos_fallidos=0, bloqueado_hasta=NULL WHERE admin_id=$1 RETURNING correo, nombre', [t.admin_id, hash])).rows[0];
        await c.query(`UPDATE tokens_correo SET usado_en=now() WHERE admin_id=$1 AND tipo='RECUPERACION' AND usado_en IS NULL`, [t.admin_id]);
        await audit(c, 'ACTUALIZAR', 'administradores', t.admin_id, null, 'Restablecimiento de contraseña mediante enlace de correo');
      } else {
        u = (await c.query('UPDATE actores SET contrasena_hash=$2, intentos_fallidos=0, bloqueado_hasta=NULL WHERE actor_id=$1 RETURNING correo, nombre_completo AS nombre', [t.actor_id, hash])).rows[0];
        await c.query(`UPDATE tokens_correo SET usado_en=now() WHERE actor_id=$1 AND tipo='RECUPERACION' AND usado_en IS NULL`, [t.actor_id]);
        // recibir el enlace en el correo demuestra que es suyo
        await c.query('UPDATE actores SET correo_verificado_en=COALESCE(correo_verificado_en, now()) WHERE actor_id=$1', [t.actor_id]);
        await audit(c, 'ACTUALIZAR', 'actores', t.actor_id, { rol: 'actor', id: t.actor_id }, 'Restablecimiento de contraseña mediante enlace de correo');
      }
      return u;
    });
    if (r) correo.enviarClaveCambiada(r.correo, String(r.nombre).split(/\s+/)[0]).catch(() => {});
    res.json({ ok: true, message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  }));

  // ---- verificación de correo
  app.post('/api/verificar-correo', wrap(async (req, res) => {
    const token = String((req.body && req.body.token) || '');
    if (!TOKEN.test(token)) throw fail(400, 'El enlace no es válido o ya venció. Solicita uno nuevo desde tu cuenta.');
    await tx(async (c) => {
      const t = (await c.query(`UPDATE tokens_correo SET usado_en=now() WHERE token_hash=$1 AND tipo='VERIFICACION' AND usado_en IS NULL AND expira_en > now() RETURNING actor_id`, [sha(token)])).rows[0];
      if (!t) throw fail(400, 'El enlace no es válido o ya venció. Solicita uno nuevo desde tu cuenta.');
      await c.query('UPDATE actores SET correo_verificado_en=COALESCE(correo_verificado_en, now()) WHERE actor_id=$1', [t.actor_id]);
      await audit(c, 'ACTUALIZAR', 'actores', t.actor_id, { rol: 'actor', id: t.actor_id }, 'Verificó su correo electrónico');
    });
    res.json({ ok: true, message: '¡Correo verificado! Gracias.' });
  }));

  app.post('/api/reenviar-verificacion', seg.auth('actor'), wrap(async (req, res) => {
    const a = await one('SELECT actor_id, correo, nombre_completo AS nombre, correo_verificado_en FROM actores WHERE actor_id=$1', [req.u.id]);
    if (!a) throw fail(404, 'Cuenta no encontrada');
    if (a.correo_verificado_en) return res.json({ ok: true, message: 'Tu correo ya está verificado.' });
    const reciente = await one(`SELECT 1 FROM tokens_correo WHERE actor_id=$1 AND tipo='VERIFICACION' AND creado_en > now() - interval '60 seconds'`, [a.actor_id]);
    if (reciente) throw fail(429, 'Espera un minuto antes de pedir otro correo.');
    await enviarVerificacion(a);
    res.json({ ok: true, message: 'Te enviamos un nuevo correo de verificación.' });
  }));
}

module.exports = { registrar, enviarVerificacion };
