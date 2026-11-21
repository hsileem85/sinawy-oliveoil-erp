import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getDbMode } from './db.js';
import { runMigrations } from './migrate.js';
import { seedDemoData } from './seed.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import purchasesRoutes from './routes/purchases.js';
import bottlingRoutes from './routes/bottling.js';
import salesRoutes from './routes/sales.js';
import integrationsRoutes from './routes/integrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4000);

export function createApp() {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Public health endpoint for cloud load balancers (Railway, Render, Fly.io, Docker)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'sinawy-oliveoil-erp',
      db_mode: getDbMode(),
      timestamp: new Date().toISOString(),
    });
  });

  // Public & semi-public routes
  app.use('/api/auth', authRoutes);
  app.use('/api/integrations', integrationsRoutes);

  // Protected ERP API routes (JWT session or X-API-Key)
  app.use('/api/dashboard', requireAuth, dashboardRoutes);
  app.use('/api/purchases', requireAuth, purchasesRoutes);
  app.use('/api/bottling', requireAuth, bottlingRoutes);
  app.use('/api/sales', requireAuth, salesRoutes);

  // Serve built React SPA in production (or whenever client/dist exists)
  const distDir = path.resolve(__dirname, '..', 'client', 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  // Fallback 404 for unknown API paths
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return app;
}

export async function startServer() {
  const mode = await runMigrations();
  if (process.env.AUTO_SEED !== 'false') {
    await seedDemoData({ force: false });
  }
  const app = createApp();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sinawy Olive Oil ERP API running on http://localhost:${PORT} (db: ${mode})`);
  });
  return { app, server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer().catch((err) => {
    console.error('Failed to start Sinawy ERP:', err);
    process.exit(1);
  });
}
