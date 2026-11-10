/**
 * Ejecutor de migraciones: aplica db/migrations/*.sql en orden y registra cuáles ya corrieron
 * en la tabla schema_migrations. Uso: node dist/db/migrate.js  (o RUN_MIGRATIONS=true al arrancar).
 *
 *  - Un lock advisory evita que dos instancias migren a la vez (varias tareas ECS arrancando juntas).
 *  - Cada archivo corre en una transacción: o se aplica completo o no se aplica.
 *  - Si una migración ya aplicada fue modificada (checksum distinto) se detiene.
 *  - Reconoce bases creadas antes por docker-entrypoint-initdb.d (las marca como aplicadas).
 */
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const LOCK_ID = 727274;

/** Sondas para "adoptar" una base ya migrada a mano o por initdb (solo si schema_migrations está vacía). */
const SONDAS: Record<string, string> = {
  '001_schema.sql': "SELECT to_regclass('public.actores') IS NOT NULL AS ok",
  '002_ajustes_s1.sql': "SELECT to_regclass('public.tokens_recuperacion') IS NOT NULL AS ok",
  '003_seguridad.sql': "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'administradores' AND column_name = 'intentos_fallidos') AS ok",
  '004_semana2.sql': "SELECT to_regclass('public.perfiles_versiones') IS NOT NULL AS ok",
  '005_semana3.sql': "SELECT to_regclass('public.convocatorias_habilidades') IS NOT NULL AS ok",
  '006_semana4.sql': "SELECT to_regclass('public.certificados') IS NOT NULL AS ok",
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const log = (m: string) => console.log(`[migrate] ${m}`);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida');
  // pg no conoce el parámetro ?schema= de Prisma
  const u = new URL(url);
  u.searchParams.delete('schema');

  const dir = process.env.MIGRATIONS_DIR ?? join(process.cwd(), 'db', 'migrations');
  const archivos = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  if (!archivos.length) throw new Error(`No hay migraciones en ${dir}`);

  const client = new Client({ connectionString: u.toString() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre varchar(200) PRIMARY KEY, checksum varchar(64) NOT NULL, aplicada_en timestamp NOT NULL DEFAULT now())`);

    const { rows } = await client.query<{ nombre: string; checksum: string }>('SELECT nombre, checksum FROM schema_migrations');
    const aplicadas = new Map(rows.map((r) => [r.nombre, r.checksum]));

    // Adopción de bases existentes
    if (aplicadas.size === 0) {
      const { rows: base } = await client.query("SELECT to_regclass('public.actores') IS NOT NULL AS existe");
      if (base[0].existe) {
        for (const nombre of archivos) {
          const sonda = SONDAS[nombre];
          if (!sonda) continue;
          const { rows: r } = await client.query(sonda);
          if (r[0].ok) {
            const checksum = sha256(readFileSync(join(dir, nombre), 'utf8'));
            await client.query('INSERT INTO schema_migrations (nombre, checksum) VALUES ($1, $2)', [nombre, checksum]);
            aplicadas.set(nombre, checksum);
            log(`adoptada (ya estaba aplicada): ${nombre}`);
          }
        }
      }
    }

    let nuevas = 0;
    for (const nombre of archivos) {
      const sql = readFileSync(join(dir, nombre), 'utf8');
      const checksum = sha256(sql);
      const previo = aplicadas.get(nombre);
      if (previo) {
        if (previo !== checksum && process.env.MIGRATE_ALLOW_DRIFT !== 'true') {
          throw new Error(`La migración ${nombre} ya se aplicó y su contenido cambió. Crea una migración nueva en lugar de editarla.`);
        }
        continue;
      }
      log(`aplicando ${nombre} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql); // sin parámetros: protocolo simple, admite varias sentencias
        await client.query('INSERT INTO schema_migrations (nombre, checksum) VALUES ($1, $2)', [nombre, checksum]);
        await client.query('COMMIT');
        nuevas++;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Falló ${nombre}: ${(e as Error).message}`);
      }
    }
    log(nuevas ? `${nuevas} migración(es) aplicada(s)` : 'la base de datos ya está al día');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`[migrate] ERROR: ${e.message ?? e}`);
    process.exit(1);
  },
);
