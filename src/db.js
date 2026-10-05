const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings instead of local-midnight Date objects.
types.setTypeParser(1082, (v) => v);

// Resolve connection settings.
// 1. DATABASE_URL (set manually), or
// 2. variables injected by a Deploio service reference:
//    NINE_PGDB_<NAME>_DSN (PostgreSQL Economy) / NINE_PG_<NAME>_DSN (PostgreSQL Business),
//    plus the matching _CA_CERT if present.
function resolveConfig(env = process.env) {
  let dsn = env.DATABASE_URL;
  let ca = env.DATABASE_CA_CERT;
  if (!dsn) {
    const key = Object.keys(env).find((k) => /^NINE_PG(DB)?_.+_DSN$/.test(k));
    if (key) {
      dsn = env[key];
      ca = ca || env[key.replace(/_DSN$/, '_CA_CERT')];
    }
  }
  if (!dsn) {
    throw new Error('No database configured. Set DATABASE_URL or add a Postgres service reference (nctl update app <app> --service db=postgresdatabase/<name>).');
  }

  // Nine's on-demand Postgres only accepts TLS with a self-signed CA whose name does not match the
  // hostname. node-postgres lets sslmode in the URL override the ssl object, so strip it and
  // configure TLS explicitly.
  const url = new URL(dsn);
  const sslmode = url.searchParams.get('sslmode');
  url.searchParams.delete('sslmode');
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  let ssl;
  if (sslmode === 'disable' || env.PGSSL === 'disable' || (local && !sslmode)) {
    ssl = false;
  } else if (ca) {
    ssl = { ca, rejectUnauthorized: true, checkServerIdentity: () => undefined };
  } else {
    ssl = { rejectUnauthorized: false };
  }
  return { connectionString: url.toString(), ssl, max: 5 };
}

let pool;
function getPool() {
  if (!pool) pool = new Pool(resolveConfig());
  return pool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS rounds (
      id            SERIAL PRIMARY KEY,
      title         TEXT NOT NULL,
      delivery_date DATE NOT NULL,
      delivery_time TEXT NOT NULL DEFAULT '',
      deadline      TIMESTAMPTZ,
      status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','finalized')),
      contact       JSONB NOT NULL DEFAULT '{}'::jsonb,
      extras        JSONB NOT NULL DEFAULT '{}'::jsonb,
      notes         TEXT NOT NULL DEFAULT '',
      notes_custom  TEXT NOT NULL DEFAULT '',
      finalized_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS orders (
      id          SERIAL PRIMARY KEY,
      round_id    INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      person      TEXT NOT NULL,
      kind        TEXT NOT NULL CHECK (kind IN ('signature','custom')),
      size        TEXT NOT NULL CHECK (size IN ('regular','large')),
      signature   TEXT,
      custom      JSONB,
      note        TEXT NOT NULL DEFAULT '',
      edit_token  TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS orders_round_idx ON orders(round_id);
  `);
}

module.exports = { query, migrate, resolveConfig, getPool };
