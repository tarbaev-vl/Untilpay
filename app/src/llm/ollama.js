import { LlmProvider } from './base.js';

/** A local model through Ollama: POST {baseUrl}/api/chat, no key needed */
export class OllamaProvider extends LlmProvider {
  static id = 'ollama';
  static label = 'Ollama';
  static baseUrl = 'http://host.docker.internal:11434';
  static defaultModel = 'llama3.1';
  static needsKey = false;

  async complete({ system, prompt, schema }) {
    const data = await this.postJson(`${this.baseUrl}/api/chat`, {
      model: this.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      format: schema, // Ollama constrains the reply to the JSON schema itself
      stream: false,
    }, this.key ? { Authorization: `Bearer ${this.key}` } : {});
    if (data?.done_reason === 'length') throw this.error('truncated');
    return {
      text: data?.message?.content ?? '',
      model: data?.model || this.model,
      usage: { input_tokens: data?.prompt_eval_count, output_tokens: data?.eval_count },
    };
  }
}
