import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import { Conversation, Message } from '../../types';
import { LogAdapter } from './KiroAdapter';

const DB_PATH = path.join(os.homedir(), 'Library', 'Application Support', 'kiro-cli', 'data.sqlite3');

export class KiroCLIAdapter implements LogAdapter {
  canHandle(tool: string) { return tool === 'kiro-cli'; }

  parse(_filePath: string): Conversation[] {
    try {
      const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
      const rows = db.prepare('SELECT value, created_at FROM conversations_v2 ORDER BY created_at').all() as any[];
      db.close();
      return rows.flatMap(row => this.parseRow(row));
    } catch (e) {
      console.warn('[KiroCLIAdapter] Failed to read kiro-cli DB:', (e as Error).message);
      return [];
    }
  }

  private parseRow(row: { value: string; created_at: number }): Conversation[] {
    try {
      const data = JSON.parse(row.value);
      const history: any[] = data.history ?? [];
      if (!history.length) return [];

      const messages: Message[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      const date = new Date(row.created_at).toISOString().slice(0, 10);

      for (const item of history) {
        const userPrompt: string = item.user?.content?.Prompt?.prompt ?? '';
        const userTs = item.user?.timestamp ? new Date(item.user.timestamp) : new Date(row.created_at);

        // Skip internal ai-analyzer taste generation calls
        if (userPrompt.startsWith('You are analyzing') || userPrompt.startsWith('You are maintaining')) continue;

        if (userPrompt) messages.push({ role: 'user', content: userPrompt, timestamp: userTs });

        const assistantContent: string = item.assistant?.Response?.content ?? '';
        if (assistantContent) messages.push({ role: 'assistant', content: assistantContent, timestamp: new Date(row.created_at) });

        const meta = item.request_metadata ?? {};
        inputTokens += Math.round((meta.user_prompt_length ?? 0) / 4);
        outputTokens += Math.round((meta.response_size ?? 0) / 4);
      }

      if (messages.length < 2) return [];
      return [{ tool: 'kiro-cli', date, messages, tokenUsage: { input: inputTokens, output: outputTokens } }];
    } catch { return []; }
  }
}
