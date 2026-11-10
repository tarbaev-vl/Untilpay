import { randomUUID } from 'node:crypto';
import { query, tx } from '../db.js';
import { createClient, toImportRows, BankError } from '../bank/enablebanking.js';

const DAY = 864e5;
const MAX_CONSENT_DAYS = 180;
const OVERLAP_DAYS = 7; // re-read a few days before the last sync: banks book transactions with a delay
const DEFAULT_ACCOUNT = 'Другое'; // "Other": the stored default value; the UI translates it for display
const idParam = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
const date = { type: 'string', format: 'date' };
const country = { type: 'string', pattern: '^[A-Za-z]{2}$' };
const isoDay = (d) => d.toISOString().slice(0, 10);

/** User-facing text of a bank error in the UI language */
function message(req, code, params = {}) {
  const p = { ...params, detail: params.detail ? `: ${params.detail}` : '' };
  return req.t(`bank.${code}`, p);
}
const ERR_STATUS = { rate: 429, expired: 409, period: 400, off: 503, key: 503, redirect_missing: 503 };
const fail = (req, reply, err) => {
  req.log.warn({ code: err.code, status: err.status, msg: err.message }, 'bank error');
  return reply.code(ERR_STATUS[err.code] || 502).send({ error: `bank_${err.code}`, message: message(req, err.code, err.params) });
};

/** App account of a bank: the standard account names for the known banks, otherwise the bank name itself */
const accountFor = (aspsp) => (/revolut/i.test(aspsp) ? 'Revolut' : /bank of cyprus/i.test(aspsp) ? 'Bank of Cyprus' : aspsp.slice(0, 100) || DEFAULT_ACCOUNT);

export default async function bank(app) {
  const auth = { preHandler: app.requireAuth };
  // Enable Banking client or a 503 with the reason it is not configured
  const client = (req, reply) => {
    const { client: c, error } = createClient();
    if (!c) { reply.code(503).send({ error: `bank_${error.code}`, message: message(req, error.code, error.params) }); return null; }
    return c;
  };

  // Whether bank sync is configured + connected banks with their accounts
  app.get('/api/bank', auth, async (req) => {
    const { error } = createClient();
    const { rows } = await query(
      `SELECT c.id::text, c.aspsp_name, c.aspsp_country, c.valid_until,
         coalesce(json_agg(json_build_object('id', a.id::text, 'name', a.name, 'iban_tail', a.iban_tail,
           'currency', a.currency, 'account', a.account, 'synced_to', a.synced_to) ORDER BY a.id)
           FILTER (WHERE a.id IS NOT NULL), '[]') AS accounts
       FROM bank_connections c LEFT JOIN bank_accounts a ON a.connection_id = c.id
       WHERE c.status = 'active' GROUP BY c.id ORDER BY c.id`,
    );
    return {
      configured: !error,
      // "off" is the normal state without setup: the UI shows instructions instead of an error
      error: error && error.code !== 'off' ? message(req, error.code, error.params) : null,
      connections: rows.map((c) => ({ ...c, expired: !c.valid_until || new Date(c.valid_until) <= new Date() })),
    };
  });

  // Banks of a country available for connecting
  app.get('/api/bank/aspsps', { ...auth, schema: { querystring: { type: 'object', required: ['country'], properties: { country } } } }, async (req, reply) => {
    const c = client(req, reply); if (!c) return reply;
    try {
      const list = await c.listAspsps(req.query.country.toUpperCase());
      return list.map((a) => a.name).sort((x, y) => x.localeCompare(y));
    } catch (err) { if (err instanceof BankError) return fail(req, reply, err); throw err; }
  });

  // Start connecting a bank: returns the bank page to send the browser to
  app.post('/api/bank/connect', {
    ...auth,
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    schema: { body: { type: 'object', required: ['aspsp', 'country'], additionalProperties: false, properties: { aspsp: { type: 'string', minLength: 1, maxLength: 200 }, country } } },
  }, async (req, reply) => {
    const c = client(req, reply); if (!c) return reply;
    const cc = req.body.country.toUpperCase();
    try {
      const found = (await c.listAspsps(cc)).find((a) => a.name === req.body.aspsp);
      // the bank caps the consent lifetime; a minute of slack so that the request is not rejected at the limit
      const maxSec = Math.min(found?.maximum_consent_validity || Infinity, MAX_CONSENT_DAYS * 86400) - 60;
      const state = randomUUID();
      await query(`DELETE FROM bank_connections WHERE status = 'pending' AND created_at < now() - interval '1 day'`);
      await query('INSERT INTO bank_connections (aspsp_name, aspsp_country, state) VALUES ($1, $2, $3)', [req.body.aspsp, cc, state]);
      const url = await c.startAuth({ aspsp: req.body.aspsp, country: cc, state, validUntil: new Date(Date.now() + maxSec * 1000) });
      return { url };
    } catch (err) { if (err instanceof BankError) return fail(req, reply, err); throw err; }
  });

  // The bank sends the browser back here. No session check: the strict session cookie is not sent on a
  // cross-site redirect, so the request is authorised by the one-time `state` created in /connect.
  app.get('/api/bank/callback', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    schema: { querystring: { type: 'object', properties: { code: { type: 'string', maxLength: 2000 }, state: { type: 'string', maxLength: 100 }, error: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const back = (result) => reply.redirect(`/?bank=${result}`);
    const { rows: [conn] } = await query(
      `SELECT id, aspsp_name, aspsp_country FROM bank_connections
       WHERE state = $1 AND status = 'pending' AND created_at > now() - interval '1 hour'`, [req.query.state || ''],
    );
    if (!conn) return back('error');
    if (req.query.error || !req.query.code) {
      await query('DELETE FROM bank_connections WHERE id = $1', [conn.id]);
      return back(req.query.error === 'access_denied' ? 'denied' : 'error');
    }
    const { client: c } = createClient();
    if (!c) return back('error');
    let session;
    try { session = await c.createSession(req.query.code); } catch (err) {
      if (!(err instanceof BankError)) throw err;
      req.log.warn({ code: err.code, msg: err.message }, 'bank session failed');
      await query('DELETE FROM bank_connections WHERE id = $1', [conn.id]);
      return back('error');
    }
    const old = await tx(async (db) => {
      // earlier connections to the same bank are replaced; their account mapping and sync date carry over
      const { rows: prev } = await db.query(
        `SELECT c.id, c.session_id, a.ident_hash, a.account, a.synced_to
         FROM bank_connections c LEFT JOIN bank_accounts a ON a.connection_id = c.id
         WHERE c.status = 'active' AND c.aspsp_name = $1 AND c.aspsp_country = $2`, [conn.aspsp_name, conn.aspsp_country],
      );
      await db.query(
        `UPDATE bank_connections SET status = 'active', state = NULL, session_id = $1, valid_until = $2 WHERE id = $3`,
        [session.session_id, session.access?.valid_until || null, conn.id],
      );
      for (const a of session.accounts || []) {
        const hash = a.identification_hash || '';
        const was = prev.find((p) => hash && p.ident_hash === hash);
        const iban = a.account_id?.iban || a.account_id?.other?.identification || '';
        await db.query(
          `INSERT INTO bank_accounts (connection_id, uid, ident_hash, name, iban_tail, currency, account, synced_to)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [conn.id, a.uid, hash, String(a.name || a.product || a.details || '').slice(0, 200), String(iban).slice(-4),
            a.currency || '', was?.account || accountFor(conn.aspsp_name), was?.synced_to || null],
        );
      }
      const ids = [...new Set(prev.map((p) => p.id))];
      if (ids.length) await db.query('DELETE FROM bank_connections WHERE id = ANY($1)', [ids]);
      return [...new Set(prev.map((p) => p.session_id).filter(Boolean))];
    });
    // close the replaced consents at the bank; failing to do so is harmless
    await Promise.all(old.map((id) => c.deleteSession(id).catch(() => {})));
    return back('connected');
  });

  // Which app account a bank account belongs to, and up to which date its transactions have been reviewed
  app.put('/api/bank/accounts/:id', {
    ...auth,
    schema: { params: idParam, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { account: { type: 'string', minLength: 1, maxLength: 100 }, synced_from: date, synced_to: date } } },
  }, async (req, reply) => {
    // synced_to (the reviewed range synced_from..synced_to) only moves forward and only without a gap:
    // a range starting after the last synced day would otherwise make "since the last sync" skip the days in between
    const { rowCount } = await query(
      `UPDATE bank_accounts SET account = coalesce($1, account),
         synced_to = CASE
           WHEN $3::date IS NULL THEN synced_to
           WHEN synced_to IS NULL OR $2::date IS NULL OR $2::date <= synced_to + 1 THEN greatest(synced_to, $3::date)
           ELSE synced_to END
       WHERE id = $4`,
      [req.body.account ?? null, req.body.synced_from ?? null, req.body.synced_to ?? null, req.params.id],
    );
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: req.t('bank.not_found') });
    return { ok: true };
  });

  app.delete('/api/bank/connections/:id', { ...auth, schema: { params: idParam } }, async (req, reply) => {
    const { rows: [conn] } = await query('DELETE FROM bank_connections WHERE id = $1 RETURNING session_id', [req.params.id]);
    if (!conn) return reply.code(404).send({ error: 'not_found', message: req.t('bank.not_found') });
    const { client: c } = createClient();
    if (c && conn.session_id) await c.deleteSession(conn.session_id).catch(() => {});
    return reply.code(204).send();
  });

  // Booked transactions of a bank account as rows for the import screen (/api/import/preview takes them as they are)
  app.get('/api/bank/transactions', {
    ...auth,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    schema: { querystring: { type: 'object', required: ['account_id'], properties: { account_id: { type: 'string', pattern: '^[0-9]+$' }, from: date, to: date } } },
  }, async (req, reply) => {
    const { rows: [acc] } = await query(
      `SELECT a.uid, a.account, a.synced_to, c.valid_until FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id
       WHERE a.id = $1 AND c.status = 'active'`, [req.query.account_id],
    );
    if (!acc) return reply.code(404).send({ error: 'not_found', message: req.t('bank.not_found') });
    const c = client(req, reply); if (!c) return reply;
    if (!acc.valid_until || new Date(acc.valid_until) <= new Date()) return fail(req, reply, new BankError('expired'));
    // The browser sends its local dates, which may already be "tomorrow" in UTC: one day of slack,
    // then both ends are capped at today in UTC (the bank API assumes UTC and rejects future dates)
    const utcToday = isoDay(new Date());
    const tomorrow = isoDay(new Date(Date.now() + DAY));
    const { from: qFrom, to: qTo } = req.query;
    if ((qTo && qTo > tomorrow) || (qFrom && qFrom > (qTo || tomorrow))) {
      return reply.code(400).send({ error: 'bank_period', message: message(req, 'period') });
    }
    const to = qTo && qTo < utcToday ? qTo : utcToday;
    let from = qFrom
      || isoDay(new Date((acc.synced_to ? Date.parse(`${acc.synced_to}T00:00:00Z`) - OVERLAP_DAYS * DAY : Date.now() - 30 * DAY)));
    if (from > to) from = to;
    try {
      const { rows, dropped } = toImportRows(await c.getTransactions(acc.uid, from, to));
      return { account: acc.account, from, to, rows: rows.slice(0, 5000), dropped };
    } catch (err) { if (err instanceof BankError) return fail(req, reply, err); throw err; }
  });
}
