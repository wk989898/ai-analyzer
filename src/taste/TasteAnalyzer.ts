import fs from 'fs';
import path from 'path';
import { Conversation, DailySummary, TasteProfile } from '../types';
import { ConfigManager } from '../config/ConfigManager';

export class TasteAnalyzer {
  constructor(private config: ConfigManager) {}

  async analyze(newSummary: DailySummary, conversations: Conversation[]): Promise<TasteProfile | null> {
    const { outputDir, tasteDir } = this.config.get();
    const history = this.loadHistory(outputDir, 30);

    // Include current day's summary in the count
    const allSummaries = [...history, newSummary];
    if (allSummaries.length < 3) {
      console.log(`[TasteAnalyzer] Not enough history (${allSummaries.length}/3 days), skipping taste update`);
      return null;
    }

    const n = allSummaries.length;
    const prevProfile = this.loadLatestProfile(tasteDir);
    const apiKey = this.config.getApiKey('openai') ?? this.config.getApiKey('kiro');

    if (!apiKey) return this.fallbackProfile(allSummaries, conversations, prevProfile, n);

    try {
      const weighted = allSummaries.map((s, i) => ({ ...s, weight: (i + 1) / n }));
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `You are building a user taste profile that evolves over time.

${prevProfile ? `Previous profile (v${prevProfile.version}):\n${JSON.stringify(prevProfile)}\n\n` : ''}New conversation summaries (weight 1.0 = most recent, lower = older):
${JSON.stringify(weighted)}

Recent conversation excerpts (last 20 user messages):
${conversations.flatMap(c => c.messages.filter(m => m.role === 'user').map(m => m.content.slice(0, 200))).slice(-20).join('\n---\n')}

Merge the previous profile with new evidence. Extract:
- techPreferences: technologies/tools/languages the user works with (array, max 15)
- communicationStyle: how the user communicates (language preference, verbosity, style) (array, max 10)
- workDomains: primary work domains (array, max 5)
- otherInsights: other notable patterns inferred from conversations (array, max 5)

Respond in JSON only.`,
          }],
        }),
      });

      const data: any = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      const version = this.getNextVersion(tasteDir);
      return { version, updatedAt: new Date().toISOString(), ...parsed };
    } catch (e) {
      console.warn('[TasteAnalyzer] LLM call failed, using fallback:', e);
      return this.fallbackProfile(allSummaries, conversations, prevProfile, n);
    }
  }

  saveVersion(profile: TasteProfile): void {
    const { tasteDir } = this.config.get();
    fs.mkdirSync(tasteDir, { recursive: true });
    const content = this.toMarkdown(profile);
    fs.writeFileSync(path.join(tasteDir, `taste-v${profile.version}.md`), content);
    fs.writeFileSync(path.join(tasteDir, 'taste.md'), content);
  }

  injectToSteering(profile: TasteProfile): void {
    const { steeringDir } = this.config.get();
    fs.mkdirSync(steeringDir, { recursive: true });
    fs.writeFileSync(path.join(steeringDir, 'taste.md'), this.toMarkdown(profile));
  }

  // Load previous taste profile to merge with new data
  private loadLatestProfile(tasteDir: string): TasteProfile | null {
    const latest = path.join(tasteDir, 'taste.md');
    if (!fs.existsSync(latest)) return null;
    try {
      const content = fs.readFileSync(latest, 'utf-8');
      const versionMatch = content.match(/version: (\d+)/);
      const updatedMatch = content.match(/updated: ([^\s]+)/);
      const parseSection = (header: string) =>
        [...content.matchAll(new RegExp(`## ${header}\\n([\\s\\S]+?)(?=\\n##|$)`, 'g'))]
          .flatMap(m => m[1].split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)));
      return {
        version: versionMatch ? parseInt(versionMatch[1]) : 1,
        updatedAt: updatedMatch?.[1] ?? '',
        techPreferences: parseSection('Tech Preferences'),
        communicationStyle: parseSection('Communication Style'),
        workDomains: parseSection('Work Domains'),
        otherInsights: parseSection('Other Insights'),
      };
    } catch { return null; }
  }

  private fallbackProfile(
    summaries: DailySummary[],
    conversations: Conversation[],
    prev: TasteProfile | null,
    n: number,
  ): TasteProfile {
    // Extract keywords from actual conversation text
    const userMessages = conversations
      .flatMap(c => c.messages.filter(m => m.role === 'user').map(m => m.content));
    const allText = userMessages.join(' ');
    const words = allText.toLowerCase().match(/\b[a-z][a-z0-9_-]{2,}\b/g) ?? [];

    // Filter out common stop words
    const stopWords = new Set(['the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','day','get','has','him','his','how','its','may','new','now','old','see','two','way','who','did','let','put','say','she','too','use','that','this','with','have','from','they','will','been','were','said','each','which','their','there','would','about','could','other','into','than','then','when','what','some','more','also','just','like','make','over','such','take','than','them','well','your']);
    const techWords = words.filter(w => !stopWords.has(w) && w.length > 2);

    const freq = (arr: string[]) => {
      const map: Record<string, number> = {};
      for (const w of arr) map[w] = (map[w] ?? 0) + 1;
      return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([w]) => w);
    };

    const newKeywords = freq(techWords).slice(0, 15);
    const newDomains = freq(summaries.flatMap(s => s.domains)).slice(0, 5);

    // Merge with previous profile: combine and deduplicate, keeping new items first
    const merge = (newItems: string[], prevItems: string[], limit: number) =>
      [...new Set([...newItems, ...(prevItems ?? [])])].slice(0, limit);

    const version = this.getNextVersion(this.config.get().tasteDir);
    return {
      version,
      updatedAt: new Date().toISOString(),
      techPreferences: merge(newKeywords, prev?.techPreferences ?? [], 15),
      communicationStyle: prev?.communicationStyle ?? [],
      workDomains: merge(newDomains, prev?.workDomains ?? [], 5),
      otherInsights: [`Based on ${n} days of conversation history (keyword analysis)`],
    };
  }

  private loadHistory(outputDir: string, days: number): DailySummary[] {
    if (!fs.existsSync(outputDir)) return [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const results: DailySummary[] = [];

    for (const file of fs.readdirSync(outputDir)) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match || new Date(match[1]) < cutoff) continue;
      try {
        const content = fs.readFileSync(path.join(outputDir, file), 'utf-8');
        const parseList = (raw: string | undefined) =>
          raw && raw !== 'N/A' ? raw.split(', ').filter(Boolean) : [];
        const countMatch = content.match(/\*\*Conversations\*\*: (\d+)/);
        if (!countMatch || parseInt(countMatch[1]) === 0) continue;
        results.push({
          date: match[1],
          topics: parseList(content.match(/\*\*Topics\*\*: (.+)/)?.[1]),
          keywords: parseList(content.match(/\*\*Keywords\*\*: (.+)/)?.[1]),
          domains: parseList(content.match(/\*\*Domains\*\*: (.+)/)?.[1]),
          conversationCount: parseInt(countMatch[1]),
          briefSummary: content.match(/## Summary\n+([\s\S]+?)(?:\n##|$)/)?.[1].trim() ?? '',
        });
      } catch { /* skip */ }
    }
    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  private getNextVersion(tasteDir: string): number {
    if (!fs.existsSync(tasteDir)) return 1;
    const versions = fs.readdirSync(tasteDir)
      .map(f => f.match(/^taste-v(\d+)\.md$/))
      .filter(Boolean)
      .map(m => parseInt(m![1]));
    return versions.length > 0 ? Math.max(...versions) + 1 : 1;
  }

  private toMarkdown(profile: TasteProfile): string {
    return `# User Taste Profile
<!-- version: ${profile.version} | updated: ${profile.updatedAt} -->

## Tech Preferences
${profile.techPreferences.map(t => `- ${t}`).join('\n')}

## Communication Style
${profile.communicationStyle.map(s => `- ${s}`).join('\n')}

## Work Domains
${profile.workDomains.map(d => `- ${d}`).join('\n')}

## Other Insights
${profile.otherInsights.map(i => `- ${i}`).join('\n')}
`;
  }
}
