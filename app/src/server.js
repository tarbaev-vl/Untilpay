import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import auth from './auth.js';
import recurring from './routes/recurring.js';
import expenses from './routes/expenses.js';
import settings from './routes/settings.js';
import importRoutes from './routes/import.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function build(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? { level: process.env.LOG_LEVEL || 'info' },
    trustProxy: true, // за nginx
    bodyLimit: 64 * 1024,
  });

  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET должен быть не короче 32 символов');

  // Понятные ошибки для фронтенда (до регистрации маршрутов, чтобы плагины его унаследовали)
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) return reply.code(400).send({ error: 'invalid', message: 'Проверьте поля формы', details: err.message });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Слишком много попыток, подождите минуту' });
    req.log.error(err);
    return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500)
      .send({ error: 'server', message: 'Ошибка сервера' });
  });

  await app.register(cookie, { secret });
  await app.register(rateLimit, { global: false });
  await app.register(auth);
  await app.register(recurring);
  await app.register(expenses);
  await app.register(settings);
  await app.register(importRoutes);

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
