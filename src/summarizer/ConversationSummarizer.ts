import { execSync } from 'child_process';
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

    const payload = valid.map(c => ({
      tool: c.tool,
      // Limit to first 5 user messages per conversation to keep payload small
      messages: c.messages
        .filter(m => m.role === 'user')
        .slice(0, 5)
        .map(m => m.content.slice(0, 200)),
    })).slice(0, 10); // max 10 conversations

    const prompt = `This is a text analysis task, NOT a coding task. Do NOT write or modify any files.

Analyze these AI agent conversations from ${date}. Output ONLY valid JSON, nothing else:
{
  "topics": ["main topics discussed (max 5)"],
  "keywords": ["technical keywords (max 10)"],
  "domains": ["work domains from: cloud, frontend, backend, ai/ml, devops, linux, data, other"],
  "briefSummary": "2-3 sentence summary in the same language as the conversations"
}

Conversations: ${JSON.stringify(payload)}`;

    const result = this.callCodex(prompt);
    if (result) {
      try {
        const parsed = JSON.parse(result);
        return { date, conversationCount: valid.length, ...parsed };
      } catch { /* fallback */ }
    }

    return this.fallbackSummary(date, valid);
  }

  private callCodex(prompt: string): string | null {
    try {
      const out = execSync(`echo ${JSON.stringify(prompt)} | codex exec --skip-git-repo-check`, {
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const match = out.match(/\{[\s\S]+\}/);
      return match ? match[0] : null;
    } catch { return null; }
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
