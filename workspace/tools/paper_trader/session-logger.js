const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function safeJsonParse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

class SessionLogger {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.filePath = options.filePath || './paper_trader_sessions.jsonl';
    this.sessionId = null;
    this.startedAt = null;
  }

  getResolvedPath() {
    return path.isAbsolute(this.filePath)
      ? this.filePath
      : path.resolve(process.cwd(), this.filePath);
  }

  async append(record) {
    if (!this.enabled) return;
    const file = this.getResolvedPath();
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  async startSession(context) {
    if (!this.enabled) return null;
    this.sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    this.startedAt = Date.now();

    await this.append({
      event: 'session_start',
      sessionId: this.sessionId,
      timestamp: this.startedAt,
      context,
    });

    return this.sessionId;
  }

  async logTrade(trade) {
    if (!this.enabled || !this.sessionId) return;
    await this.append({
      event: 'trade',
      sessionId: this.sessionId,
      timestamp: trade.timestamp || Date.now(),
      trade,
    });
  }

  async endSession(summary) {
    if (!this.enabled || !this.sessionId) return;
    const endedAt = Date.now();
    await this.append({
      event: 'session_end',
      sessionId: this.sessionId,
      timestamp: endedAt,
      durationMs: this.startedAt ? endedAt - this.startedAt : null,
      summary,
    });
  }

  static async readAll(filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    try {
      const data = await fs.promises.readFile(resolved, 'utf8');
      return data
        .split(/\r?\n/)
        .filter(Boolean)
        .map(safeJsonParse)
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

module.exports = SessionLogger;
