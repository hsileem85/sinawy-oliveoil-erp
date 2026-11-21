import jwt from 'jsonwebtoken';
import { query } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'sinawy-erp-dev-secret-change-me';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Accepts either:
 * 1) Bearer JWT token (from the Web ERP UI)
 * 2) X-API-Key header (from external services / scripts / EasyOrders integrations)
 */
export async function requireAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const result = await query(
        'SELECT id, name FROM api_keys WHERE key_value = $1 AND active = TRUE',
        [String(apiKey)]
      );
      if (result.rows.length > 0) {
        await query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [
          result.rows[0].id,
        ]);
        req.auth = { type: 'api_key', keyId: result.rows[0].id, name: result.rows[0].name };
        return next();
      }
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = { type: 'user', ...payload };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}
