import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';

const COST = 12;

/**
 * Pre-hash SHA-256 -> base64 (44 caracteres) antes de bcrypt.
 * Evita el límite de 72 bytes de bcrypt (truncado silencioso con tildes/emojis)
 * y los problemas con bytes nulos.
 */
const prehash = (p: string) => createHash('sha256').update(p, 'utf8').digest('base64');

export const hashPassword = (p: string) => bcrypt.hash(prehash(p), COST);
export const verifyPassword = (p: string, hash: string) => bcrypt.compare(prehash(p), hash);

/** Hash válido que se usa cuando el usuario no existe, para que el login tarde lo mismo. */
export const DUMMY_HASH = bcrypt.hashSync(prehash('contrasena-ficticia'), COST);
