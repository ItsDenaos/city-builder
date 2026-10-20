function mix(a: number): number {
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** PRNG determinista (mulberry32): misma semilla, mismo mapa. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => mix((a = (a + 0x6d2b79f5) >>> 0));
}

/** Variante cuyo estado vive en el GameState, para que la simulación sea reproducible y serializable. */
export function random(holder: { rng: number }): number {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  return mix(holder.rng);
}
