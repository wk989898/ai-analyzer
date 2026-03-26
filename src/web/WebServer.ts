import express from 'express';
import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../config/ConfigManager';

export class WebServer {
  private app = express();

  constructor(private config: ConfigManager) {
    this.app.use(express.static(path.join(__dirname, '../../public')));
    this.app.get('/api/usage', (req, res) => res.json(this.getUsage()));
    this.app.get('/api/summaries', (req, res) => res.json(this.getSummaries()));
    this.app.get('/api/taste', (req, res) => res.json(this.getTaste()));
  }

  start(port?: number): void {
    const p = port ?? this.config.get().webPort;
    this.app.listen(p, () => console.log(`[WebServer] Running at http://localhost:${p}`));
  }

  private getUsage() {
    const { outputDir } = this.config.get();
    if (!fs.existsSync(outputDir)) return [];
    return fs.readdirSync(outputDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .map(f => {
        const date = f.replace('.md', '');
        const content = fs.readFileSync(path.join(outputDir, f), 'utf-8');
        return { date, ...this.parseTokenTable(content) };
      })
      .filter(d => Object.keys(d.byTool).length > 0); // skip empty days
  }

  private getSummaries() {
    const { outputDir } = this.config.get();
    if (!fs.existsSync(outputDir)) return [];
    return fs.readdirSync(outputDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort().reverse()
      .map(f => {
        const date = f.replace('.md', '');
        const content = fs.readFileSync(path.join(outputDir, f), 'utf-8');
        return { date, ...this.parseSummarySection(content) };
      })
      .filter(s => s.conversationCount > 0); // skip empty days
  }

  private getTaste() {
    const { tasteDir } = this.config.get();
    if (!fs.existsSync(tasteDir)) return [];
    return fs.readdirSync(tasteDir)
      .filter(f => /^taste-v\d+\.md$/.test(f))
      .sort((a, b) => {
        const va = parseInt(a.match(/v(\d+)/)![1]);
        const vb = parseInt(b.match(/v(\d+)/)![1]);
        return vb - va;
      })
      .map((f, i) => ({
        version: parseInt(f.match(/v(\d+)/)![1]),
        isCurrent: i === 0,
        content: fs.readFileSync(path.join(tasteDir, f), 'utf-8'),
      }));
  }

  private parseTokenTable(content: string) {
    const byTool: Record<string, { input: number; output: number }> = {};
    const rows = content.match(/\| (\w+) \| ([\d,]+) \| ([\d,]+) \|/g) ?? [];
    for (const row of rows) {
      const m = row.match(/\| (\w+) \| ([\d,]+) \| ([\d,]+) \|/);
      if (m && m[1] !== 'Tool' && m[1] !== '**Total**') {
        byTool[m[1]] = { input: parseInt(m[2].replace(/,/g, '')), output: parseInt(m[3].replace(/,/g, '')) };
      }
    }
    return { byTool };
  }

  private parseSummarySection(content: string) {
    const parseList = (raw: string | undefined) =>
      raw && raw !== 'N/A' ? raw.split(', ').filter(Boolean) : [];
    const topics = parseList(content.match(/\*\*Topics\*\*: (.+)/)?.[1]);
    const keywords = parseList(content.match(/\*\*Keywords\*\*: (.+)/)?.[1]);
    const domains = parseList(content.match(/\*\*Domains\*\*: (.+)/)?.[1]);
    const count = parseInt(content.match(/\*\*Conversations\*\*: (\d+)/)?.[1] ?? '0');
    const brief = content.match(/## Summary\n+([\s\S]+?)(?:\n##|$)/)?.[1].trim() ?? '';
    return { topics, keywords, domains, conversationCount: count, briefSummary: brief };
  }
}
