import { Router } from 'express';
import { requireApprovedAdmin } from './auth';

const router = Router();

// ---------------------------------------------------------------------------
// Postgres pool helper (same pattern as weightSync)
// ---------------------------------------------------------------------------
import { Pool } from 'pg';
let _pool: Pool | null = null;
function getPool(): Pool {
    if (!_pool) {
          _pool = new Pool({
                  connectionString: process.env.DATABASE_URL,
                  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
          });
    }
    return _pool;
}

async function ensurePackagesTable(): Promise<void> {
    const pool = getPool();
    await pool.query(`
        CREATE TABLE IF NOT EXISTS packages (
              id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                          length_in DOUBLE PRECISION,
                                width_in DOUBLE PRECISION,
                                      height_in DOUBLE PRECISION,
                                            active BOOLEAN NOT NULL DEFAULT TRUE,
                                                  created_at TIMESTAMPTZ DEFAULT NOW()
                                                      )
                                                        `);
    // Migration: add active column if it doesn't exist yet
  await pool.query(`
      ALTER TABLE packages ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE
        `);
    // Migration: make dimension columns nullable if they were previously NOT NULL
  await pool.query(`ALTER TABLE packages ALTER COLUMN length_in DROP NOT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE packages ALTER COLUMN width_in DROP NOT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE packages ALTER COLUMN height_in DROP NOT NULL`).catch(() => {});
}

// ---------------------------------------------------------------------------
// GET /api/packages — list all packages
// ---------------------------------------------------------------------------
router.get('/api/packages', requireApprovedAdmin, async (_req, res) => {
    try {
          await ensurePackagesTable();
          const result = await getPool().query(
                  'SELECT id, name, length_in, width_in, height_in, active FROM packages ORDER BY name ASC'
                );
          res.json(result.rows);
    } catch (err: any) {
    console.error('[packages] GET error:', err);
          res.status(500).json({ error: err?.message ?? 'Failed to load packages' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/packages — create a new package
// ---------------------------------------------------------------------------
router.post('/api/packages', requireApprovedAdmin, async (req, res) => {
    const { name, length_in, width_in, height_in } = req.body ?? {};
    if (!name) {
          return res.status(400).json({ error: 'name is required' });
    }
    const l = length_in != null && length_in !== '' ? parseFloat(length_in) : null;
    const w = width_in != null && width_in !== '' ? parseFloat(width_in) : null;
    const h = height_in != null && height_in !== '' ? parseFloat(height_in) : null;
    if (l !== null && (isNaN(l) || l <= 0)) {
          return res.status(400).json({ error: 'length_in must be a positive number' });
    }
    if (w !== null && (isNaN(w) || w <= 0)) {
          return res.status(400).json({ error: 'width_in must be a positive number' });
    }
    if (h !== null && (isNaN(h) || h <= 0)) {
          return res.status(400).json({ error: 'height_in must be a positive number' });
    }
    try {
          await ensurePackagesTable();
          const result = await getPool().query(
                  'INSERT INTO packages (name, length_in, width_in, height_in, active) VALUES ($1, $2, $3, $4, TRUE) RETURNING id, name, length_in, width_in, height_in, active',
                  [String(name).trim(), l, w, h]
                );
          res.json(result.rows[0]);
    } catch (err: any) {
    console.error('[packages] POST error:', err);
          if (err?.code === '23505') {
                  return res.status(409).json({ error: `A package named "${name}" already exists` });
          }
          res.status(500).json({ error: err?.message ?? 'Failed to create package' });
    }
});

// ---------------------------------------------------------------------------
// PUT /api/packages/:id — update a package
// ---------------------------------------------------------------------------
router.put('/api/packages/:id', requireApprovedAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, length_in, width_in, height_in } = req.body ?? {};
    if (!id || !name) {
          return res.status(400).json({ error: 'id and name are required' });
    }
    const l = length_in != null && length_in !== '' ? parseFloat(length_in) : null;
    const w = width_in != null && width_in !== '' ? parseFloat(width_in) : null;
    const h = height_in != null && height_in !== '' ? parseFloat(height_in) : null;
    if (l !== null && (isNaN(l) || l <= 0)) {
          return res.status(400).json({ error: 'length_in must be a positive number' });
    }
    if (w !== null && (isNaN(w) || w <= 0)) {
          return res.status(400).json({ error: 'width_in must be a positive number' });
    }
    if (h !== null && (isNaN(h) || h <= 0)) {
          return res.status(400).json({ error: 'height_in must be a positive number' });
    }
    try {
          await ensurePackagesTable();
          const result = await getPool().query(
                  'UPDATE packages SET name=$1, length_in=$2, width_in=$3, height_in=$4 WHERE id=$5 RETURNING id, name, length_in, width_in, height_in, active',
                  [String(name).trim(), l, w, h, id]
                );
          if (result.rowCount === 0) return res.status(404).json({ error: 'Package not found' });
          res.json(result.rows[0]);
    } catch (err: any) {
    console.error('[packages] PUT error:', err);
          if (err?.code === '23505') {
                  return res.status(409).json({ error: `A package named "${name}" already exists` });
          }
          res.status(500).json({ error: err?.message ?? 'Failed to update package' });
    }
});

// ---------------------------------------------------------------------------
// PATCH /api/packages/:id/toggle — toggle active on/off
// ---------------------------------------------------------------------------
router.patch('/api/packages/:id/toggle', requireApprovedAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id param required' });
    try {
          await ensurePackagesTable();
          const result = await getPool().query(
                  'UPDATE packages SET active = NOT active WHERE id=$1 RETURNING id, name, length_in, width_in, height_in, active',
                  [id]
                );
          if (result.rowCount === 0) return res.status(404).json({ error: 'Package not found' });
          res.json(result.rows[0]);
    } catch (err: any) {
    console.error('[packages] PATCH toggle error:', err);
          res.status(500).json({ error: err?.message ?? 'Failed to toggle package' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/packages/:id
// ---------------------------------------------------------------------------
router.delete('/api/packages/:id', requireApprovedAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id param required' });
    try {
          await ensurePackagesTable();
          const result = await getPool().query('DELETE FROM packages WHERE id=$1', [id]);
          if (result.rowCount === 0) return res.status(404).json({ error: 'Package not found' });
          res.json({ ok: true, id });
    } catch (err: any) {
    console.error('[packages] DELETE error:', err);
          res.status(500).json({ error: err?.message ?? 'Failed to delete package' });
    }
});

export default router;
