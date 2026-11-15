/**
 * OpenAI-compatible chat transport (ADR 0010 §1).
 *
 * The second `ModelTransport` implementation: talks to any endpoint that
 * speaks the OpenAI chat-completions envelope — OpenRouter, DeepSeek,
 * Moonshot, a local Ollama (`http://localhost:11434/v1`), etc. All wire
 * assumptions live in this one class so an endpoint change touches nothing
 * else.
 *
 * Configuration is plain constructor options; the assembly layer
 * (`scripts/build-real.mjs`) maps env vars onto them:
 *   MODEL_ROUTER_BASE_URL   e.g. https://openrouter.ai/api/v1
 *   MODEL_ROUTER_API_KEY    sent as Bearer
 */

import {
  RouterTransportError,
  type ModelTransport,
  type TransportCall,
  type TransportResult,
} from './transport.js';

export interface OpenAiHttpTransportOptions {
  /** Base URL of the OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1. */
  readonly baseUrl: string;
  /** Bearer token; required by hosted endpoints, optional for local ones. */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface WireChatCompletion {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiHttpTransport implements ModelTransport {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: OpenAiHttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(call: TransportCall): Promise<TransportResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: call.model,
        messages: [{ role: 'user', content: call.prompt }],
        ...(call.maxTokens !== undefined ? { max_tokens: call.maxTokens } : {}),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new RouterTransportError(
        `OpenAI-compatible endpoint answered HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        res.status,
      );
    }

    const payload = (await res.json()) as WireChatCompletion;
    const text = payload.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new RouterTransportError('endpoint returned no completion content');
    }
    return {
      text,
      model: payload.model ?? call.model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
    };
  }
}
