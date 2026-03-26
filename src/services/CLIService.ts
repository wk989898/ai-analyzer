import { Command } from 'commander';
import { ConfigManager } from '../config/ConfigManager';
import { AnalyzerService } from './AnalyzerService';
import { TokenCollector } from '../collector/TokenCollector';
import { ConversationSummarizer } from '../summarizer/ConversationSummarizer';
import { TasteAnalyzer } from '../taste/TasteAnalyzer';
import { ReportGenerator } from '../report/ReportGenerator';
import { WebServer } from '../web/WebServer';
import { Scheduler } from '../scheduler/Scheduler';
import fs from 'fs';
import path from 'path';

export class CLIService {
  register(program: Command): void {
    const config = new ConfigManager();
    const analyzer = new AnalyzerService(
      config,
      new TokenCollector(config),
      new ConversationSummarizer(config),
      new TasteAnalyzer(config),
      new ReportGenerator(config),
    );

    program
      .command('run')
      .description('Run analysis for a specific date (default: today)')
      .option('--date <YYYY-MM-DD>', 'Date to analyze')
      .action(async (opts) => { await analyzer.run(opts.date); });

    program
      .command('serve')
      .description('Start local web dashboard')
      .option('--port <number>', 'Port number', '3000')
      .action((opts) => { new WebServer(config).start(parseInt(opts.port)); });

    program
      .command('daemon')
      .description('Manage background scheduler')
      .argument('<action>', 'start | stop')
      .action((action) => {
        const scheduler = new Scheduler();
        if (action === 'start') {
          scheduler.start(config.get().scheduleCron, () => analyzer.run());
        } else if (action === 'stop') {
          scheduler.stop();
        } else {
          console.error('Unknown action. Use: start | stop');
        }
      });

    program
      .command('taste')
      .description('Show taste profile history')
      .option('--history', 'List all versions')
      .action((opts) => {
        const { tasteDir } = config.get();
        if (!fs.existsSync(tasteDir)) { console.log('No taste history found.'); return; }
        const versions = fs.readdirSync(tasteDir).filter(f => /^taste-v\d+\.md$/.test(f)).sort();
        if (opts.history) {
          versions.forEach(v => console.log(path.join(tasteDir, v)));
        } else {
          const latest = versions.at(-1);
          if (latest) console.log(fs.readFileSync(path.join(tasteDir, latest), 'utf-8'));
        }
      });

    program
      .command('config')
      .description('Set configuration value')
      .argument('<key>', 'Config key')
      .argument('<value>', 'Config value')
      .action((key, value) => {
        config.save({ [key]: value } as any);
        console.log(`Config updated: ${key} = ${value}`);
      });
  }
}
