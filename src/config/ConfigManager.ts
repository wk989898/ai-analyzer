import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config } from '../types';

const CONFIG_PATH = path.join(os.homedir(), '.ai-analyzer', 'config.json');

const DEFAULTS: Config = {
  outputDir: path.join(os.homedir(), 'ai-usage'),
  steeringDir: path.join(os.homedir(), '.kiro', 'steering'),
  tasteDir: path.join(os.homedir(), 'ai-usage', 'taste'),
  scheduleCron: '0 23 * * *',
  webPort: 3000,
  apiKeys: {},
};

export class ConfigManager {
  private config: Config;

  constructor() {
    this.config = this.load();
  }

  load(): Config {
    let fileConfig: Partial<Config> = {};
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      } catch {
        console.warn('Failed to parse config file, using defaults');
      }
    }
    // API keys from env vars take precedence
    const envKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('AI_ANALYZER_KEY_') && v) {
        envKeys[k.replace('AI_ANALYZER_KEY_', '').toLowerCase()] = v;
      }
    }
    this.config = { ...DEFAULTS, ...fileConfig, apiKeys: { ...fileConfig.apiKeys, ...envKeys } };
    return this.config;
  }

  get(): Config {
    return this.config;
  }

  save(partial: Partial<Config>): void {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    this.config = { ...this.config, ...partial };
    const { apiKeys, ...rest } = this.config; // don't persist env-sourced keys
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(rest, null, 2));
  }

  getApiKey(tool: string): string | undefined {
    return this.config.apiKeys[tool.toLowerCase()];
  }
}
