import { ConfigManager } from '../config/ConfigManager';
import { LogDetector } from '../detector/LogDetector';
import { LogParser } from '../parser/LogParser';
import { TokenCollector } from '../collector/TokenCollector';
import { ConversationSummarizer } from '../summarizer/ConversationSummarizer';
import { TasteAnalyzer } from '../taste/TasteAnalyzer';
import { ReportGenerator } from '../report/ReportGenerator';
import { DailySummary } from '../types';

export class AnalyzerService {
  private detector = new LogDetector();
  private parser = new LogParser();

  constructor(
    private config: ConfigManager,
    private tokenCollector: TokenCollector,
    private summarizer: ConversationSummarizer,
    private tasteAnalyzer: TasteAnalyzer,
    private reportGenerator: ReportGenerator,
  ) {}

  async run(date?: string): Promise<void> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    console.log(`[AnalyzerService] Running analysis for ${targetDate}`);

    const logs = this.detector.detect();
    if (logs.length === 0) {
      console.warn('[AnalyzerService] No log files detected');
    }

    const conversations = logs.flatMap(log => this.parser.parse(log))
      .filter(c => c.date === targetDate);

    const tokenSummary = await this.tokenCollector.collect(targetDate, conversations);

    let dailySummary: DailySummary;
    if (conversations.length > 0) {
      dailySummary = await this.summarizer.summarize(conversations);
    } else {
      dailySummary = { date: targetDate, topics: [], keywords: [], domains: [], conversationCount: 0, briefSummary: '' };
    }

    if (dailySummary.conversationCount > 0) {
      const profile = await this.tasteAnalyzer.analyze(dailySummary, conversations);
      if (profile) {
        this.tasteAnalyzer.saveVersion(profile);
        this.tasteAnalyzer.injectToSteering(profile);
        console.log(`[AnalyzerService] taste.md updated to v${profile.version}`);
      }
    }

    this.reportGenerator.generate(targetDate, tokenSummary, dailySummary);
    this.reportGenerator.appendToSummary(targetDate, tokenSummary, dailySummary);
    console.log(`[AnalyzerService] Report generated for ${targetDate}`);
  }
}
