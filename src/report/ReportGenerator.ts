import fs from 'fs';
import path from 'path';
import { Conversation, TokenSummary, DailySummary } from '../types';
import { ConfigManager } from '../config/ConfigManager';

export class ReportGenerator {
  constructor(private config: ConfigManager) {}

  generate(date: string, token: TokenSummary, summary: DailySummary, conversations: Conversation[] = []): void {
    const { outputDir } = this.config.get();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, `${date}.md`), this.buildDailyReport(date, token, summary, conversations));
  }

  appendToSummary(date: string, token: TokenSummary, summary: DailySummary): void {
    const { outputDir } = this.config.get();
    const summaryPath = path.join(outputDir, 'usage-summary.md');
    const entry = this.buildSummaryEntry(date, token, summary);

    if (!fs.existsSync(summaryPath)) {
      fs.writeFileSync(summaryPath, `# AI Usage Summary\n\n${entry}`);
      return;
    }

    const existing = fs.readFileSync(summaryPath, 'utf-8');
    const dateHeader = `## ${date}`;
    if (existing.includes(dateHeader)) {
      const replaced = existing.replace(new RegExp(`## ${date}[\\s\\S]+?(?=\n## |$)`), entry);
      fs.writeFileSync(summaryPath, replaced);
    } else {
      fs.writeFileSync(summaryPath, existing.replace('# AI Usage Summary\n\n', `# AI Usage Summary\n\n${entry}`));
    }
  }

  private buildDailyReport(date: string, token: TokenSummary, summary: DailySummary, conversations: Conversation[]): string {
    const toolRows = Object.entries(token.byTool)
      .map(([tool, t]) => `| ${tool} | ${t.input.toLocaleString()} | ${t.output.toLocaleString()} |`)
      .join('\n');

    const sessionRows = conversations.map((c, i) => {
      const msgs = c.messages;
      const start = msgs[0]?.timestamp ? new Date(msgs[0].timestamp).toISOString() : '';
      const end = msgs[msgs.length - 1]?.timestamp ? new Date(msgs[msgs.length - 1].timestamp).toISOString() : '';
      const firstMsg = msgs.find(m => m.role === 'user')?.content.slice(0, 80).replace(/\n/g, ' ') ?? '';
      return `| ${i + 1} | ${c.tool} | ${start} | ${end} | ${c.tokenUsage.input + c.tokenUsage.output} | ${firstMsg}... |`;
    }).join('\n');

    return `# AI Usage Report — ${date}

## Token Usage

| Tool | Input Tokens | Output Tokens |
|------|-------------|---------------|
${toolRows}
| **Total** | **${token.total.input.toLocaleString()}** | **${token.total.output.toLocaleString()}** |

## Conversations

**Conversations**: ${summary.conversationCount}
**Topics**: ${summary.topics.join(', ') || 'N/A'}
**Keywords**: ${summary.keywords.join(', ') || 'N/A'}
**Domains**: ${summary.domains.join(', ') || 'N/A'}

## Sessions

| # | Tool | Start | End | Tokens | Opening Message |
|---|------|-------|-----|--------|-----------------|
${sessionRows || '| — | — | — | — | — | No sessions |'}

## Summary

${summary.briefSummary || 'No summary available.'}
`;
  }

  private buildSummaryEntry(date: string, token: TokenSummary, summary: DailySummary): string {
    return `## ${date}

- **Total Tokens**: ${(token.total.input + token.total.output).toLocaleString()} (in: ${token.total.input.toLocaleString()}, out: ${token.total.output.toLocaleString()})
- **Conversations**: ${summary.conversationCount}
- **Topics**: ${summary.topics.slice(0, 5).join(', ') || 'N/A'}

`;
  }
}
