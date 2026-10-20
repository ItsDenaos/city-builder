import { BRAND, DATA } from '../../theme';

/**
 * Dirección de arte del mundo: "maqueta de arquitecto".
 * La ciudad se ve como una maqueta de estudio sobre un zócalo de mármol, encima de una mesa Midnight Slate:
 * base color salvia, volúmenes en tonos mármol con tejados teñidos por zona, agua pizarra,
 * calles grafito con líneas mármol y avenidas con eje de oro.
 * El oro se reserva para lo que tiene significado: avenidas, selección y emblemas de servicios.
 */
export const WORLD = {
  // Mesa y zócalo
  table: BRAND.slate,
  tableGrid: 'rgba(234, 230, 220, 0.045)',
  plinthTop: '#EFEBE2',
  plinth: '#D9D3C5',
  plinthShade: '#B9B2A3',
  plinthShadow: 'rgba(5, 14, 20, 0.45)',

  // Terreno
  /** Extremos del tono del terreno: varía con un ruido suave, como la base pintada de una maqueta. */
  groundLow: '#A0B092',
  groundHigh: '#B2BEA3',
  water: '#2F5062',
  waterLight: '#6E909F',
  shore: '#D8D0BC',
  yard: { R: '#B6C2A6', C: '#CCC8BD', I: '#B4AD9F' },
  pavement: '#D5D0C3',
  parkGround: '#93AB8C',

  // Calles
  street: '#4B535A',
  avenue: '#3E464E',
  sidewalk: '#C4BEB0',
  lane: BRAND.marble,
  avenueLine: BRAND.gold,
  bridge: '#56616A',
  rail: '#A9B0B3',

  // Luz
  shadow: 'rgba(23, 43, 58, 0.30)',
  treeShadow: 'rgba(23, 43, 58, 0.24)',

  // Vegetación
  tree: '#6A8C7E',
  treeLight: '#8FAC9F',
  treeDark: BRAND.olive,
  trunk: '#6B5A48',

  // Incendios
  fire: '#E8873A',
  fireCore: '#F6CF7E',
  char: '#1E2328',
  smoke: '#2B3238',

  // Redes
  pylon: '#59524A',
  wire: '#4A443D',

  // Selección y herramienta
  hover: 'rgba(234, 230, 220, 0.9)',
  selected: BRAND.gold,
  previewOk: 'rgba(125, 196, 160, 0.5)',
  previewBad: 'rgba(229, 128, 111, 0.55)',
  grid: 'rgba(23, 43, 58, 0.16)',

  // Vistas de datos
  dim: 'rgba(14, 29, 40, 0.62)',
  served: 'rgba(232, 197, 71, 0.62)',
  waterServed: 'rgba(90, 179, 217, 0.72)',
  waterCovered: 'rgba(90, 179, 217, 0.3)',
  unserved: 'rgba(229, 128, 111, 0.68)',
  pipe: DATA.water,
  noPower: DATA.power,

  // Emblemas de servicios sobre el tejado
  emblem: BRAND.gold,
  cross: '#C0503F',
} as const;

/** Materiales de los edificios: muros mármol, tejados con el matiz de su zona. */
export const MATERIALS = {
  houseWalls: ['#EAE6DC', '#E4DED1', '#DDD6C7'],
  houseRoofs: ['#C48D6B', '#B37C5F', '#CFA27F', '#A27A69', '#8F8B85'],
  aptWalls: ['#E3DDCF', '#D9D2C2', '#DED8CB'],
  aptRoofs: ['#A69C8E', '#9A9184', '#ADA394'],
  towerWalls: ['#D7DAD5', '#CCD2D1', '#DCDDD8'],
  towerRoof: '#8C969A',
  shopWalls: ['#EAE6DC', '#E2DCCF'],
  shopRoof: '#8FA2AE',
  awnings: ['#B5523F', BRAND.olive, BRAND.gold, '#3E6A8A', '#8D6E9E'],
  glass: ['#7F9DB0', '#8BA7B8', '#7593A6', '#87A2B4'],
  officeRoof: '#4E6575',
  officeTowerRoof: '#43596A',
  factoryWalls: ['#C9BFA9', '#BDB39D', '#CFC6B2'],
  factoryRoofs: ['#8A8172', '#7E766A', '#958B7B'],
  chimneyWall: '#8C857C',
  chimneyRoof: '#4D4944',
  window: '#5C6C78',
  windowGlass: '#C9D8E0',
  pool: '#6FA8C4',
  poolEdge: BRAND.marble,
} as const;

/** Colores de los servicios y centrales (los edificios del jugador). */
export const CIVIC = {
  coalWall: '#7C756D',
  coalRoof: '#4D4944',
  pumpWall: '#4E7F99',
  pumpRoof: '#3D6982',
  towerTank: '#9DC0D2',
  towerTankRoof: '#86ADC2',
  towerLegs: '#6F7A82',
  policeWall: '#E3E6E6',
  policeRoof: '#2E4A61',
  fireWall: '#EDE3DA',
  fireRoof: '#A9574A',
  garage: '#5A3A32',
  clinicWall: '#F1EEE7',
  clinicRoof: '#E1DDD3',
  schoolWall: '#E6CFAE',
  schoolRoof: '#A8744E',
  plaza: '#DDD7CA',
  fountain: '#6FA8C4',
  turbine: '#F1EFEA',
  turbineHub: '#9AA4AB',
  smoke: '225, 225, 222',
} as const;

export const CARS = [BRAND.marble, '#B5523F', '#3E6A8A', BRAND.gold, '#2B3238', BRAND.olive, '#9AA3A8'] as const;

