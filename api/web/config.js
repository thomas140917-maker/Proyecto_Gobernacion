// Configuración del módulo web (frontend). Lee las MISMAS variables que el resto del backend.
const env = process.env;

const S3_ACTIVO = !!env.S3_BUCKET && env.STORAGE !== 'local';

module.exports = {
  env,
  JWT_SECRET: env.JWT_SECRET,
  JWT_ISSUER: 'centro-actoral-api',
  AUD_ADMIN: 'centro-actoral-admin',
  AUD_ACTOR: 'centro-actoral-actor',
  S3_ACTIVO,
  // Orígenes extra que el navegador debe poder cargar (URLs firmadas de MinIO / S3)
  S3_PUBLIC_ENDPOINT: env.S3_PUBLIC_ENDPOINT || '',
  SIGNED_URL_TTL: Number(env.SIGNED_URL_TTL || 900),
  MAX_LOGIN_FALLOS: 5,
  BLOQUEO_MIN: 15,
};
