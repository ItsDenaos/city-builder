import { MinHeap } from '../heap';
import type { GameMap } from '../state';

/** Árbol de caminos mínimos hacia un conjunto de fuentes. */
export interface PathTree {
  /** Coste desde cada casilla hasta la fuente más barata (Infinity si no llega). */
  dist: Float32Array;
  /** Siguiente casilla hacia esa fuente (-1 en las fuentes y en las que no llegan). */
  parent: Int32Array;
  /** Casillas en el orden en que se asentaron, de la más cercana a la más lejana. */
  order: number[];
}

/**
 * Dijkstra desde varias fuentes a la vez por las casillas transitables (4 vecinos).
 * `sources` da cada fuente con su coste de partida; `stepCost(n)` es lo que cuesta entrar en la casilla n.
 * Lo usan el tráfico (coches hacia empleos y comercios) y el transporte público (autobús por las calles,
 * metro por los túneles).
 */
export function shortestTree(
  map: GameMap,
  passable: (i: number) => boolean,
  sources: readonly (readonly [number, number])[],
  stepCost: (n: number) => number,
): PathTree {
  const size = map.width * map.height;
  const dist = new Float32Array(size).fill(Infinity);
  const parent = new Int32Array(size).fill(-1);
  const settled = new Uint8Array(size);
  const order: number[] = [];
  const heap = new MinHeap();
  for (const [i, d] of sources) {
    if (d < dist[i]) {
      dist[i] = d;
      heap.push(i, d);
    }
  }
  const w = map.width;
  while (heap.size) {
    const i = heap.pop();
    if (settled[i]) continue;
    settled[i] = 1;
    order.push(i);
    const x = i % w;
    const neighbors = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const n of neighbors) {
      if (n < 0 || n >= size || !passable(n) || settled[n]) continue;
      const d = dist[i] + stepCost(n);
      if (d < dist[n]) {
        dist[n] = d;
        parent[n] = i;
        heap.push(n, d);
      }
    }
  }
  return { dist, parent, order };
}

/** Fuente a la que llega cada casilla por el árbol (-1 si no llega a ninguna). */
export function treeRoots(tree: PathTree): Int32Array {
  const root = new Int32Array(tree.dist.length).fill(-1);
  // En `order` cada casilla aparece después de su padre
  for (const i of tree.order) root[i] = tree.parent[i] < 0 ? i : root[tree.parent[i]];
  return root;
}

/** Lleva el flujo de cada origen por el árbol hasta su fuente y lo suma en `out` casilla a casilla. */
export function accumulate(tree: PathTree, origins: Float32Array, out: Float32Array): void {
  const flow = origins.slice();
  const { order, parent } = tree;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    out[i] += flow[i];
    if (parent[i] >= 0) flow[parent[i]] += flow[i];
  }
}
