export interface InvItem {
  name: string
  col: number
}

export class InventoryStore {
  readonly items: Map<number, InvItem> = new Map()

  update(inv: Record<string, Partial<InvItem>> | undefined): void {
    if (!inv) return
    for (const [slot, patch] of Object.entries(inv)) {
      const idx = Number(slot)
      const existing = this.items.get(idx) ?? { name: '', col: 7 }
      this.items.set(idx, { ...existing, ...patch })
    }
  }

  get(index: number): InvItem | undefined {
    return this.items.get(index)
  }
}
