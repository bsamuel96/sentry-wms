import '@testing-library/jest-dom';

// Node 25 exposes an incomplete experimental Storage object to worker
// processes when no --localstorage-file is configured. Prefer jsdom's
// implementation, and provide a small standards-shaped fallback so the
// browser-facing auth tests remain deterministic on every supported Node.
function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.has(String(key)) ? values.get(String(key)) : null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(String(key)); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}

for (const name of ['localStorage', 'sessionStorage']) {
  if (typeof globalThis[name]?.clear !== 'function') {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, name, { configurable: true, value: storage });
    Object.defineProperty(window, name, { configurable: true, value: storage });
  }
}
