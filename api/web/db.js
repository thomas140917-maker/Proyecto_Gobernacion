// Acceso a PostgreSQL con la misma DATABASE_URL del backend (Prisma agrega ?schema=, pg no lo conoce).
const pg = require('pg');
const { Pool } = pg;

// Las columnas `timestamp` (sin zona) las escribe el backend en UTC: se leen como UTC, no como hora local.
// Las fechas JS se envían en UTC (por defecto pg usa la zona horaria del servidor, lo que corrompería `timestamp` sin zona)
if (pg.defaults) pg.defaults.parseInputDatesAsUTC = true;
if (pg.types && pg.types.setTypeParser) pg.types.setTypeParser(1114, (s) => new Date(s.replace(' ', 'T') + 'Z'));

function conexion() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida');
  const u = new URL(url);
  u.searchParams.delete('schema');
  return u.toString();
}

const pool = new Pool({ connectionString: conexion(), max: 8, options: '-c timezone=UTC' });

const all = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await pool.query(sql, p)).rows[0];

/** Ejecuta fn(client) dentro de una transacción (COMMIT o ROLLBACK). */
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Serializa operaciones concurrentes sobre un mismo recurso (igual que el backend: advisory lock por id). */
const lock = (c, id) => c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [String(id)]);

module.exports = { pool, all, one, tx, lock };
