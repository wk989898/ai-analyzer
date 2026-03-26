export type ToolName = 'kiro' | 'codex' | 'claude' | 'gemini' | string;

export interface DetectedLog {
  tool: ToolName;
  filePath: string;
  lastModified: Date;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  tool: ToolName;
  date: string; // YYYY-MM-DD
  messages: Message[];
  tokenUsage: { input: number; output: number };
}

export interface TokenData {
  input: number;
  output: number;
}

export interface TokenSummary {
  date: string;
  byTool: Record<string, TokenData>;
  total: TokenData;
}

export interface DailySummary {
  date: string;
  topics: string[];
  keywords: string[];
  domains: string[];
  conversationCount: number;
  briefSummary: string;
}

export interface TasteProfile {
  version: number;
  updatedAt: string;
  techPreferences: string[];
  communicationStyle: string[];
  workDomains: string[];
  personalityTraits: string[];
  responseGuidance: string[];
  strengths: string[];
  weaknesses: string[];
  otherInsights: string[];
}

export interface Config {
  outputDir: string;
  steeringDir: string;
  tasteDir: string;
  scheduleCron: string;
  webPort: number;
  apiKeys: Record<string, string>;
}
