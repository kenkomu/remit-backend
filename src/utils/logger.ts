// =====================================================
// SIMPLE LOGGER UTILITY
// =====================================================

const logLevels = ['error', 'warn', 'info', 'debug'] as const;
type LogLevel = typeof logLevels[number];

const currentLogLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  const levelIndex = logLevels.indexOf(level);
  const currentLevelIndex = logLevels.indexOf(currentLogLevel);
  return levelIndex <= currentLevelIndex;
}

function formatMessage(level: LogLevel, message: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  
  if (args.length > 0) {
    try {
      const formattedArgs = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
      ).join(' ');
      return `${prefix} ${message} ${formattedArgs}`;
    } catch {
      return `${prefix} ${message} [Unserializable arguments]`;
    }
  }
  
  return `${prefix} ${message}`;
}

export const logger = {
  error: (message: string, ...args: any[]) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, ...args));
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, ...args));
    }
  },
  
  info: (message: string, ...args: any[]) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', message, ...args));
    }
  },
  
  debug: (message: string, ...args: any[]) => {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, ...args));
    }
  },
  
  // For HTTP request logging
  request: (method: string, url: string, statusCode: number, duration: number) => {
    if (shouldLog('info')) {
      console.log(`[${new Date().toISOString()}] [REQUEST] ${method} ${url} ${statusCode} ${duration}ms`);
    }
  }
};

export default logger;