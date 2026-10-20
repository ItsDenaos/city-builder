import { getBuildingDef } from '../sim/data/buildings';
import { ROAD_BY_CODE } from '../sim/data/roads';
import { DENSITY_BY_CODE, DENSITY_LABEL, ZONE_BY_CODE, ZONE_TYPE_LABEL, getZoneDefByCode } from '../sim/data/zones';
import { hasRoadAccess } from '../sim/systems/access';
import { type GameState, NO_BUILDING, inBounds, tileIndex } from '../sim/state';
import { type Point, TERRAIN_WATER } from '../sim/types';
import { formatMoney } from './menus';

export type Tone = 'positive' | 'warning' | 'negative' | undefined;

export interface TileInfo {
  /** Tipo en mayúsculas pequeñas, encima del título. */
  kicker: string;
  title: string;
  rows: { label: string; value: string; tone?: Tone }[];
  /** Medidores 0-100; `higherIsBetter` decide el color. */
  meters: { label: string; value: number; higherIsBetter: boolean }[];
}

const yesNo = (v: number | boolean): { value: string; tone: Tone } => (v ? { value: 'Sí', tone: undefined } : { value: 'No', tone: 'negative' });
const n = (v: number) => Math.round(v).toLocaleString('es-ES');

/** Lo que el inspector muestra de una casilla, con los datos reales de la simulación. */
export function describeTile(state: GameState, p: Point): TileInfo | null {
  const { map, layers } = state;
  if (!inBounds(map, p.x, p.y)) return null;
  const i = tileIndex(map, p.x, p.y);
  const rows: TileInfo['rows'] = [];
  let kicker = 'Terreno';
  let title = map.terrain[i] === TERRAIN_WATER ? 'Agua' : 'Terreno libre';

  const road = ROAD_BY_CODE[map.road[i]];
  if (road) {
    kicker = map.terrain[i] === TERRAIN_WATER ? 'Puente' : 'Vía';
    title = road.name;
    const t = layers.traffic[i];
    rows.push(
      { label: 'Tráfico', value: `${n(t)} / ${n(road.capacity)} viajes al día` },
      { label: 'Carga', value: `${Math.round((t / road.capacity) * 100)} %`, tone: t > road.capacity ? 'negative' : t > road.capacity * 0.7 ? 'warning' : undefined },
    );
  }
  if (map.powerLine[i]) rows.push({ label: 'Tendido eléctrico', value: 'Sí' });
  if (map.waterPipe[i]) rows.push({ label: 'Tubería de agua', value: 'Sí' });

  const zone = ZONE_BY_CODE[map.zoneType[i]];
  if (zone) {
    const def = getZoneDefByCode(map.zoneType[i], map.zoneDensity[i]);
    const level = map.lotLevel[i];
    kicker = `${ZONE_TYPE_LABEL[zone]} ${DENSITY_LABEL[DENSITY_BY_CODE[map.zoneDensity[i]]]}${level ? ` · nivel ${level}` : ''}`;
    title = level ? def.buildingName : 'Parcela sin construir';
    if (map.fire[i]) rows.push({ label: 'Incendio', value: `En llamas desde hace ${map.fire[i]} ${map.fire[i] === 1 ? 'día' : 'días'}`, tone: 'negative' });
    if (level) {
      rows.push({ label: zone === 'R' ? 'Habitantes' : 'Empleados', value: `${n(map.lotOccupants[i])} / ${n(def.capacity[level - 1])}` });
    }
    rows.push(
      { label: 'Acceso a carretera', ...yesNo(hasRoadAccess(state, i)) },
      { label: 'Electricidad', ...yesNo(layers.powered[i]) },
      { label: 'Agua', ...yesNo(layers.watered[i]) },
    );
    if (level && zone === 'R') {
      const c = layers.commute[i];
      rows.push(c < 0 ? { label: 'Trayecto al trabajo', value: 'Sin empleo alcanzable', tone: 'negative' } : { label: 'Trayecto al trabajo', value: n(c) });
    }
  }

  const id = map.building[i];
  if (id !== NO_BUILDING) {
    const b = state.buildings.get(id);
    const def = b && getBuildingDef(b.defId);
    if (b && def) {
      kicker = { power: 'Electricidad', water: 'Agua', services: 'Servicio público', parks: 'Parque' }[def.category];
      title = def.name;
      if (b.outage) rows.push({ label: 'Avería', value: `Al 40 % durante ${b.outage} ${b.outage === 1 ? 'día' : 'días'} más`, tone: 'negative' });
      rows.push({ label: 'Mantenimiento', value: `${formatMoney(def.upkeep)} / mes` });
      if (def.power?.produces) rows.push({ label: 'Produce', value: `${def.power.produces} MW` });
      if (def.power?.consumes) rows.push({ label: 'Consume', value: `${def.power.consumes} MW` });
      if (def.water?.produces) rows.push({ label: 'Agua producida', value: n(def.water.produces) });
      if (def.water?.consumes) rows.push({ label: 'Agua consumida', value: n(def.water.consumes) });
      if (def.coverage) rows.push({ label: 'Radio de cobertura', value: `${def.coverage.radius} casillas` });
      if (def.capacity?.jobs) rows.push({ label: 'Empleos', value: n(def.capacity.jobs) });
      rows.push({ label: 'Electricidad', ...yesNo(layers.powered[i]) });
    }
  }

  const meters: TileInfo['meters'] = [];
  if (zone === 'R' && map.lotLevel[i]) meters.push({ label: 'Felicidad', value: layers.happiness[i], higherIsBetter: true });
  if (map.terrain[i] !== TERRAIN_WATER) {
    meters.push(
      { label: 'Valor del suelo', value: layers.landValue[i], higherIsBetter: true },
      { label: 'Contaminación', value: layers.pollution[i], higherIsBetter: false },
      { label: 'Crimen', value: layers.crime[i], higherIsBetter: false },
      { label: 'Policía', value: layers.coverage.police[i], higherIsBetter: true },
      { label: 'Bomberos', value: layers.coverage.fire[i], higherIsBetter: true },
      { label: 'Salud', value: layers.coverage.health[i], higherIsBetter: true },
      { label: 'Educación', value: layers.coverage.education[i], higherIsBetter: true },
      { label: 'Parques', value: layers.coverage.park[i], higherIsBetter: true },
    );
  }
  return { kicker, title, rows, meters };
}
