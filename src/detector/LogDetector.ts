import fs from 'fs';
import path from 'path';
import os from 'os';
import { DetectedLog } from '../types';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Codex stores sessions under ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
function detectCodexSessions(): DetectedLog[] {
  const results: DetectedLog[] = [];
  const base = path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(base)) return results;
  const cutoff = Date.now() - NINETY_DAYS_MS;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.jsonl')) continue;
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) continue;
        results.push({ tool: 'codex', filePath: full, lastModified: stat.mtime });
      } catch { /* skip */ }
    }
  };
  try { walk(base); } catch { console.warn('[LogDetector] Cannot read codex sessions dir'); }
  return results;
}

// Kiro CLI: scan for any future JSON/JSONL logs Kiro may add
function detectKiroLogs(): DetectedLog[] {
  const results: DetectedLog[] = [];
  const cutoff = Date.now() - NINETY_DAYS_MS;
  const dirs = [
    path.join(os.homedir(), '.kiro', 'logs'),
    path.join(os.homedir(), '.kiro', 'history'),
    path.join(os.homedir(), '.kiro', 'sessions'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const file of fs.readdirSync(dir)) {
        if (!['.json', '.jsonl'].includes(path.extname(file))) continue;
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) continue;
        results.push({ tool: 'kiro', filePath, lastModified: stat.mtime });
      }
    } catch { console.warn(`[LogDetector] Cannot read ${dir}`); }
  }
  return results;
}

export class LogDetector {
  detect(): DetectedLog[] {
    return [...detectCodexSessions(), ...detectKiroLogs()];
  }
}
