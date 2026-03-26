import fs from 'fs';
import path from 'path';
import os from 'os';
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

    const prompt = `This is a text analysis task, NOT a coding task. Do NOT write or modify any files.

You are maintaining a developer's evolving taste profile used to steer AI agent responses.

MERGING RULES:
- Analyze ALL conversation summaries below (full history, not just recent)
- Items that appear repeatedly across many days should be weighted higher and kept
- Items that appear only once or twice should be treated as weak signals
- New observations from today's messages should be added only if they represent a genuine new pattern
- Do NOT arbitrarily replace stable existing items with new ones
- Each field: keep high-frequency items, add new patterns, drop one-off noise

ALL conversation summaries (${allSummaries.length} days — use frequency across days as signal strength):
${allSummaries.map(s => `[${s.date}] keywords: ${s.keywords.slice(0, 8).join(', ')}`).join('\n')}

${prevProfile ? `Current profile (reflects accumulated history — only evolve, don't reset):\n${JSON.stringify(prevProfile, null, 2)}\n\n` : ''}Today's user messages (new evidence to incorporate if it shows a new pattern):
${userMessages}

Output ONLY valid JSON (max items per field in parentheses), nothing else:
{
  "techPreferences": ["(max 5) technologies/tools that appear frequently across history"],
  "workDomains": ["(max 3) domains that appear frequently across history"],
  "personality": ["(max 5) stable traits/habits/style observed repeatedly"],
  "responseGuidance": ["(max 5) AI response instructions based on stable patterns"],
  "strengths": ["(max 3) strengths observed repeatedly"],
  "weaknesses": ["(max 3) blind spots observed repeatedly"]
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
    // Try codex exec first (non-interactive, reliable JSON output)
    try {
      const out = execSync(`echo ${JSON.stringify(prompt)} | codex exec --skip-git-repo-check`, {
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Output format: ...header...\ncodex\n<response>\ntokens used\n<count>\n<response>
      // Extract JSON block from response
      const match = out.match(/\{[\s\S]+\}/);
      if (match) return match[0];
    } catch { /* try next */ }

    // Fallback: kiro-cli chat
    try {
      const out = execSync(`kiro-cli chat ${JSON.stringify(prompt)}`, {
        timeout: 60000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const clean = out.replace(/\x1b\[[0-9;]*[mGKHFJA-Z]/g, '').replace(/\r/g, '');
      const match = clean.match(/\{[\s\S]+\}/);
      if (match) return match[0];
    } catch { /* fallback to keyword analysis */ }

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
    const content = this.toMarkdown(profile);

    // Kiro: inject to .kiro/steering/
    fs.mkdirSync(steeringDir, { recursive: true });
    fs.writeFileSync(path.join(steeringDir, 'taste.md'), content);

    // Codex: inject to ~/AGENTS.md (global user instructions)
    const agentsPath = path.join(os.homedir(), 'AGENTS.md');
    this.upsertSection(agentsPath, 'User Taste Profile', content);
  }

  // Insert or replace a tagged section in a file
  private upsertSection(filePath: string, tag: string, content: string): void {
    const begin = `<!-- taste:begin -->`;
    const end = `<!-- taste:end -->`;
    const block = `${begin}\n${content}\n${end}`;

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, block + '\n');
      return;
    }

    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.includes(begin)) {
      fs.writeFileSync(filePath, existing.replace(new RegExp(`${begin}[\\s\\S]*?${end}`), block));
    } else {
      fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + block + '\n');
    }
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
        workDomains: parseSection('Work Domains'),
        personality: parseSection('Personality & Habits'),
        responseGuidance: parseSection('How to Respond to This User'),
        strengths: parseSection('Strengths & Highlights'),
        weaknesses: parseSection('Weaknesses & Blind Spots'),
      };
    } catch { return null; }
  }

  private fallbackProfile(
    summaries: DailySummary[],
    conversations: Conversation[],
    prev: TasteProfile | null,
    version: number,
  ): TasteProfile {
    const STOP = new Set(['the','and','for','are','but','not','you','all','can','that','this','with','have','from','they','will','been','were','what','some','more','also','just','like','make','your','when','then','than','them','into','over','such','take','well','said','each','which','their','there','would','about','could','other']);
    const topByFreq = (arr: string[], limit: number) => {
      const map: Record<string, number> = {};
      for (const w of arr) map[w] = (map[w] ?? 0) + 1;
      return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, limit);
    };

    // Frequency across all history days — high freq = stable signal
    const histKeywords = topByFreq(summaries.flatMap(s => s.keywords), 5);
    const histDomains = topByFreq(summaries.flatMap(s => s.domains), 3);

    // Today's conversation text — new signal
    const todayWords = conversations
      .flatMap(c => c.messages.filter(m => m.role === 'user').map(m => m.content))
      .join(' ').toLowerCase().match(/\b[a-z][a-z0-9_-]{2,}\b/g) ?? [];
    const todayTop = topByFreq(todayWords.filter(w => !STOP.has(w)), 10);

    const mergeByFreq = (hist: string[], today: string[], limit: number) =>
      [...new Set([...hist, ...today])].slice(0, limit);

    return {
      version,
      updatedAt: new Date().toISOString(),
      techPreferences: mergeByFreq(histKeywords, todayTop, 5),
      workDomains: mergeByFreq(histDomains, [], 3),
      personality: prev?.personality ?? [],
      responseGuidance: prev?.responseGuidance ?? [],
      strengths: prev?.strengths ?? [],
      weaknesses: prev?.weaknesses ?? [],
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

## Work Domains
${profile.workDomains.map(d => `- ${d}`).join('\n')}

## Personality & Habits
${(profile.personality ?? []).map(p => `- ${p}`).join('\n')}

## How to Respond to This User
${(profile.responseGuidance ?? []).map(r => `- ${r}`).join('\n')}

## Strengths & Highlights
${(profile.strengths ?? []).map(s => `- ${s}`).join('\n')}

## Weaknesses & Blind Spots
${(profile.weaknesses ?? []).map(w => `- ${w}`).join('\n')}
`;
  }
}
