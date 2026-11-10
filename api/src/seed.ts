// Crea el primer administrador. Uso: node dist/seed.js
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './common/password.util';

async function main() {
  const correo = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const clave = process.env.ADMIN_SEED_PASSWORD ?? '';
  if (!correo) throw new Error('Define ADMIN_SEED_EMAIL');
  if (clave.length < 12 || /cambia/i.test(clave) || !/[A-Za-z]/.test(clave) || !/\d/.test(clave)) {
    throw new Error(
      'ADMIN_SEED_PASSWORD debe tener al menos 12 caracteres, letras y números, y no ser el valor de ejemplo',
    );
  }

  const prisma = new PrismaClient();
  try {
    const admin = await prisma.administradores.upsert({
      where: { correo },
      update: {},
      create: {
        correo,
        contrasena_hash: await hashPassword(clave),
        contrasena_actualizada_en: new Date(),
        nombre: 'Administrador',
        apellido: 'Principal',
      },
    });
    console.log(`Administrador listo: ${admin.correo}`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
