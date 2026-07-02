// The happy-dom build we test under exposes Storage globals whose methods
// throw; session.ts and the resume persistence talk to them directly, so
// tests stub each with a real Map-backed shim:
//   vi.stubGlobal('localStorage', fakeStorage())
//   vi.stubGlobal('sessionStorage', fakeStorage())
export function fakeStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  } as Storage
}
