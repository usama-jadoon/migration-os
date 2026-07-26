export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      // Check if error is permanent (like authentication or folder missing)
      const errMessage = error.message?.toLowerCase() || '';
      const isPermanent = 
        errMessage.includes('auth') || 
        errMessage.includes('login') || 
        errMessage.includes('credentials') || 
        errMessage.includes('nonexistent') || 
        errMessage.includes('no such folder');

      if (isPermanent || attempt === maxRetries - 1) {
        throw error;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[Retry] Temporary error encountered. Retrying in ${delay}ms (Attempt ${attempt + 1}/${maxRetries}): ${error.message}`);
      await sleep(delay);
    }
  }
  throw new Error('Retry exhausted');
}
