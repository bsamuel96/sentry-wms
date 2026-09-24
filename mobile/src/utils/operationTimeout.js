export const OPERATION_TIMEOUT_CODE = 'OPERATION_TIMEOUT';

export function withOperationTimeout(promise, timeoutMs, operationName = 'Operația') {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${operationName} a depășit limita de timp.`);
      error.code = OPERATION_TIMEOUT_CODE;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}
