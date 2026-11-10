/** Valida variables críticas al arrancar: la API no inicia con una configuración insegura. */
export function validateEnv(env: Record<string, unknown>) {
  const errores: string[] = [];
  const val = (k: string) => String(env[k] ?? '').trim();

  for (const k of [
    'DATABASE_URL', 'JWT_SECRET', 'CERT_HMAC_SECRET', 'FRONTEND_URL', 'SMTP_HOST', 'MAIL_FROM',
    'S3_BUCKET', 'S3_REGION',
  ]) {
    if (!val(k)) errores.push(`${k} es obligatoria`);
  }

  for (const k of ['JWT_SECRET', 'CERT_HMAC_SECRET']) {
    const v = val(k);
    if (v && (v.length < 32 || /cambia|genera_uno|changeme/i.test(v))) {
      errores.push(`${k} debe tener al menos 32 caracteres y no ser el valor de ejemplo (usa: openssl rand -hex 48)`);
    }
  }
  if (val('JWT_SECRET') && val('JWT_SECRET') === val('CERT_HMAC_SECRET')) {
    errores.push('CERT_HMAC_SECRET debe ser distinto de JWT_SECRET');
  }

  // Con un endpoint propio (MinIO) hacen falta claves; con AWS S3 real se usa el rol IAM de la tarea.
  const claves = [val('S3_ACCESS_KEY'), val('S3_SECRET_KEY')];
  if (val('S3_ENDPOINT') && claves.some((c) => !c)) {
    errores.push('S3_ACCESS_KEY y S3_SECRET_KEY son obligatorias cuando se define S3_ENDPOINT');
  }
  if (claves.filter(Boolean).length === 1) {
    errores.push('Define S3_ACCESS_KEY y S3_SECRET_KEY juntas, o ninguna (para usar un rol IAM)');
  }
  if (val('S3_SECRET_KEY') && (val('S3_SECRET_KEY').length < 8 || /cambia/i.test(val('S3_SECRET_KEY')))) {
    errores.push('S3_SECRET_KEY debe tener al menos 8 caracteres y no ser el valor de ejemplo');
  }

  if (val('INSTITUCION_COLOR') && !/^#[0-9A-Fa-f]{6}$/.test(val('INSTITUCION_COLOR'))) {
    errores.push('INSTITUCION_COLOR debe tener formato #RRGGBB');
  }
  if (val('NODE_ENV') === 'production' && !val('CORS_ORIGIN')) {
    errores.push('CORS_ORIGIN es obligatoria en producción');
  }
  if (errores.length) throw new Error(`Configuración inválida:\n - ${errores.join('\n - ')}`);
  return env;
}
