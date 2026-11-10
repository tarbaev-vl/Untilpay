// Shared contract for LLM providers: a subclass sets the provider settings and implements complete()

/**
 * Error from any provider. code: auth | rate | conn | timeout | api | empty | refusal | truncated | json.
 * The user-facing text is built from code + params in the selected UI language (see routes/insights.js);
 * message is English and only goes to the logs.
 */
export class LlmError extends Error {
  constructor(code, params = {}, status) {
    super(`${params.provider || 'LLM'}: ${code}${params.detail ? ` (${params.detail})` : ''}`);
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

const TIMEOUT_MS = 120_000;

export class LlmProvider {
  static id = '';
  static label = '';
  static baseUrl = '';
  static defaultModel = '';
  static needsKey = true;

  constructor({ key = '', model = '', baseUrl = '' } = {}) {
    const C = this.constructor;
    this.key = key;
    this.model = model || C.defaultModel;
    this.baseUrl = (baseUrl || C.baseUrl).replace(/\/+$/, '');
    this.timeout = TIMEOUT_MS;
  }

  get id() { return this.constructor.id; }
  get label() { return this.constructor.label; }
  get configured() { return !this.constructor.needsKey || Boolean(this.key); }

  /** LlmError for this provider */
  error(code, params = {}, status) {
    return new LlmError(code, { provider: this.label, ...params }, status);
  }

  /**
   * A request answered strictly in JSON. Subclasses implement complete(), which returns
   * { text, model, usage: { input_tokens, output_tokens } }.
   */
  async generateJson({ system, prompt, schema, name }) {
    const res = await this.complete({ system, prompt, schema, name });
    return { data: this.parseJson(res.text), model: res.model || this.model, usage: res.usage || {} };
  }

  // eslint-disable-next-line no-unused-vars
  async complete({ system, prompt, schema, name }) {
    throw new Error(`${this.constructor.name}.complete() is not implemented`);
  }

  /** JSON from the reply; some models wrap it in ```json … ``` */
  parseJson(text) {
    const s = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(s); } catch {
      throw this.error('json');
    }
  }

  /** Schema hint for providers that do not accept a JSON schema directly */
  schemaHint(schema) {
    return `\n\nReply with a single JSON object only, no explanations and no markdown, strictly following this JSON schema:\n${JSON.stringify(schema)}`;
  }

  /** POST with a JSON body and a timeout; HTTP errors become LlmError */
  async postJson(url, body, headers = {}) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      throw err.name === 'TimeoutError' ? this.error('timeout') : this.error('conn', { detail: err.message });
    }
    const data = await res.json().catch(() => null);
    if (res.ok) return data;
    const detail = data?.error?.message || data?.message || data?.error || '';
    if (res.status === 401 || res.status === 403) throw this.error('auth', {}, res.status);
    if (res.status === 429) throw this.error('rate', {}, res.status);
    throw this.error('api', { status: res.status, detail: detail ? String(detail).slice(0, 200) : '' }, res.status);
  }
}
