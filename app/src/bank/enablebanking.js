// Enable Banking client (https://enablebanking.com/docs/api/reference/): account information only.
// Works in the "own linked accounts" mode: the application and the accounts are set up in their control panel.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_URL = 'https://api.enablebanking.com';
const TIMEOUT_MS = 60_000;
const TOKEN_TTL = 3600; // seconds; the API accepts up to 24 hours
const MAX_PAGES = 50;
const LIMIT = 500; // the description in the database is up to 500 characters

/**
 * Bank sync error. code: auth | redirect | expired | rate | conn | timeout | api.
 * The user-facing text is built from code + params in the UI language (see routes/bank.js).
 */
export class BankError extends Error {
  constructor(code, params = {}, status) {
    super(`bank: ${code}${params.detail ? ` (${params.detail})` : ''}`);
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** RS256 JWT that authorises a request: kid is the application id */
export function signJwt(appId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const head = b64({ typ: 'JWT', alg: 'RS256', kid: appId });
  const body = b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + TOKEN_TTL });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

const EXPIRED = new Set(['EXPIRED_SESSION', 'CLOSED_SESSION', 'REVOKED_SESSION', 'WRONG_SESSION_STATUS']);

export class EnableBanking {
  constructor({ appId, privateKey, redirectUrl, baseUrl = BASE_URL }) {
    this.appId = appId;
    this.privateKey = privateKey;
    this.redirectUrl = redirectUrl;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async request(method, path, body) {
    let res;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${signJwt(this.appId, this.privateKey)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw err.name === 'TimeoutError' ? new BankError('timeout') : new BankError('conn', { detail: err.message });
    }
    const data = await res.json().catch(() => null);
    if (res.ok) return data;
    const detail = String(data?.message || data?.error || '').slice(0, 200);
    if (EXPIRED.has(data?.error)) throw new BankError('expired', {}, res.status);
    if (data?.error === 'REDIRECT_URI_NOT_ALLOWED') throw new BankError('redirect', { url: this.redirectUrl }, res.status);
    if (res.status === 429 || data?.error === 'ASPSP_RATE_LIMIT_EXCEEDED') throw new BankError('rate', {}, res.status);
    if (res.status === 401 || res.status === 403) throw new BankError('auth', { detail }, res.status);
    throw new BankError('api', { status: res.status, detail }, res.status);
  }

  /** Banks of a country: [{ name, country, maximum_consent_validity (seconds), … }] */
  async listAspsps(country) {
    const data = await this.request('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal&service=AIS`);
    return data?.aspsps || [];
  }

  /** Starts the consent flow; returns the bank page the user has to be sent to */
  async startAuth({ aspsp, country, state, validUntil }) {
    const data = await this.request('POST', '/auth', {
      access: { valid_until: validUntil.toISOString(), balances: false, transactions: true },
      aspsp: { name: aspsp, country },
      state,
      redirect_url: this.redirectUrl,
      psu_type: 'personal',
    });
    return data.url;
  }

  /** Exchanges the code from the redirect for a session: { session_id, accounts, access: { valid_until } } */
  createSession(code) { return this.request('POST', '/sessions', { code }); }

  deleteSession(sessionId) { return this.request('DELETE', `/sessions/${encodeURIComponent(sessionId)}`); }

  /** All transactions of an account since dateFrom ('YYYY-MM-DD'), following continuation keys */
  async getTransactions(uid, dateFrom) {
    const out = [];
    let key = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ date_from: dateFrom });
      if (key) qs.set('continuation_key', key);
      const data = await this.request('GET', `/accounts/${encodeURIComponent(uid)}/transactions?${qs}`);
      out.push(...(data?.transactions || []));
      key = data?.continuation_key;
      if (!key) break;
    }
    return out;
  }
}

/**
 * Client from the environment. Returns { client } or { error: { code, params } }:
 * off — EB_APP_ID is not set, key — the private key file cannot be read.
 */
export function createClient(env = process.env) {
  const appId = String(env.EB_APP_ID || '').trim();
  if (!appId) return { error: { code: 'off', params: {} } };
  const file = env.EB_PRIVATE_KEY_FILE || '/run/secrets/enablebanking.pem';
  const redirectUrl = String(env.EB_REDIRECT_URL || '').trim();
  if (!redirectUrl) return { error: { code: 'redirect_missing', params: {} } };
  let privateKey;
  try { privateKey = readFileSync(file, 'utf8'); } catch { return { error: { code: 'key', params: { file } } }; }
  return { client: new EnableBanking({ appId, privateKey, redirectUrl, baseUrl: env.EB_BASE_URL || BASE_URL }) };
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Enable Banking transactions -> rows of the import screen { date, datetime, amount (>0), original, kind },
 * the same shape csv.js produces. Only booked EUR transactions; the rest is counted in dropped.
 */
export function toImportRows(transactions) {
  const dropped = { pending: 0, currency: 0, bad: 0 };
  const rows = [];
  for (const tx of transactions) {
    if (tx.status && tx.status !== 'BOOK') { dropped.pending += 1; continue; }
    if (tx.transaction_amount?.currency !== 'EUR') { dropped.currency += 1; continue; }
    const amount = Math.round(Math.abs(Number(tx.transaction_amount.amount)) * 100) / 100;
    const date = tx.booking_date || tx.value_date || tx.transaction_date;
    if (!(amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) { dropped.bad += 1; continue; }
    const income = tx.credit_debit_indicator === 'CRDT';
    // the other side of the payment plus the payment details, without repeating one inside the other
    const party = clean(income ? tx.debtor?.name : tx.creditor?.name);
    const info = clean((tx.remittance_information || []).join(' '));
    const lp = party.toLowerCase(), li = info.toLowerCase();
    const text = !party || li.includes(lp) ? info : !info || lp.includes(li) ? party : `${party} · ${info}`;
    const original = text || clean(tx.bank_transaction_code?.description) || clean(tx.note) || '(no description)';
    rows.push({ date, datetime: '', amount, original: original.slice(0, LIMIT), kind: income ? 'income' : 'expense' });
  }
  return { rows, dropped };
}
