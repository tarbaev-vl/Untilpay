import Anthropic from '@anthropic-ai/sdk';
import { LlmProvider } from './base.js';

/** Claude through the official Anthropic SDK */
export class AnthropicProvider extends LlmProvider {
  static id = 'anthropic';
  static label = 'Claude';
  static baseUrl = ''; // empty — the SDK default address
  static defaultModel = 'claude-opus-5-5';

  async complete({ system, prompt, schema }) {
    const client = new Anthropic({ apiKey: this.key, timeout: this.timeout, ...(this.baseUrl ? { baseURL: this.baseUrl } : {}) });
    let response;
    try {
      response = await client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        // if the safety classifier declines by mistake, the request is retried on a suitable model automatically
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      // the most specific SDK classes first
      if (err instanceof Anthropic.APIConnectionError) throw this.error(err instanceof Anthropic.APIConnectionTimeoutError ? 'timeout' : 'conn');
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw this.error('auth', {}, err.status);
      }
      if (err instanceof Anthropic.RateLimitError) throw this.error('rate', {}, err.status);
      if (err instanceof Anthropic.APIError) throw this.error('api', { status: err.status, detail: err.message.slice(0, 200) }, err.status);
      throw err;
    }
    if (response.stop_reason === 'refusal') throw this.error('refusal');
    if (response.stop_reason === 'max_tokens') throw this.error('truncated');
    return {
      text: response.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
      model: response.model,
      usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    };
  }
}
