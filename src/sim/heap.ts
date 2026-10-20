/** Montículo binario de mínimos para Dijkstra: guarda índices de casilla con su prioridad. */
export class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    const { items, prio } = this;
    let k = items.length;
    items.push(item);
    prio.push(priority);
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (prio[parent] <= prio[k]) break;
      this.swap(k, parent);
      k = parent;
    }
  }

  /** Devuelve el índice con menor prioridad (llamar solo con size > 0). */
  pop(): number {
    const { items, prio } = this;
    const top = items[0];
    const lastItem = items.pop()!;
    const lastPrio = prio.pop()!;
    if (items.length) {
      items[0] = lastItem;
      prio[0] = lastPrio;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < items.length && prio[l] < prio[m]) m = l;
        if (r < items.length && prio[r] < prio[m]) m = r;
        if (m === k) break;
        this.swap(k, m);
        k = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const { items, prio } = this;
    [items[a], items[b]] = [items[b], items[a]];
    [prio[a], prio[b]] = [prio[b], prio[a]];
  }
}
