import { Injectable, Logger } from '@nestjs/common';

/**
 * Optional LLM client for the AI Assistant's narrative tasks. Reads provider/key
 * from the environment and is a graceful no-op when unconfigured — every AI
 * capability still works on heuristics alone; the LLM only *enriches* output.
 *
 *   AI_PROVIDER  = anthropic | openai        (default: anthropic if key present)
 *   AI_API_KEY   = <key>
 *   AI_MODEL     = model id (sensible default per provider)
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger('LlmService');
  private readonly provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  private readonly apiKey = process.env.AI_API_KEY || '';
  private readonly model =
    process.env.AI_MODEL ||
    (this.provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-haiku-latest');

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  status(): { enabled: boolean; provider: string; model: string } {
    return { enabled: this.isEnabled(), provider: this.provider, model: this.model };
  }

  /** Return the model's text, or null if disabled/failed (caller falls back). */
  async complete(system: string, user: string, maxTokens = 700): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      return this.provider === 'openai'
        ? await this.openai(system, user, maxTokens)
        : await this.anthropic(system, user, maxTokens);
    } catch (e: any) {
      this.log.warn(`LLM call failed (${this.provider}): ${e.message}`);
      return null;
    }
  }

  private async anthropic(system: string, user: string, maxTokens: number): Promise<string | null> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    return json?.content?.[0]?.text ?? null;
  }

  private async openai(system: string, user: string, maxTokens: number): Promise<string | null> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content ?? null;
  }
}
