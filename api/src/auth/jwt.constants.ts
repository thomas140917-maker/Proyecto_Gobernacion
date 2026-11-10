export const JWT_ISSUER = 'centro-actoral-api';
export const AUD_ADMIN = 'centro-actoral-admin';
export const AUD_ACTOR = 'centro-actoral-actor';

/** Opciones explícitas (completas) para verificar/firmar: no dependen de valores por defecto. */
export const verifyOpts = (audience: string) => ({
  algorithms: ['HS256' as const],
  issuer: JWT_ISSUER,
  audience,
});
export const signOpts = (audience: string, expiresIn: string) => ({
  expiresIn,
  algorithm: 'HS256' as const,
  issuer: JWT_ISSUER,
  audience,
});
