import { LlmProvider } from './base.js';

/** Providers with an OpenAI-compatible API: POST {baseUrl}/chat/completions */
export class OpenAICompatibleProvider extends LlmProvider {
  /** true — the provider accepts a JSON schema (response_format json_schema), otherwise json_object + the schema in the prompt */
  static jsonSchema = true;

  responseFormat(schema, name) {
    return this.constructor.jsonSchema
      ? { type: 'json_schema', json_schema: { name, schema, strict: true } }
      : { type: 'json_object' };
  }

  async complete({ system, prompt, schema, name }) {
    const sys = this.constructor.jsonSchema ? system : system + this.schemaHint(schema);
    const data = await this.postJson(`${this.baseUrl}/chat/completions`, {
      model: this.model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }],
      response_format: this.responseFormat(schema, name),
    }, { Authorization: `Bearer ${this.key}` });
    const choice = data?.choices?.[0];
    if (!choice) throw this.error('empty');
    if (choice.finish_reason === 'length') throw this.error('truncated');
    if (choice.finish_reason === 'content_filter' || choice.message?.refusal) {
      throw this.error('refusal');
    }
    return {
      text: choice.message?.content ?? '',
      model: data.model,
      usage: { input_tokens: data.usage?.prompt_tokens, output_tokens: data.usage?.completion_tokens },
    };
  }
}

export class OpenAIProvider extends OpenAICompatibleProvider {
  static id = 'openai';
  static label = 'OpenAI';
  static baseUrl = 'https://api.openai.com/v1';
  static defaultModel = 'gpt-5';
}

export class MistralProvider extends OpenAICompatibleProvider {
  static id = 'mistral';
  static label = 'Mistral';
  static baseUrl = 'https://api.mistral.ai/v1';
  static defaultModel = 'mistral-large-latest';
}

export class DeepSeekProvider extends OpenAICompatibleProvider {
  static id = 'deepseek';
  static label = 'DeepSeek';
  static baseUrl = 'https://api.deepseek.com/v1';
  static defaultModel = 'deepseek-chat';
  static jsonSchema = false;
}

export class OpenRouterProvider extends OpenAICompatibleProvider {
  static id = 'openrouter';
  static label = 'OpenRouter';
  static baseUrl = 'https://openrouter.ai/api/v1';
  static defaultModel = 'openai/gpt-5';
}

export class GroqProvider extends OpenAICompatibleProvider {
  static id = 'groq';
  static label = 'Groq';
  static baseUrl = 'https://api.groq.com/openai/v1';
  static defaultModel = 'llama-3.3-70b-versatile';
  static jsonSchema = false;
}

export class XaiProvider extends OpenAICompatibleProvider {
  static id = 'xai';
  static label = 'xAI Grok';
  static baseUrl = 'https://api.x.ai/v1';
  static defaultModel = 'grok-4';
}
