import { DetectedLog, Conversation } from '../types';
import { LogAdapter, KiroAdapter, CodexAdapter } from './adapters/KiroAdapter';

export class LogParser {
  private adapters: LogAdapter[] = [new KiroAdapter(), new CodexAdapter()];

  parse(log: DetectedLog): Conversation[] {
    const adapter = this.adapters.find(a => a.canHandle(log.tool));
    if (!adapter) {
      console.warn(`[LogParser] No adapter for tool: ${log.tool}`);
      return [];
    }
    try {
      return adapter.parse(log.filePath);
    } catch (e) {
      console.warn(`[LogParser] Failed to parse ${log.filePath}:`, e);
      return [];
    }
  }
}
