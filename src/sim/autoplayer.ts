import { type Command, applyCommand } from './commands';
import { defaultChoice, getIncident } from './data/incidents';
import { MAX_LOANS } from './config';
import { getBuildingDef } from './data/buildings';
import { ZONE_CODE } from './data/zones';
import { tick } from './simulation';
import { estimateBudget } from './systems/economy';
import { type GameState, NO_BUILDING, isUnlocked, tileIndex } from './state';
import { hasRoadAccess } from './systems/access';
import type { Density, SimEvent, ZoneType } from './types';

/**
 * Jugador automático. Sirve para medir el balance (balance/, tests/balance.test.ts) y para
 * levantar la ciudad de demostración que se ve detrás del menú principal: construye una ciudad en manzanas de 4×4
 * (calles cada 5 casillas, con tubería debajo), zonifica según la demanda, añade centrales,
 * agua y servicios cuando hacen falta, y pide préstamos si se queda sin dinero.
 * No pretende jugar bien, sino como un jugador razonable y predecible.
 */

const SPACING = 5; // calle cada 5 casillas → manzanas de 4×4
const INNER = SPACING - 1;
const RESERVE = 2_000; // dinero que intenta no gastar
const LOW_COVERAGE = 40;
const ZONE_DEMAND = 0.05; // la demanda a largo plazo ronda 0,1
const MIN_FREE_LOTS = 8;

type BlockUse = 'R' | 'C' | 'I' | 'power' | 'water' | 'civic' | 'school';

interface Block {
  bx: number;
  by: number;
  use: BlockUse;
}

export interface BotOptions {
  taxes?: Partial<Record<ZoneType, number>>;
  /** Si es false, no construye servicios (para comparar). */
  services?: boolean;
  /** Si es false, nunca pide préstamos. */
  loans?: boolean;
}

export interface BotLog {
  built: Record<string, number>;
  loans: number;
  failures: Record<string, number>;
}

export class AutoPlayer {
  private blocks = new Map<string, Block>();
  private readonly nbx: number;
  private cbx: number;
  private cby: number;
  readonly log: BotLog = { built: {}, loans: 0, failures: {} };

  constructor(
    private s: GameState,
    private opts: BotOptions = {},
  ) {
    this.nbx = Math.floor((s.map.width - 1) / SPACING);
    this.cbx = Math.floor(this.nbx / 2);
    this.cby = Math.floor(this.nbx / 2);
    // Si el centro es agua, empezar en la manzana de tierra libre más cercana
    let best = Infinity;
    const center = { bx: this.cbx, by: this.cby };
    for (let by = 0; by < this.nbx; by++) {
      for (let bx = 0; bx < this.nbx; bx++) {
        const d = Math.hypot(bx - center.bx, by - center.by);
        if (d < best && this.free(bx, by)) {
          best = d;
          this.cbx = bx;
          this.cby = by;
        }
      }
    }
    for (const [z, rate] of Object.entries(opts.taxes ?? {})) this.cmd({ type: 'setTaxRate', zone: z as ZoneType, rate: rate! });
    // Avenida desde el borde oeste hasta el centro: la conexión con el exterior
    const y = this.cby * SPACING;
    this.cmd({ type: 'buildRoad', from: { x: 0, y }, to: { x: this.cbx * SPACING, y }, road: 'avenue' }, 'avenida');
  }

  private started = false;

  /** Manzana central de la ciudad (en casillas), para encuadrar la cámara. */
  get center(): { x: number; y: number } {
    return { x: (this.cbx + 0.5) * SPACING, y: (this.cby + 0.5) * SPACING };
  }

  /** Simula `days` días y decide una vez al mes (y al empezar). */
  run(days: number, onMonth?: (s: GameState) => void): void {
    if (!this.started) {
      this.started = true;
      this.decide();
    }
    for (let d = 0; d < days; d++) {
      // Ante un evento elige la opción por defecto (la gratuita)
      const pending = this.s.incidents.pending;
      const def = pending && getIncident(pending.id);
      if (def) applyCommand(this.s, { type: 'decide', choice: defaultChoice(def) });
      const events: SimEvent[] = tick(this.s);
      if (events.some((e) => e.type === 'newMonth')) {
        this.decide();
        onMonth?.(this.s);
      }
      if (this.s.economy.bankrupt) return;
    }
  }

  private cmd(c: Command, label: string = c.type): boolean {
    const r = applyCommand(this.s, c);
    if (r.ok) this.log.built[label] = (this.log.built[label] ?? 0) + 1;
    else this.log.failures[`${label}: ${r.reason}`] = (this.log.failures[`${label}: ${r.reason}`] ?? 0) + 1;
    return r.ok;
  }

  private canSpend(cost: number): boolean {
    return this.s.economy.money - cost >= RESERVE;
  }

  /** Un jugador sensato solo añade mantenimiento mensual si el presupuesto lo aguanta. */
  private canAffordUpkeep(upkeep: number): boolean {
    return estimateBudget(this.s).net - upkeep >= 0;
  }

  private upkeepOf(...ids: string[]): number {
    return ids.reduce((sum, id) => sum + (getBuildingDef(id)?.upkeep ?? 0), 0);
  }

  // ---- Manzanas ----

  private key = (bx: number, by: number) => `${bx},${by}`;

  private free(bx: number, by: number): boolean {
    if (bx < 0 || by < 0 || bx >= this.nbx || by >= this.nbx || this.blocks.has(this.key(bx, by))) return false;
    // Toda la manzana tiene que ser tierra libre
    for (let y = by * SPACING + 1; y <= by * SPACING + INNER; y++) {
      for (let x = bx * SPACING + 1; x <= bx * SPACING + INNER; x++) {
        const i = tileIndex(this.s.map, x, y);
        if (this.s.map.terrain[i] || this.s.map.building[i] !== NO_BUILDING || this.s.map.zoneType[i]) return false;
      }
    }
    return true;
  }

  /** Manzana libre junto a otra ya usada (o la central), con preferencia de zona por tipo. */
  private pickBlock(use: BlockUse): Block | null {
    const candidates: { bx: number; by: number; score: number }[] = [];
    const used = [...this.blocks.values()];
    const seeds = used.length ? used : [{ bx: this.cbx, by: this.cby }];
    const seen = new Set<string>();
    for (const b of seeds) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const bx = b.bx + dx;
        const by = b.by + dy;
        const k = this.key(bx, by);
        if (seen.has(k) || !this.free(bx, by)) continue;
        seen.add(k);
        let score = Math.hypot(bx - this.cbx, by - this.cby);
        // Industria y centrales al este, viviendas al oeste: así la contaminación queda lejos
        const east = bx - this.cbx;
        if ((use === 'I' || use === 'power') && east < 2) score += 20;
        if (use === 'R' && east > 1) score += 20;
        candidates.push({ bx, by, score });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    const c = candidates[0];
    return c ? { bx: c.bx, by: c.by, use } : null;
  }

  /** Calles (con tubería debajo) alrededor de la manzana. */
  private claim(block: Block): void {
    this.blocks.set(this.key(block.bx, block.by), block);
    const x0 = block.bx * SPACING;
    const y0 = block.by * SPACING;
    const x1 = x0 + SPACING;
    const y1 = y0 + SPACING;
    for (const [a, b] of [
      [{ x: x0, y: y0 }, { x: x1, y: y0 }],
      [{ x: x0, y: y1 }, { x: x1, y: y1 }],
      [{ x: x0, y: y0 }, { x: x0, y: y1 }],
      [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    ]) {
      applyCommand(this.s, { type: 'buildRoad', from: a, to: b });
      applyCommand(this.s, { type: 'buildPipe', from: a, to: b });
    }
  }

  private inner(block: Block) {
    return { x: block.bx * SPACING + 1, y: block.by * SPACING + 1 };
  }

  // ---- Decisiones ----

  private decide(): void {
    const s = this.s;
    if (s.economy.bankrupt) return;
    if (s.economy.money < 0 && s.economy.loans.length < MAX_LOANS && this.opts.loans !== false) {
      if (this.cmd({ type: 'takeLoan', amount: 25_000 }, 'préstamo')) this.log.loans++;
    }
    this.ensurePower();
    this.ensureWater();
    if (this.opts.services !== false) this.ensureServices();
    for (const z of ['R', 'C', 'I'] as const) this.ensureZone(z);
  }

  private ensurePower(): void {
    const { production, demand } = this.s.utilities.power;
    if (production > 0 && demand < production * 0.75) return;
    const coal = getBuildingDef('coal_plant')!;
    if (demand > 40 && this.canSpend(coal.cost + 1_000)) {
      const b = this.pickBlock('power');
      if (!b) return;
      this.claim(b);
      this.cmd({ type: 'placeBuilding', defId: 'coal_plant', at: this.inner(b) });
      return;
    }
    // Al principio: turbinas, que son baratas
    let block = [...this.blocks.values()].find((b) => b.use === 'power' && this.hasRoomForTurbine(b));
    if (!block) {
      if (!this.canSpend(3_000)) return;
      const b = this.pickBlock('power');
      if (!b) return;
      this.claim(b);
      block = b;
    }
    for (let k = 0; k < 2 && this.canSpend(1_500); k++) {
      const spot = this.freeSpot(block);
      if (spot) this.cmd({ type: 'placeBuilding', defId: 'wind_turbine', at: spot });
    }
  }

  private hasRoomForTurbine(b: Block): boolean {
    return this.freeSpot(b) !== null;
  }

  private freeSpot(b: Block): { x: number; y: number } | null {
    const { x, y } = this.inner(b);
    for (let dy = 0; dy < INNER; dy++) {
      for (let dx = 0; dx < INNER; dx++) {
        if (this.s.map.building[tileIndex(this.s.map, x + dx, y + dy)] === NO_BUILDING) return { x: x + dx, y: y + dy };
      }
    }
    return null;
  }

  private ensureWater(): void {
    const { production, demand } = this.s.utilities.water;
    if (this.s.stats.population < 100 || (production > 0 && demand < production * 0.75)) return;
    let block = [...this.blocks.values()].find((b) => b.use === 'water' && this.freeSpot(b));
    if (!block) {
      if (!this.canSpend(3_000)) return;
      const b = this.pickBlock('water');
      if (!b) return;
      this.claim(b);
      block = b;
    }
    for (let k = 0; k < 2 && this.canSpend(1_200); k++) {
      const spot = this.freeSpot(block);
      if (spot) this.cmd({ type: 'placeBuilding', defId: 'water_tower', at: spot });
    }
  }

  private ensureServices(): void {
    const { coverage } = this.s.layers;
    for (const r of [...this.blocks.values()].filter((b) => b.use === 'R')) {
      const { x, y } = this.inner(r);
      const c = tileIndex(this.s.map, x + 1, y + 1);
      const missing = (['police', 'fire', 'health'] as const).filter((k) => coverage[k][c] < LOW_COVERAGE);
      if (missing.length && this.canSpend(11_000) && this.canAffordUpkeep(this.upkeepOf('police_station', 'fire_station', 'clinic', 'plaza'))) {
        const b = this.pickBlock('civic');
        if (!b) return;
        this.claim(b);
        const at = this.inner(b);
        this.cmd({ type: 'placeBuilding', defId: 'police_station', at }, 'comisaría');
        this.cmd({ type: 'placeBuilding', defId: 'fire_station', at: { x: at.x + 2, y: at.y } }, 'bomberos');
        this.cmd({ type: 'placeBuilding', defId: 'clinic', at: { x: at.x, y: at.y + 2 } }, 'clínica');
        this.cmd({ type: 'placeBuilding', defId: 'plaza', at: { x: at.x + 2, y: at.y + 2 } }, 'plaza');
        return; // una manzana de servicios al mes como mucho
      }
      if (coverage.education[c] < LOW_COVERAGE && this.canSpend(6_000) && this.canAffordUpkeep(this.upkeepOf('elementary_school', 'park_small', 'park_small'))) {
        const b = this.pickBlock('school');
        if (!b) return;
        this.claim(b);
        const at = this.inner(b);
        this.cmd({ type: 'placeBuilding', defId: 'elementary_school', at }, 'escuela');
        this.cmd({ type: 'placeBuilding', defId: 'park_small', at: { x: at.x, y: at.y + 3 } }, 'parque');
        this.cmd({ type: 'placeBuilding', defId: 'park_small', at: { x: at.x + 2, y: at.y + 3 } }, 'parque');
        return;
      }
    }
  }

  private ensureZone(zone: ZoneType): void {
    const s = this.s;
    if (s.stats.demand[zone] < ZONE_DEMAND) return;
    // ¿Quedan lotes vacíos con acceso y electricidad de este tipo?
    let free = 0;
    for (let i = 0; i < s.map.zoneType.length; i++) {
      if (s.map.zoneType[i] === ZONE_CODE[zone] && !s.map.lotLevel[i] && hasRoadAccess(s, i)) free++;
    }
    if (free >= MIN_FREE_LOTS) return;
    const density: Density =
      zone !== 'I' && isUnlocked(s, 5_000) ? 'high' : isUnlocked(s, 1_000) ? 'medium' : 'low';
    if (!this.canSpend(500)) return;
    const b = this.pickBlock(zone);
    if (!b) return;
    this.claim(b);
    const { x, y } = this.inner(b);
    this.cmd({ type: 'zone', rect: { x0: x, y0: y, x1: x + INNER - 1, y1: y + INNER - 1 }, zone, density }, `zona ${zone}`);
  }
}
