import fs from 'fs';
import path from 'path';
import { DailySummary, TasteProfile } from '../types';
import { ConfigManager } from '../config/ConfigManager';

export class TasteAnalyzer {
  constructor(private config: ConfigManager) {}

  async analyze(newSummary: DailySummary): Promise<TasteProfile | null> {
    const { outputDir, tasteDir } = this.config.get();
    const history = this.loadHistory(outputDir, 30);

    if (history.length < 3) {
      console.log('[TasteAnalyzer] Not enough history (need 3+ days), skipping taste update');
      return null;
    }

    const allSummaries = [...history, newSummary];
    const n = allSummaries.length;
    const weighted = allSummaries.map((s, i) => ({ ...s, weight: (i + 1) / n }));

    const apiKey = this.config.getApiKey('openai') ?? this.config.getApiKey('kiro');
    if (!apiKey) return null;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `Based on these weighted conversation summaries (weight 1.0 = most recent), analyze the user's preferences.

Summaries: ${JSON.stringify(weighted)}

Extract:
- techPreferences: technologies/tools/languages used frequently (array, max 15)
- communicationStyle: style characteristics (array, max 10)
- workDomains: primary work domains (array, max 5)
- otherInsights: other notable patterns (array, max 5)

Respond in JSON only.`,
          }],
        }),
      });

      const data: any = await res.json();
      const parsed = JSON.parse(data.choices[0].message.content);
      const version = this.getNextVersion(tasteDir);
      return { version, updatedAt: new Date().toISOString(), ...parsed };
    } catch (e) {
      console.warn('[TasteAnalyzer] LLM call failed:', e);
      return null;
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

  private loadHistory(outputDir: string, days: number): DailySummary[] {
    if (!fs.existsSync(outputDir)) return [];
    const results: DailySummary[] = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    for (const file of fs.readdirSync(outputDir)) {
      const match = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!match || new Date(match[1]) < cutoff) continue;
      try {
        const content = fs.readFileSync(path.join(outputDir, file), 'utf-8');
        const summary = this.parseSummaryFromReport(match[1], content);
        if (summary) results.push(summary);
      } catch { /* skip */ }
    }
    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  private parseSummaryFromReport(date: string, content: string): DailySummary | null {
    try {
      const topicsMatch = content.match(/\*\*Topics\*\*: (.+)/);
      const keywordsMatch = content.match(/\*\*Keywords\*\*: (.+)/);
      const domainsMatch = content.match(/\*\*Domains\*\*: (.+)/);
      const summaryMatch = content.match(/## Summary\n+([\s\S]+?)(?:\n##|$)/);
      const countMatch = content.match(/\*\*Conversations\*\*: (\d+)/);
      return {
        date,
        topics: topicsMatch ? topicsMatch[1].split(', ') : [],
        keywords: keywordsMatch ? keywordsMatch[1].split(', ') : [],
        domains: domainsMatch ? domainsMatch[1].split(', ') : [],
        conversationCount: countMatch ? parseInt(countMatch[1]) : 0,
        briefSummary: summaryMatch ? summaryMatch[1].trim() : '',
      };
    } catch { return null; }
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
