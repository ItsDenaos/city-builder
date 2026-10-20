import { BANKRUPTCY_MONTHS, ROAD_ACCESS_DISTANCE } from '../config';
import { getBuildingDef } from '../data/buildings';
import { ZONE_CODE } from '../data/zones';
import type { GameState } from '../state';
import type { SimEvent } from '../types';

const HIGH_UNEMPLOYMENT = 0.25;
const HIGH_DEMAND = 0.5;
const WATER_ADVICE_POPULATION = 300; // antes de esto, no hace falta insistir con el agua
const MAX_ADVICE_PER_MONTH = 2;
const HIGH_TAX = 14;
const LOW_RESERVE_MONTHS = 6; // avisar si al ritmo actual el dinero dura menos que esto
const SERVICE_ADVICE_POPULATION = 500;
const LOW_COVERAGE = 30;
const HIGH_CRIME = 40;
const HIGH_POLLUTION = 30;
const LOW_HAPPINESS = 40;
const CONGESTED_SHARE = 0.1; // fracción de vías saturadas a partir de la cual avisar
const LONG_COMMUTE = 30;

/** Una vez al mes revisa la ciudad y emite como mucho dos consejos, por orden de importancia. */
export function advise(state: GameState, events: SimEvent[]): void {
  if (!events.some((e) => e.type === 'newMonth')) return;
  const { map, stats, utilities } = state;
  const { roadAccess: access, powered, watered } = state.layers;
  let zoned = 0;
  let zonedWithAccess = 0;
  let connectedRoads = 0;
  let emptyResidential = 0;
  let unpoweredWithAccess = 0;
  let lots = 0;
  let unwateredLots = 0;

  for (let i = 0; i < map.zoneType.length; i++) {
    if (map.road[i] && access[i] === 0) connectedRoads++;
    if (!map.zoneType[i]) continue;
    zoned++;
    if (map.lotLevel[i]) {
      lots++;
      if (!watered[i]) unwateredLots++;
    }
    if (access[i] > ROAD_ACCESS_DISTANCE) continue;
    zonedWithAccess++;
    if (!powered[i]) unpoweredWithAccess++;
    if (map.zoneType[i] === ZONE_CODE.R && !map.lotLevel[i]) emptyResidential++;
  }
  const hasProducer = (kind: 'power' | 'water') =>
    [...state.buildings.values()].some((b) => (getBuildingDef(b.defId)?.[kind]?.produces ?? 0) > 0);

  const advice: string[] = [];
  const { economy } = state;
  const net = economy.lastMonth?.net ?? 0;
  if (economy.money < 0) {
    const left = BANKRUPTCY_MONTHS - economy.monthsInDebt;
    advice.push(`¡Estás en números rojos! En ${left} ${left === 1 ? 'mes' : 'meses'} la ciudad irá a la bancarrota: sube impuestos, recorta gastos o pide un préstamo.`);
  } else if (net < 0 && economy.money < -net * LOW_RESERVE_MONTHS) {
    advice.push('Pierdes dinero cada mes y te queda poco: sube impuestos o reduce gastos.');
  }
  if (zoned && !zonedWithAccess) {
    advice.push(
      connectedRoads
        ? `Las zonas necesitan una carretera a ${ROAD_ACCESS_DISTANCE} casillas o menos.`
        : 'Conecta tus carreteras con el borde del mapa para que lleguen habitantes.',
    );
  }
  if (unpoweredWithAccess) {
    if (!hasProducer('power')) advice.push('Construye una central eléctrica: sin electricidad las zonas no crecen.');
    else if (utilities.power.demand > utilities.power.production) advice.push('No hay electricidad suficiente: construye otra central.');
    else advice.push('Hay zonas sin electricidad: conéctalas con carreteras o tendido eléctrico.');
  }
  if (stats.workforce >= 20 && stats.workforce - stats.employed > stats.workforce * HIGH_UNEMPLOYMENT) {
    advice.push('Hay mucho desempleo: zonifica comercio o industria.');
  }
  if (stats.population >= WATER_ADVICE_POPULATION && unwateredLots > lots / 2) {
    if (!hasProducer('water')) advice.push('Sin agua los edificios no pasan del nivel 1: construye una torre o bomba de agua y tuberías.');
    else if (utilities.water.demand > utilities.water.production) advice.push('No hay agua suficiente: construye otra bomba o torre de agua.');
    else advice.push('Muchos edificios no tienen agua: extiende las tuberías.');
  }
  // Medias de lo que viven los habitantes (ponderadas por ocupantes de lotes residenciales)
  if (stats.population >= SERVICE_ADVICE_POPULATION) {
    const { coverage, crime, pollution } = state.layers;
    const avg = { police: 0, fire: 0, health: 0, education: 0, crime: 0, pollution: 0 };
    let residents = 0;
    for (let i = 0; i < map.zoneType.length; i++) {
      if (map.zoneType[i] !== ZONE_CODE.R || !map.lotOccupants[i]) continue;
      const n = map.lotOccupants[i];
      residents += n;
      avg.police += coverage.police[i] * n;
      avg.fire += coverage.fire[i] * n;
      avg.health += coverage.health[i] * n;
      avg.education += coverage.education[i] * n;
      avg.crime += crime[i] * n;
      avg.pollution += pollution[i] * n;
    }
    for (const k of Object.keys(avg) as (keyof typeof avg)[]) avg[k] /= residents || 1;
    if (avg.crime > HIGH_CRIME) advice.push('El crimen es alto en los barrios: construye comisarías.');
    if (avg.pollution > HIGH_POLLUTION) advice.push('La contaminación llega a las viviendas: aleja la industria o la central.');
    if (avg.health < LOW_COVERAGE) advice.push('Los vecinos no tienen atención médica cerca: construye una clínica.');
    if (avg.education < LOW_COVERAGE) advice.push('Faltan escuelas: sin educación la industria no progresa.');
    if (avg.fire < LOW_COVERAGE) advice.push('Muchos barrios no tienen bomberos cerca.');
    if (stats.traffic.congestedShare > CONGESTED_SHARE) advice.push('Hay atascos: construye avenidas o rutas alternativas.');
    if (stats.traffic.avgCommute > LONG_COMMUTE) advice.push('Los trayectos al trabajo son largos: acerca empleos y viviendas.');
    if (stats.happiness < LOW_HAPPINESS) advice.push('Los habitantes están descontentos: mejora servicios y parques.');
  }
  const highTaxes = (['R', 'C', 'I'] as const).filter((z) => economy.taxes[z] >= HIGH_TAX);
  if (highTaxes.length) advice.push('Los impuestos altos están frenando la demanda de la ciudad.');
  if (stats.demand.R > HIGH_DEMAND && zonedWithAccess && !emptyResidential) {
    advice.push('Hay demanda de viviendas: zonifica más área residencial.');
  }

  for (const text of advice.slice(0, MAX_ADVICE_PER_MONTH)) events.push({ type: 'advice', text });
}
