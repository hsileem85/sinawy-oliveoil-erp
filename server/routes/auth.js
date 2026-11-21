import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await query(
      'SELECT id, email, name, password_hash, role FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signToken(user);
    return res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  return res.json({ auth: req.auth });
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    if (req.auth.type !== 'user') {
      return res.status(403).json({ error: 'User session required' });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.auth.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(String(currentPassword), result.rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(String(newPassword), 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.auth.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to update password' });
  }
});

router.get('/api-keys', requireAuth, async (_req, res) => {
  const result = await query(
    'SELECT id, name, key_value, active, last_used_at, created_at FROM api_keys ORDER BY created_at DESC'
  );
  return res.json({ keys: result.rows });
});

router.post('/api-keys', requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Key name is required' });
    const keyValue = `snw_live_${crypto.randomBytes(18).toString('hex')}`;
    const result = await query(
      'INSERT INTO api_keys (name, key_value, active) VALUES ($1, $2, TRUE) RETURNING id, name, key_value, active, created_at',
      [name, keyValue]
    );
    return res.status(201).json({ key: result.rows[0] });
  } catch (err) {
    console.error('Create API key error:', err);
    return res.status(500).json({ error: 'Failed to create API key' });
  }
});

router.patch('/api-keys/:id/toggle', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const result = await query(
    'UPDATE api_keys SET active = NOT active WHERE id = $1 RETURNING id, name, key_value, active, last_used_at, created_at',
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'API key not found' });
  return res.json({ key: result.rows[0] });
});

export default router;
