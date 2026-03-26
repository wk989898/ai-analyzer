import { Conversation, DailySummary } from '../types';
import { ConfigManager } from '../config/ConfigManager';

export class ConversationSummarizer {
  constructor(private config: ConfigManager) {}

  async summarize(conversations: Conversation[]): Promise<DailySummary> {
    const date = conversations[0]?.date ?? new Date().toISOString().slice(0, 10);
    const valid = conversations.filter(c => c.messages.length >= 2);

    if (valid.length === 0) {
      return { date, topics: [], keywords: [], domains: [], conversationCount: 0, briefSummary: '' };
    }

    const apiKey = this.config.getApiKey('openai') ?? this.config.getApiKey('kiro');
    if (!apiKey) return this.fallbackSummary(date, valid);

    try {
      const payload = valid.map(c => ({
        tool: c.tool,
        messages: c.messages.map(m => ({ role: m.role, content: m.content.slice(0, 500) })),
      }));

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `Analyze these AI agent conversations from ${date}. Extract:
- topics: main topics (array, max 10)
- keywords: technical keywords (array, max 20)
- domains: work domains from [cloud, frontend, backend, ai/ml, devops, data, other] (array)
- briefSummary: 2-3 sentence summary in the same language as the conversations

Conversations: ${JSON.stringify(payload)}

Respond in JSON only.`,
          }],
        }),
      });

      const data: any = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      return { date, conversationCount: valid.length, ...parsed };
    } catch {
      return this.fallbackSummary(date, valid);
    }
  }

  private fallbackSummary(date: string, conversations: Conversation[]): DailySummary {
    const allText = conversations.flatMap(c => c.messages.map(m => m.content)).join(' ');
    const words = allText.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    const freq: Record<string, number> = {};
    for (const w of words) freq[w] = (freq[w] ?? 0) + 1;
    const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([w]) => w);
    return { date, topics: [], keywords, domains: [], conversationCount: conversations.length, briefSummary: `${conversations.length} conversations on ${date}.` };
  }
}
