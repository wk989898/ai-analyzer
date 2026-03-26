import fs from 'fs';
import path from 'path';
import os from 'os';
import cron from 'node-cron';

const PID_FILE = path.join(os.homedir(), '.ai-analyzer', 'daemon.pid');

export class Scheduler {
  private task: cron.ScheduledTask | null = null;

  start(cronExpr: string, job: () => Promise<void>): void {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
      try { process.kill(pid, 0); console.error(`Daemon already running (PID ${pid})`); process.exit(1); } catch { /* stale PID */ }
    }
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));

    this.task = cron.schedule(cronExpr, async () => {
      try { await job(); } catch (e) { console.error('[Scheduler] Job failed:', e); }
    });

    const cleanup = () => { this.stop(); process.exit(0); };
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    console.log(`[Scheduler] Daemon started with cron: ${cronExpr}`);
  }

  stop(): void {
    this.task?.stop();
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    console.log('[Scheduler] Daemon stopped');
  }
}
