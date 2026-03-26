import fs from 'fs';
import { DetectedLog, Conversation, Message } from '../../types';

export interface LogAdapter {
  canHandle(tool: string): boolean;
  parse(filePath: string): Conversation[];
}

// Kiro JSONL: each line { role, content, timestamp, usage? }
export class KiroAdapter implements LogAdapter {
  canHandle(tool: string) { return tool === 'kiro'; }

  parse(filePath: string): Conversation[] {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const messages: Message[] = [];
    let tokenUsage = { input: 0, output: 0 };
    let date = new Date().toISOString().slice(0, 10);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role && entry.content) {
          const ts = entry.timestamp ? new Date(entry.timestamp) : new Date();
          date = ts.toISOString().slice(0, 10);
          messages.push({ role: entry.role, content: entry.content, timestamp: ts });
        }
        if (entry.usage) {
          tokenUsage.input += entry.usage.input_tokens ?? entry.usage.prompt_tokens ?? 0;
          tokenUsage.output += entry.usage.output_tokens ?? entry.usage.completion_tokens ?? 0;
        }
      } catch { /* skip malformed lines */ }
    }

    if (messages.length < 2) return [];
    return [{ tool: 'kiro', date, messages, tokenUsage }];
  }
}

// Codex JSONL: each line is an event with { type, payload, timestamp }
// Relevant types:
//   "response_item" with payload.role = "user" | "assistant" and payload.content[].text
//   "event_msg" with payload.type = "token_count" containing usage
export class CodexAdapter implements LogAdapter {
  canHandle(tool: string) { return tool === 'codex'; }

  parse(filePath: string): Conversation[] {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const messages: Message[] = [];
    let tokenUsage = { input: 0, output: 0 };
    let date = new Date().toISOString().slice(0, 10);

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const ts = event.timestamp ? new Date(event.timestamp) : new Date();

        if (event.type === 'response_item') {
          const p = event.payload;
          // user or assistant message
          if ((p.role === 'user' || p.role === 'assistant') && Array.isArray(p.content)) {
            const text = p.content
              .filter((c: any) => c.type === 'input_text' || c.type === 'output_text')
              .map((c: any) => c.text)
              .join('');
            if (text) {
              date = ts.toISOString().slice(0, 10);
              messages.push({ role: p.role, content: text, timestamp: ts });
            }
          }
        }

        if (event.type === 'event_msg' && event.payload?.type === 'token_count') {
          const usage = event.payload.info?.last_token_usage;
          if (usage) {
            tokenUsage.input += usage.input_tokens ?? 0;
            tokenUsage.output += usage.output_tokens ?? 0;
          }
        }
      } catch { /* skip malformed lines */ }
    }

    // Filter to only user/assistant messages (skip developer/system)
    const convo = messages.filter(m => m.role === 'user' || m.role === 'assistant');
    if (convo.length < 2) return [];
    return [{ tool: 'codex', date, messages: convo, tokenUsage }];
  }
}
