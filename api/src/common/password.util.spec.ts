import { DUMMY_HASH, hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hashPassword('Clave-Segura-123');
    expect(await verifyPassword('Clave-Segura-123', hash)).toBe(true);
    expect(await verifyPassword('otra-clave', hash)).toBe(false);
  });
  it('no trunca contraseñas largas con caracteres multibyte', async () => {
    const base = 'ñ'.repeat(40); // 80 bytes
    const hash = await hashPassword(base + 'A');
    expect(await verifyPassword(base + 'B', hash)).toBe(false);
  });
  it('DUMMY_HASH es un hash bcrypt válido', () => {
    expect(DUMMY_HASH.startsWith('$2')).toBe(true);
  });
});
