import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider, MistralProvider, DeepSeekProvider, OpenRouterProvider, GroqProvider, XaiProvider } from './openai-compatible.js';
import { GeminiProvider } from './gemini.js';
import { OllamaProvider } from './ollama.js';

export { LlmError } from './base.js';

// A new LLM: a subclass of LlmProvider (or OpenAICompatibleProvider) + a line here
export const PROVIDERS = Object.fromEntries([
  AnthropicProvider, OpenAIProvider, GeminiProvider, MistralProvider, DeepSeekProvider,
  OpenRouterProvider, GroqProvider, XaiProvider, OllamaProvider,
].map((P) => [P.id, P]));

/** Provider by LLM_PROVIDER; null — not set or unknown */
export function createProvider(env = process.env) {
  const P = PROVIDERS[String(env.LLM_PROVIDER || '').trim().toLowerCase()];
  return P ? new P({ key: env.LLM_KEY || '', model: env.LLM_MODEL || '', baseUrl: env.LLM_BASE_URL || '' }) : null;
}

/** For the UI: whether AI is configured and with what. error is { code, params } for req.t(`ai.${code}`, params) */
export function providerStatus(env = process.env) {
  const name = String(env.LLM_PROVIDER || '').trim();
  const p = createProvider(env);
  if (!p) {
    return {
      configured: false, provider: null, model: null,
      error: name ? { code: 'unknown_provider', params: { name, list: Object.keys(PROVIDERS).join(', ') } } : null,
    };
  }
  return {
    configured: p.configured, provider: p.label, model: p.model, local: p.id === 'ollama',
    error: p.configured ? null : { code: 'key_needed', params: { provider: p.label } },
  };
}
