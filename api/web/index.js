// Módulo "web": sirve el frontend (carpeta /public) y las rutas /api/* que usa el sitio.
// Se monta dentro de la misma app de Nest (ver src/main.ts) ANTES de helmet; no toca /api/v1 ni /api/docs,
// que siguen siendo del backend sin ningún cambio. Usa la misma base de datos, los mismos JWT y las mismas reglas.
const path = require('path');
const fs = require('fs');

const esDelBackend = (req) => /^\/api\/(v1|docs)(\/|$)/.test(req.path || req.url || '');

function carpetaPublica() {
  const candidatas = [process.env.PUBLIC_DIR, path.resolve(__dirname, '../public'), path.resolve(__dirname, '../../public')].filter(Boolean);
  return candidatas.find((d) => fs.existsSync(path.join(d, 'index.html'))) || candidatas[candidatas.length - 1];
}

/** Límite simple en memoria por IP+ruta (la API de Nest tiene su propio ThrottlerGuard). */
function limitar(max, ventanaMs, mensaje) {
  const golpes = new Map();
  setInterval(() => { const ahora = Date.now(); for (const [k, v] of golpes) if (v.fin < ahora) golpes.delete(k); }, 60_000).unref();
  return (req, res, next) => {
    const k = `${req.ip}|${req.path}`;
    const ahora = Date.now();
    let g = golpes.get(k);
    if (!g || g.fin < ahora) { g = { n: 0, fin: ahora + ventanaMs }; golpes.set(k, g); }
    if (++g.n > max) {
      res.setHeader('Retry-After', Math.ceil((g.fin - ahora) / 1000));
      return res.status(429).json({ error: mensaje || 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
    }
    next();
  };
}

function csp(cfg) {
  const s3 = [];
  if (cfg.S3_PUBLIC_ENDPOINT) { try { s3.push(new URL(cfg.S3_PUBLIC_ENDPOINT).origin); } catch { /* ignorar */ } }
  else if (cfg.S3_ACTIVO) s3.push('https://*.amazonaws.com');
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', ...s3],
      mediaSrc: ["'self'", 'blob:', ...s3],
      connectSrc: ["'self'", ...s3],
      frameSrc: ["'self'", 'blob:', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  };
}

function montar(app) {
  const express = require('express');
  const cfg = require('./config');
  if (!cfg.JWT_SECRET || cfg.JWT_SECRET.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
  const archivos = require('./archivos');
  const { one } = require('./db');
  const seg = require('./seguridad');
  const { wrap } = require('./util');
  let helmet = null;
  try { helmet = require('helmet'); } catch { console.warn('[web] helmet no está instalado: se omiten los encabezados de seguridad'); }

  const propio = (fn) => (req, res, next) => (esDelBackend(req) ? next() : fn(req, res, next));
  const publica = carpetaPublica();

  // ---- encabezados de seguridad del sitio (el backend conserva los suyos para /api/v1)
  if (helmet) app.use(propio(helmet({ contentSecurityPolicy: csp(cfg), crossOriginEmbedderPolicy: false })));
  app.use(propio((req, res, next) => { if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store'); next(); }));
  app.use(propio(express.json({ limit: '1mb' })));

  // ---- archivos subidos (solo los del modo local y los del sitio anterior)
  app.use('/uploads', async (req, res, next) => {
    try {
      let rel;
      try { rel = decodeURIComponent((req.originalUrl || req.url).split('?')[0]).replace(/^\/uploads/, ''); } catch { return res.status(400).end(); }
      // Los documentos de autorización de acudientes NUNCA se sirven como archivos públicos
      if (/^\/autorizaciones\//.test(rel)) return res.status(404).end();
      if (!/^\/(actores|portadas)\//.test(rel)) {
        if (await one('SELECT 1 FROM acudientes_legales WHERE url_documento_autorizacion = $1', ['/uploads' + rel])) return res.status(404).end();
      }
      next();
    } catch (e) { next(e); }
  });
  app.use('/uploads', express.static(archivos.UPLOADS_DIR, { index: false, dotfiles: 'ignore', fallthrough: true }));

  // ---- límites para los puntos sensibles
  app.use('/api/login', limitar(20, 10 * 60_000, 'Demasiados intentos de inicio de sesión. Espera unos minutos.'));
  app.use('/api/olvide-contrasena', limitar(5, 60 * 60_000, 'Demasiadas solicitudes de recuperación. Inténtalo en una hora.'));
  app.use('/api/restablecer-contrasena', limitar(10, 60 * 60_000, 'Demasiados intentos. Solicita un nuevo enlace.'));
  app.use('/api/verificar-correo', limitar(20, 60 * 60_000, 'Demasiados intentos. Inténtalo más tarde.'));
  app.use('/api/reenviar-verificacion', limitar(5, 60 * 60_000, 'Demasiadas solicitudes. Inténtalo en una hora.'));
  app.use('/api/registro', limitar(10, 60 * 60_000, 'Demasiados registros desde esta conexión. Inténtalo más tarde.'));
  app.use('/api/actores/:id/reportar', limitar(10, 60 * 60_000, 'Has enviado demasiados reportes. Inténtalo más tarde.'));

  // ---- rutas
  app.post('/api/login', wrap(async (req, res) => res.json(await seg.login(req.body && req.body.correo, req.body && req.body.contrasena))));
  require('./publico').registrar(app);
  require('./actor').registrar(app);
  require('./admin').registrar(app);
  require('./contenido').registrar(app);
  require('./acceso').registrar(app);

  // ---- administrador inicial: se crea solo al arrancar (ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD), sin comando manual
  crearAdminInicial().catch((e) => console.error('[web] administrador inicial:', e.message));

  // ---- frontend estático
  app.use(propio(express.static(publica, { index: 'index.html', maxAge: 0 })));

  // ---- errores de este módulo (subidas, JSON mal formado). Los de Nest no pasan por aquí.
  app.use((err, req, res, next) => {
    if (esDelBackend(req)) return next(err);
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Cada archivo puede pesar máximo 5 MB.' });
    if (err && /^LIMIT_/.test(err.code || '')) return res.status(400).json({ error: 'Demasiados archivos o datos en el envío.' });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'El envío es demasiado grande.' });
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return res.status(400).json({ error: 'Los datos enviados no tienen un formato válido.' });
    if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error('[web]', err);
    res.status(500).json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' });
  });

  console.log(`[web] frontend en ${publica}; almacenamiento: ${cfg.S3_ACTIVO ? 'S3/MinIO' : 'carpeta local ' + archivos.UPLOADS_DIR}`);
}

module.exports = { montar };

async function crearAdminInicial() {
  const correo = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const clave = process.env.ADMIN_SEED_PASSWORD || '';
  if (!correo || !clave) return;
  const { one, pool } = require('./db');
  const seg = require('./seguridad');
  if (await one('SELECT 1 FROM administradores WHERE lower(correo)=$1', [correo])) return; // ya existe: no se toca
  if (/cambia/i.test(clave)) { console.warn('[web] ADMIN_SEED_PASSWORD sigue con el valor de ejemplo: cámbiala en .env y reinicia para crear el administrador'); return; }
  seg.validarContrasena(clave);
  await pool.query(
    `INSERT INTO administradores(correo, contrasena_hash, contrasena_actualizada_en, nombre, apellido, esta_activo)
     VALUES($1,$2,now(),'Administrador','Principal',true) ON CONFLICT DO NOTHING`,
    [correo, await seg.hashPassword(clave)]);
  console.log(`[web] administrador inicial creado: ${correo}`);
}
