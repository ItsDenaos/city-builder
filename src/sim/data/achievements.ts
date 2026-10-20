import type { GameState } from '../state';
import { countBuildings, residentAverages, unemploymentRate } from '../systems/metrics';
import { RANKS } from './progression';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Se comprueba al cerrar cada mes con los datos reales de la simulación. */
  check: (s: GameState) => boolean;
}

const pop = (s: GameState) => s.stats.population;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'primeros', name: 'Primeros vecinos', description: 'Llega a 100 habitantes.', check: (s) => pop(s) >= 100 },
  { id: 'mil', name: 'Mil vecinos', description: 'Llega a 1.000 habitantes.', check: (s) => pop(s) >= 1_000 },
  { id: 'diez-mil', name: 'Diez mil', description: 'Llega a 10.000 habitantes.', check: (s) => pop(s) >= 10_000 },
  {
    id: 'energia-limpia',
    name: 'Energía limpia',
    description: '2.000 habitantes con electricidad suficiente y sin centrales de carbón.',
    check: (s) => pop(s) >= 2_000 && countBuildings(s, 'coal_plant') === 0 && s.utilities.power.production >= s.utilities.power.demand,
  },
  { id: 'cuentas-claras', name: 'Cuentas claras', description: '24 meses seguidos con balance positivo.', check: (s) => s.progress.monthsPositive >= 24 },
  { id: 'sin-deudas', name: 'Libre de deudas', description: 'Termina de pagar un préstamo.', check: (s) => s.progress.loansClosed >= 1 },
  { id: 'pleno-empleo', name: 'Pleno empleo', description: 'Paro por debajo del 2 % con 2.000 habitantes.', check: (s) => pop(s) >= 2_000 && unemploymentRate(s) < 0.02 },
  { id: 'ciudad-feliz', name: 'Ciudad feliz', description: 'Felicidad media de 70 con 3.000 habitantes.', check: (s) => pop(s) >= 3_000 && s.stats.happiness >= 70 },
  {
    id: 'rascacielos',
    name: 'Rascacielos',
    description: 'Un edificio de densidad alta llega al nivel 3.',
    check: (s) => s.map.lotLevel.some((v, i) => v === 3 && s.map.zoneDensity[i] === 2),
  },
  { id: 'trafico-fluido', name: 'Tráfico fluido', description: 'Menos del 2 % de vías saturadas con 10.000 habitantes.', check: (s) => pop(s) >= 10_000 && s.stats.traffic.congestedShare < 0.02 },
  { id: 'aire-puro', name: 'Aire puro', description: 'Contaminación media en las viviendas por debajo de 5 con 5.000 habitantes.', check: (s) => pop(s) >= 5_000 && residentAverages(s).pollution < 5 },
  { id: 'ciudad-segura', name: 'Ciudad segura', description: 'Crimen medio en las viviendas por debajo de 10 con 5.000 habitantes.', check: (s) => pop(s) >= 5_000 && residentAverages(s).crime < 10 },
  { id: 'terrateniente', name: 'Terrateniente', description: 'Compra 4 parcelas de terreno.', check: (s) => s.progress.plotsBought >= 4 },
  { id: 'cortafuegos', name: 'Cortafuegos', description: 'Apaga un incendio sin perder ningún edificio.', check: (s) => s.incidents.firesContained >= 1 },
  { id: 'temple', name: 'Temple', description: 'Toma 10 decisiones ante eventos y desastres.', check: (s) => s.incidents.resolved >= 10 },
  { id: 'escuchar', name: 'Escuchar a los vecinos', description: 'Cumple 5 peticiones del Ágora.', check: (s) => s.agora.petitionsDone >= 5 },
  { id: 'reelegido', name: 'Reelegido', description: 'Gana unas elecciones.', check: (s) => s.agora.electionsWon >= 1 },
  { id: 'akropolis', name: 'Akropolis', description: 'Alcanza el rango más alto.', check: (s) => s.progress.rank === RANKS.length - 1 },
];
