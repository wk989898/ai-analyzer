import { Conversation, TokenSummary, TokenData } from '../types';
import { ConfigManager } from '../config/ConfigManager';

export class TokenCollector {
  constructor(private config: ConfigManager) {}

  async collect(date: string, conversations: Conversation[]): Promise<TokenSummary> {
    const byTool: Record<string, TokenData> = {};

    // Aggregate from local conversations
    for (const c of conversations.filter(c => c.date === date)) {
      if (!byTool[c.tool]) byTool[c.tool] = { input: 0, output: 0 };
      byTool[c.tool].input += c.tokenUsage.input;
      byTool[c.tool].output += c.tokenUsage.output;
    }

    // Supplement with API data (best-effort)
    const cfg = this.config.get();
    for (const tool of Object.keys(cfg.apiKeys)) {
      try {
        const apiData = await this.fetchFromAPI(tool, date);
        if (!byTool[tool]) {
          byTool[tool] = apiData;
        } else {
          // Take max of local vs API (BR-02)
          byTool[tool].input = Math.max(byTool[tool].input, apiData.input);
          byTool[tool].output = Math.max(byTool[tool].output, apiData.output);
        }
      } catch {
        console.warn(`[TokenCollector] API fetch failed for ${tool}, using local data`);
      }
    }

    const total = Object.values(byTool).reduce(
      (acc, v) => ({ input: acc.input + v.input, output: acc.output + v.output }),
      { input: 0, output: 0 }
    );

    return { date, byTool, total };
  }

  private async fetchFromAPI(tool: string, date: string): Promise<TokenData> {
    // OpenAI usage API example — extend per tool
    if (tool === 'openai' || tool === 'codex') {
      const key = this.config.getApiKey(tool);
      if (!key) throw new Error('No API key');
      const res = await fetch(`https://api.openai.com/v1/usage?date=${date}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: any = await res.json();
      return {
        input: data.data?.reduce((s: number, d: any) => s + (d.n_context_tokens_total ?? 0), 0) ?? 0,
        output: data.data?.reduce((s: number, d: any) => s + (d.n_generated_tokens_total ?? 0), 0) ?? 0,
      };
    }
    throw new Error(`No API implementation for ${tool}`);
  }
}
