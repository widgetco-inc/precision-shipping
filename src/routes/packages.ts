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
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      length_in DOUBLE PRECISION NOT NULL,
      width_in  DOUBLE PRECISION NOT NULL,
      height_in DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// ---------------------------------------------------------------------------
// GET /api/packages  — list all packages
// ---------------------------------------------------------------------------
router.get('/api/packages', requireApprovedAdmin, async (_req, res) => {
  try {
    await ensurePackagesTable();
    const result = await getPool().query(
      'SELECT id, name, length_in, width_in, height_in FROM packages ORDER BY name ASC'
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error('[packages] GET error:', err);
    res.status(500).json({ error: err?.message ?? 'Failed to load packages' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/packages  — create a new package
// ---------------------------------------------------------------------------
router.post('/api/packages', requireApprovedAdmin, async (req, res) => {
  const { name, length_in, width_in, height_in } = req.body ?? {};
  if (!name || !length_in || !width_in || !height_in) {
    return res.status(400).json({ error: 'name, length_in, width_in, height_in are required' });
  }
  const l = parseFloat(length_in), w = parseFloat(width_in), h = parseFloat(height_in);
  if ([l, w, h].some(v => isNaN(v) || v <= 0)) {
    return res.status(400).json({ error: 'Dimensions must be positive numbers' });
  }
  try {
    await ensurePackagesTable();
    const result = await getPool().query(
      'INSERT INTO packages (name, length_in, width_in, height_in) VALUES ($1, $2, $3, $4) RETURNING id, name, length_in, width_in, height_in',
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
// PUT /api/packages/:id  — update a package
// ---------------------------------------------------------------------------
router.put('/api/packages/:id', requireApprovedAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, length_in, width_in, height_in } = req.body ?? {};
  if (!id || !name || !length_in || !width_in || !height_in) {
    return res.status(400).json({ error: 'id, name, length_in, width_in, height_in are required' });
  }
  const l = parseFloat(length_in), w = parseFloat(width_in), h = parseFloat(height_in);
  if ([l, w, h].some(v => isNaN(v) || v <= 0)) {
    return res.status(400).json({ error: 'Dimensions must be positive numbers' });
  }
  try {
    await ensurePackagesTable();
    const result = await getPool().query(
      'UPDATE packages SET name=$1, length_in=$2, width_in=$3, height_in=$4 WHERE id=$5 RETURNING id, name, length_in, width_in, height_in',
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
