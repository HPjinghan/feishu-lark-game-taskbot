// A minimal in-memory stand-in for Cloudflare's KVNamespace, just enough of
// the surface that src/kv.ts calls (get/put/delete) for local simulation.
// TTLs are accepted but not enforced — this is a short-lived local dev tool,
// not a correctness test of expiry behavior.

export class MockKVNamespace {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async put(key: string, value: string, _options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  reset(): void {
    this.store.clear();
  }

  dump(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}
