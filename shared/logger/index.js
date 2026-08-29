/**
 * Enterprise Microservices Shared Logger
 * Zero-dependency structured logger with distributed tracing correlation support.
 */

const fs = require('fs');
const path = require('path');

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

const LOG_COLORS = {
  DEBUG: '\x1b[36m', // Cyan
  INFO: '\x1b[32m',  // Green
  WARN: '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m', // Red
  FATAL: '\x1b[35m', // Magenta
  RESET: '\x1b[0m',
  GREY: '\x1b[90m'
};

class Logger {
  constructor(serviceName, options = {}) {
    this.serviceName = serviceName || 'unknown-service';
    this.minLevel = LOG_LEVELS[options.minLevel || process.env.LOG_LEVEL || 'INFO'] ?? LOG_LEVELS.INFO;
    this.enableConsole = options.enableConsole !== false;
    this.logDirectory = options.logDirectory || path.join(process.cwd(), 'logs');
    this.enableFileLogging = options.enableFileLogging === true;

    if (this.enableFileLogging) {
      this._ensureLogDirectory();
    }
  }

  _ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch (err) {
      console.error(`[Logger] Failed to create log directory: ${err.message}`);
    }
  }

  _formatTimestamp() {
    return new Date().toISOString();
  }

  _formatEntry(level, message, meta = {}, traceId = null) {
    const timestamp = this._formatTimestamp();
    const correlationId = traceId || meta.traceId || meta.correlationId || 'root-trace';
    
    return {
      timestamp,
      level,
      service: this.serviceName,
      traceId: correlationId,
      message,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
      pid: process.pid
    };
  }

  _write(level, message, meta = {}, traceId = null) {
    if (LOG_LEVELS[level] < this.minLevel) {
      return;
    }

    const logEntry = this._formatEntry(level, message, meta, traceId);

    if (this.enableConsole) {
      const color = LOG_COLORS[level] || LOG_COLORS.RESET;
      const grey = LOG_COLORS.GREY;
      const reset = LOG_COLORS.RESET;
      const metaStr = logEntry.meta ? ` | ${JSON.stringify(logEntry.meta)}` : '';
      const formatted = `${grey}[${logEntry.timestamp}]${reset} ${color}[${level}]${reset} ${grey}[${this.serviceName}]${reset} ${grey}[${logEntry.traceId}]${reset}: ${message}${metaStr}`;
      
      if (level === 'ERROR' || level === 'FATAL') {
        console.error(formatted);
      } else if (level === 'WARN') {
        console.warn(formatted);
      } else {
        console.log(formatted);
      }
    }

    if (this.enableFileLogging) {
      try {
        const filePath = path.join(this.logDirectory, `${this.serviceName}.log`);
        fs.appendFileSync(filePath, JSON.stringify(logEntry) + '\n', 'utf8');
      } catch (err) {
        // Fallback silence to avoid infinite loops
      }
    }

    return logEntry;
  }

  debug(msg, meta, traceId) {
    return this._write('DEBUG', msg, meta, traceId);
  }

  info(msg, meta, traceId) {
    return this._write('INFO', msg, meta, traceId);
  }

  warn(msg, meta, traceId) {
    return this._write('WARN', msg, meta, traceId);
  }

  error(msg, meta, traceId) {
    return this._write('ERROR', msg, meta, traceId);
  }

  fatal(msg, meta, traceId) {
    return this._write('FATAL', msg, meta, traceId);
  }

  createChildLogger(contextMeta = {}) {
    return {
      debug: (msg, meta, traceId) => this.debug(msg, { ...contextMeta, ...meta }, traceId),
      info: (msg, meta, traceId) => this.info(msg, { ...contextMeta, ...meta }, traceId),
      warn: (msg, meta, traceId) => this.warn(msg, { ...contextMeta, ...meta }, traceId),
      error: (msg, meta, traceId) => this.error(msg, { ...contextMeta, ...meta }, traceId),
      fatal: (msg, meta, traceId) => this.fatal(msg, { ...contextMeta, ...meta }, traceId),
    };
  }
}

module.exports = {
  Logger,
  LOG_LEVELS
};
