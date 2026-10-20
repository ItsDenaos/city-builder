import { SELECT_TOOL, type Tool } from '../input/tools';
import type { Command } from '../sim/commands';
import { BULLDOZE_TILE_COST, PIPE_COST, POWER_LINE_COST } from '../sim/config';
import { BUILDINGS, BUILDING_CATEGORIES, getBuildingDef } from '../sim/data/buildings';
import { ROADS } from '../sim/data/roads';
import { ZONES, getZoneDef } from '../sim/data/zones';
import { DATA } from '../theme';
import type { IconName } from './icons';

export interface MenuItem {
  label: string;
  /** Dato secundario: tamaño, capacidad... */
  detail?: string;
  tool: Tool;
  cost: string;
  unlockAtPopulation: number;
  /** Muestra de color (zonas, edificios) o, si no hay, icono. */
  color?: string;
  icon?: IconName;
}

/** Una categoría con un solo elemento selecciona la herramienta directamente. */
export interface MenuCategory {
  id: string;
  label: string;
  icon: IconName;
  /** Atajo de teclado, si lo tiene. */
  key?: string;
  items: MenuItem[];
}

const CATEGORY_ICONS: Record<string, IconName> = { power: 'pylon', water: 'drop', services: 'services', parks: 'park' };

export const formatMoney = (n: number) => `$${Math.round(n).toLocaleString('es-ES')}`;

// Herramientas de red que van delante de los edificios de su categoría
const NETWORK_TOOLS: Partial<Record<string, MenuItem[]>> = {
  power: [
    { label: 'Tendido eléctrico', tool: { kind: 'powerLine' }, cost: `${formatMoney(POWER_LINE_COST)}/casilla`, unlockAtPopulation: 0, color: DATA.power },
  ],
  water: [
    { label: 'Tubería', tool: { kind: 'pipe' }, cost: `${formatMoney(PIPE_COST)}/casilla`, unlockAtPopulation: 0, color: DATA.water },
    { label: 'Quitar tubería', tool: { kind: 'removePipe' }, cost: `${formatMoney(BULLDOZE_TILE_COST)}/casilla`, unlockAtPopulation: 0, icon: 'demolish' },
  ],
};

// La barra de herramientas se genera a partir de los catálogos: un edificio nuevo
// en data/buildings.ts aparece aquí sin tocar la UI.
export const MENUS: readonly MenuCategory[] = [
  {
    id: 'select',
    label: 'Inspeccionar',
    icon: 'inspect',
    key: 'Q',
    items: [{ label: 'Inspeccionar', tool: SELECT_TOOL, cost: '', unlockAtPopulation: 0, icon: 'inspect' }],
  },
  {
    id: 'roads',
    label: 'Carreteras',
    icon: 'road',
    items: Object.values(ROADS).map((r) => ({
      label: r.name,
      detail: `${r.capacity.toLocaleString('es-ES')} viajes/día`,
      tool: { kind: 'road', road: r.kind } as Tool,
      cost: `${formatMoney(r.cost)}/casilla`,
      unlockAtPopulation: 0,
      color: r.color,
    })),
  },
  {
    id: 'zones',
    label: 'Zonas',
    icon: 'zones',
    items: [
      ...ZONES.map((z) => ({
        label: z.label,
        tool: { kind: 'zone', zone: z.type, density: z.density } as Tool,
        cost: `${formatMoney(z.costPerTile)}/casilla`,
        unlockAtPopulation: z.unlockAtPopulation,
        color: z.color,
      })),
      { label: 'Quitar zona', tool: { kind: 'dezone' }, cost: 'gratis', unlockAtPopulation: 0, icon: 'demolish' },
    ],
  },
  ...BUILDING_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    icon: CATEGORY_ICONS[c.id] ?? 'services',
    items: [...(NETWORK_TOOLS[c.id] ?? []), ...BUILDINGS.filter((b) => b.category === c.id).map((b) => ({
      label: b.name,
      detail: `${b.size.w}×${b.size.h}`,
      tool: { kind: 'building', defId: b.id } as Tool,
      cost: formatMoney(b.cost),
      unlockAtPopulation: b.unlockAtPopulation,
      color: b.color,
    }))],
  })),
  {
    id: 'land',
    label: 'Terrenos',
    icon: 'plot',
    items: [{ label: 'Comprar terreno', tool: { kind: 'land' }, cost: '', unlockAtPopulation: 0, icon: 'plot' }],
  },
  {
    id: 'bulldoze',
    label: 'Demoler',
    icon: 'demolish',
    key: 'B',
    items: [{ label: 'Demoler', tool: { kind: 'bulldoze' }, cost: `${formatMoney(BULLDOZE_TILE_COST)}/casilla`, unlockAtPopulation: 0, icon: 'demolish' }],
  },
];

export function toolItem(tool: Tool): MenuItem | null {
  for (const c of MENUS) for (const i of c.items) if (JSON.stringify(i.tool) === JSON.stringify(tool)) return i;
  return null;
}

export function toolLabel(tool: Tool): string {
  return toolItem(tool)?.label ?? '';
}

/** Nombre corto de una acción, para los avisos de deshacer y rehacer. */
export function commandLabel(cmd: Command): string {
  switch (cmd.type) {
    case 'buildRoad':
      return ROADS[cmd.road ?? 'street'].name;
    case 'zone':
      return getZoneDef(cmd.zone, cmd.density).label;
    case 'dezone':
      return 'Quitar zona';
    case 'placeBuilding':
      return getBuildingDef(cmd.defId)?.name ?? 'Edificio';
    case 'buildPowerLine':
      return 'Tendido eléctrico';
    case 'buildPipe':
      return 'Tubería';
    case 'removePipe':
      return 'Quitar tubería';
    case 'bulldoze':
      return 'Demolición';
    case 'buyPlot':
      return 'Compra de parcela';
    default:
      return 'Acción';
  }
}
