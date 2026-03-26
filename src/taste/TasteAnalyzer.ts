import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Conversation, DailySummary, TasteProfile } from '../types';
import { ConfigManager } from '../config/ConfigManager';

export class TasteAnalyzer {
  constructor(private config: ConfigManager) {}

  async analyze(newSummary: DailySummary, conversations: Conversation[]): Promise<TasteProfile | null> {
    const { outputDir, tasteDir } = this.config.get();
    const history = this.loadHistory(outputDir, 30);
    const allSummaries = [...history, newSummary];

    if (allSummaries.length < 3) {
      console.log(`[TasteAnalyzer] Not enough history (${allSummaries.length}/3 days), skipping taste update`);
      return null;
    }

    const prevProfile = this.loadLatestProfile(tasteDir);
    const userMessages = conversations
      .flatMap(c => c.messages.filter(m => m.role === 'user').map(m => m.content.slice(0, 300)))
      .slice(-30)
      .join('\n---\n');

    const prompt = `You are analyzing a developer's AI agent conversation history to build a detailed taste profile.
The profile will be injected into AI agents as a steering document so they can respond in a style that matches this user.

${prevProfile ? `Previous profile (merge and evolve this):\n${JSON.stringify(prevProfile, null, 2)}\n\n` : ''}Recent conversation summaries (${allSummaries.length} days):
${allSummaries.map(s => `[${s.date}] topics: ${s.topics.join(',')} keywords: ${s.keywords.join(',')}`).join('\n')}

Recent user messages (analyze tone, style, habits):
${userMessages}

Generate an evolved taste profile. Output ONLY valid JSON with these fields:
{
  "techPreferences": ["technologies, languages, tools the user works with frequently"],
  "communicationStyle": ["observed communication traits: language preference, verbosity, directness, how they ask questions, etc"],
  "workDomains": ["primary work domains"],
  "personalityTraits": ["inferred personality traits and habits from conversation patterns, e.g. 'prefers concise answers', 'pastes raw logs without filtering', 'iterative problem-solver', 'direct and low-ceremony'"],
  "responseGuidance": ["concrete instructions for AI agents on HOW to respond to this user, e.g. 'respond in Chinese unless user writes in English', 'skip pleasantries and get to the point', 'show commands directly without lengthy explanation', 'use bullet points over paragraphs'],
  "otherInsights": ["other notable patterns or interests"]
}`;

    const result = this.callAI(prompt);
    const version = this.getNextVersion(tasteDir);

    if (result) {
      try {
        const parsed = JSON.parse(result);
        return { version, updatedAt: new Date().toISOString(), ...parsed };
      } catch {
        console.warn('[TasteAnalyzer] Failed to parse AI response, using fallback');
      }
    }

    return this.fallbackProfile(allSummaries, conversations, prevProfile, version);
  }

  private callAI(prompt: string): string | null {
    // Try kiro-cli first
    try {
      const out = execSync(`kiro-cli chat ${JSON.stringify(prompt)}`, {
        timeout: 60000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Strip ANSI codes and extract JSON block
      const clean = out.replace(/\x1b\[[0-9;]*[mGKHFJA-Z]/g, '').replace(/\r/g, '');
      const match = clean.match(/\{[\s\S]+\}/);
      if (match) return match[0];
    } catch { /* try next */ }

    // Try codex
    try {
      const out = execSync(`codex --quiet ${JSON.stringify(prompt)}`, {
        timeout: 60000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const match = out.match(/\{[\s\S]+\}/);
      if (match) return match[0];
    } catch { /* fallback */ }

    return null;
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

  private loadLatestProfile(tasteDir: string): TasteProfile | null {
    const latest = path.join(tasteDir, 'taste.md');
    if (!fs.existsSync(latest)) return null;
    try {
      const content = fs.readFileSync(latest, 'utf-8');
      const versionMatch = content.match(/version: (\d+)/);
      const parseSection = (header: string) =>
        (content.match(new RegExp(`## ${header}\\n([\\s\\S]+?)(?=\\n##|$)`)) ?? [])[1]
          ?.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)) ?? [];
      return {
        version: versionMatch ? parseInt(versionMatch[1]) : 1,
        updatedAt: '',
        techPreferences: parseSection('Tech Preferences'),
        communicationStyle: parseSection('Communication Style'),
        workDomains: parseSection('Work Domains'),
        personalityTraits: parseSection('Personality & Habits'),
        responseGuidance: parseSection('How to Respond to This User'),
        otherInsights: parseSection('Other Insights'),
      };
    } catch { return null; }
  }

  private fallbackProfile(
    summaries: DailySummary[],
    conversations: Conversation[],
    prev: TasteProfile | null,
    version: number,
  ): TasteProfile {
    const words = conversations
      .flatMap(c => c.messages.filter(m => m.role === 'user').map(m => m.content))
      .join(' ')
      .toLowerCase()
      .match(/\b[a-z][a-z0-9_-]{2,}\b/g) ?? [];

    const stopWords = new Set(['the','and','for','are','but','not','you','all','can','that','this','with','have','from','they','will','been','were','what','some','more','also','just','like','make','your','when','then','than','them','into','over','such','take','well','said','each','which','their','there','would','about','could','other']);
    const freq = (arr: string[]) => {
      const map: Record<string, number> = {};
      for (const w of arr) map[w] = (map[w] ?? 0) + 1;
      return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([w]) => w);
    };

    const newKeywords = freq(words.filter(w => !stopWords.has(w))).slice(0, 15);
    const newDomains = freq(summaries.flatMap(s => s.domains)).slice(0, 5);
    const merge = (a: string[], b: string[], n: number) => [...new Set([...a, ...b])].slice(0, n);

    return {
      version,
      updatedAt: new Date().toISOString(),
      techPreferences: merge(newKeywords, prev?.techPreferences ?? [], 15),
      communicationStyle: prev?.communicationStyle ?? [],
      workDomains: merge(newDomains, prev?.workDomains ?? [], 5),
      personalityTraits: prev?.personalityTraits ?? [],
      responseGuidance: prev?.responseGuidance ?? [],
      otherInsights: [`Based on ${summaries.length} days of conversation history (keyword analysis)`],
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

## Personality & Habits
${(profile.personalityTraits ?? []).map(p => `- ${p}`).join('\n')}

## How to Respond to This User
${(profile.responseGuidance ?? []).map(r => `- ${r}`).join('\n')}

## Other Insights
${profile.otherInsights.map(i => `- ${i}`).join('\n')}
`;
  }
}
