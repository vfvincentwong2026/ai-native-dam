/**
 * Transport seam for the model router (ADR 0010 §1).
 *
 * The router itself never touches the network: it maps tiers to models,
 * enforces run budgets, and records every call. The actual LLM egress lives
 * behind `ModelTransport` — injectable, so tests run fully offline and the
 * OpenSquilla SquillaRouter is just one implementation.
 */

/** OpenSquilla C0–C3 tiering (ADR 0010 §6). */
export type ModelTier = 'C0' | 'C1' | 'C2' | 'C3';

export interface TransportCall {
  /** Concrete model the tier resolved to. */
  readonly model: string;
  readonly tier: ModelTier;
  readonly prompt: string;
  readonly maxTokens?: number;
}

export interface TransportResult {
  readonly text: string;
  /** Model that actually served the call (the router may substitute). */
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelTransport {
  complete(call: TransportCall): Promise<TransportResult>;
}

/** Transport-level failure (HTTP error, malformed payload, ...). */
export class RouterTransportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'RouterTransportError';
  }
}

export interface SquillaHttpTransportOptions {
  /** SquillaRouter base URL, e.g. http://localhost:4000 (ROUTER_BASE_URL). */
  readonly baseUrl: string;
  /** ROUTER_API_KEY; sent as Bearer when set. */
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
}

interface WireCompletion {
  text?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * OpenSquilla SquillaRouter over HTTP. Wire shape is the OpenAI-ish
 * completion envelope SquillaRouter exposes; keep every wire assumption in
 * this class so a router upgrade touches exactly one file.
 */
export class SquillaHttpTransport implements ModelTransport {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SquillaHttpTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(call: TransportCall): Promise<TransportResult> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    const res = await this.fetchImpl(`${this.baseUrl}/v1/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: call.model,
        tier: call.tier,
        prompt: call.prompt,
        ...(call.maxTokens !== undefined ? { max_tokens: call.maxTokens } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new RouterTransportError(
        `SquillaRouter answered HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
        res.status,
      );
    }

    const payload = (await res.json()) as WireCompletion;
    if (typeof payload.text !== 'string') {
      throw new RouterTransportError('SquillaRouter returned no completion text');
    }
    return {
      text: payload.text,
      model: payload.model ?? call.model,
      inputTokens: payload.usage?.input_tokens ?? 0,
      outputTokens: payload.usage?.output_tokens ?? 0,
    };
  }
}
