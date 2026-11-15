const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 200;

function isTransientLlmError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode || err.httpStatus;
  if (status === 429 || status === 503 || status === 504 || status === 502) {
    return true;
  }
  const msg = String(err.message || '');
  return /\b(?:rate\s*limit|too\s*many\s*requests|429|quota|overloaded|throttl|temporarily\s*unavailable|503|service\s*unavailable)\b/i.test(msg);
}

export async function invokeLlmWithRetry(chat, payload, {
  maxRetries = DEFAULT_MAX_RETRIES,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
} = {}) {
  if (typeof chat !== 'function') {
    throw new TypeError('Expected chat function');
  }

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await chat(payload);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransientLlmError(err)) {
        const jitter = Math.floor(Math.random() * 50);
        const delay = (initialDelayMs * Math.pow(2, attempt)) + jitter;
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
