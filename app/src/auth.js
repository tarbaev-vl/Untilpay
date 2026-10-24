import { timingSafeEqual, createHash } from 'node:crypto';

const COOKIE = 'budget_session';
const TTL_DAYS = Number(process.env.SESSION_DAYS || 30);

const sha = (s) => createHash('sha256').update(String(s)).digest();
const passwordOk = (given, expected) => timingSafeEqual(sha(given), sha(expected));

/**
 * Простая авторизация одним паролем (APP_PASSWORD).
 * Сессия — подписанная httpOnly-кука со сроком действия.
 */
// Плагин без инкапсуляции: requireAuth виден всем маршрутам
auth[Symbol.for('skip-override')] = true;

export default async function auth(app) {
  const password = process.env.APP_PASSWORD || '';
  const secure = process.env.COOKIE_SECURE === 'true';
  if (!password) app.log.warn('APP_PASSWORD не задан — вход без пароля!');

  const isAuthed = (req) => {
    if (!password) return true;
    const raw = req.cookies[COOKIE];
    if (!raw) return false;
    const r = req.unsignCookie(raw);
    return r.valid && Number(r.value) > Date.now();
  };

  app.decorate('requireAuth', async (req, reply) => {
    if (!isAuthed(req)) return reply.code(401).send({ error: 'unauthorized', message: 'Нужно войти' });
  });

  app.post('/api/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      body: {
        type: 'object', required: ['password'], additionalProperties: false,
        properties: { password: { type: 'string', maxLength: 500 } },
      },
    },
  }, async (req, reply) => {
    if (password && !passwordOk(req.body.password, password)) {
      return reply.code(401).send({ error: 'bad_password', message: 'Неверный пароль' });
    }
    const exp = Date.now() + TTL_DAYS * 864e5;
    reply.setCookie(COOKIE, String(exp), {
      signed: true, httpOnly: true, sameSite: 'strict', secure, path: '/',
      maxAge: TTL_DAYS * 86400,
    });
    return { ok: true };
  });

  app.post('/api/logout', async (req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ authed: isAuthed(req), passwordRequired: Boolean(password) }));
}
