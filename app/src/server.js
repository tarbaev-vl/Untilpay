import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import auth from './auth.js';
import { langOf, t } from './i18n.js';
import recurring from './routes/recurring.js';
import expenses from './routes/expenses.js';
import settings from './routes/settings.js';
import importRoutes from './routes/import.js';
import incomes from './routes/incomes.js';
import insights from './routes/insights.js';
import bank from './routes/bank.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function build(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL || 'info' },
    trustProxy: true, // behind nginx
    bodyLimit: 64 * 1024,
  });

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters long');

  // req.t(key, params): a message in the language selected in the UI (the `lang` cookie)
  app.decorateRequest('t', function translate(key, params) { return t(langOf(this), key, params); });

  // Readable errors for the frontend (set before the routes are registered so that plugins inherit it)
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ error: 'invalid', message: req.t('err.invalid'), details: err.message });
    // foreign key violation: the only reference the client sends is recurring_id
    if (err.code === '23503') return reply.code(400).send({ error: 'invalid', message: req.t('err.recurring_missing') });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: req.t('err.rate_limited') });
    req.log.error(err);
    return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500)
      .send({ error: 'server', message: req.t('err.server') });
  });

  await app.register(cookie, { secret });
  await app.register(rateLimit, { global: false });
  await app.register(auth);
  await app.register(recurring);
  await app.register(expenses);
  await app.register(settings);
  await app.register(importRoutes);
  await app.register(incomes);
  await app.register(insights);
  await app.register(bank);

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(fastifyStatic, { root: path.join(root, 'public'), index: 'index.html' });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await build();
  await migrate(app.log);
  const port = Number(process.env.PORT || 3000);
  await app.listen({ port, host: '0.0.0.0' });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      await app.close();
      await pool.end();
      process.exit(0);
    });
  }
}
