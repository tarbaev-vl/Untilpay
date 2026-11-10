import { LlmProvider } from './base.js';

/** Google Gemini: POST {baseUrl}/models/{model}:generateContent */
export class GeminiProvider extends LlmProvider {
  static id = 'gemini';
  static label = 'Gemini';
  static baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  static defaultModel = 'gemini-2.5-pro';

  async complete({ system, prompt, schema }) {
    const data = await this.postJson(`${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`, {
      systemInstruction: { parts: [{ text: system + this.schemaHint(schema) }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }, { 'x-goog-api-key': this.key });
    const cand = data?.candidates?.[0];
    if (!cand) {
      if (data?.promptFeedback?.blockReason) throw this.error('refusal');
      throw this.error('empty');
    }
    if (cand.finishReason === 'MAX_TOKENS') throw this.error('truncated');
    if (cand.finishReason === 'SAFETY') throw this.error('refusal');
    return {
      text: (cand.content?.parts || []).map((p) => p.text || '').join(''),
      model: data.modelVersion || this.model,
      usage: { input_tokens: data.usageMetadata?.promptTokenCount, output_tokens: data.usageMetadata?.candidatesTokenCount },
    };
  }
}
