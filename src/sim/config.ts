import type { Speed, ZoneType } from './types';

// Números de balance. Todo lo que se ajuste en la fase de balance vive aquí o en los catálogos de data/.

export const DEFAULT_MAP_SIZE = 128;
export const START_MONEY = 50_000;

export const POWER_LINE_COST = 5;
/** Una carretera sobre agua es un puente: cuesta esto multiplicado por el precio de la vía. */
export const BRIDGE_COST_MULTIPLIER = 5;
export const PIPE_COST = 5;
export const BULLDOZE_TILE_COST = 1;
export const BULLDOZE_LOT_COST = 5;
export const BULLDOZE_BUILDING_COST = 50;

/** Distancia máxima (en casillas, a pie) de una zona a una carretera conectada con el exterior. */
export const ROAD_ACCESS_DISTANCE = 3;

// Eventos y desastres (fase 17). El índice es el nivel de la partida: 0 ninguno, 1 pocos, 2 normales, 3 muchos.
/** Probabilidad de que llegue un evento con decisión al cerrar el mes. */
export const INCIDENT_MONTHLY_CHANCE = [0, 0.12, 0.25, 0.45];
/** Días sin eventos después de uno. */
export const INCIDENT_COOLDOWN_DAYS = 60;
/** Probabilidad mensual de avería de cada central grande. */
export const BREAKDOWN_MONTHLY_CHANCE = [0, 0.01, 0.02, 0.035];
/** Una central averiada rinde esta fracción hasta que se repara (los barrios más lejanos se quedan sin luz). */
export const OUTAGE_CAPACITY = 0.4;
/** Riesgo diario de incendio de un edificio de nivel 1 sin bomberos (≈ 1 incendio al año en una ciudad de 1.000 lotes). */
export const FIRE_DAILY_CHANCE = [0, 1e-6, 2e-6, 4e-6];
/** Probabilidad diaria de que el fuego pase a cada vecino sin cobertura de bomberos. */
export const FIRE_SPREAD = 0.08;
/** Días que aguanta un edificio en llamas antes de quedar destruido. */
export const FIRE_BURN_DAYS = 6;
/** Probabilidad diaria de apagar un fuego con cobertura de bomberos 100. */
export const FIRE_EXTINGUISH = 0.5;

// Ágora (fase 18)
/** Mensajes de vecinos que se guardan. */
export const POSTS_KEPT = 40;
/** Probabilidad mensual de que la queja más repetida se convierta en petición. */
export const PETITION_CHANCE = 0.25;
/** Aprobación que se gana al cumplir una petición (y se pierde al no cumplirla a tiempo). */
export const PETITION_APPROVAL = 6;
/** Fracción del camino hacia la aprobación objetivo que se recorre cada mes. */
export const APPROVAL_SMOOTHING = 0.25;
/** Ventaja de quien gobierna: con felicidad media (50) la aprobación ronda 55. */
export const APPROVAL_INCUMBENT = 5;
export const ELECTION_YEARS = 4;

/** Deshacer (fase 11): acciones que se recuerdan y días de juego durante los que se pueden deshacer. */
export const UNDO_MAX_ENTRIES = 50;
export const UNDO_MAX_DAYS = 30;

// Demanda RCI (fase 3). Valores en [-1, 1].
export const WORKFORCE_RATIO = 0.5; // fracción de habitantes que trabaja
export const BASE_RESIDENTIAL_JOBS = 20; // empleos "virtuales" para que una ciudad vacía empiece a crecer
export const BASE_INDUSTRIAL_DEMAND = 40; // mercado exterior para la industria
export const COMMERCE_PER_RESIDENT = 0.25; // empleos comerciales que pide cada habitante
export const INDUSTRY_PER_RESIDENT = 0.3; // empleos industriales que pide cada habitante
export const DEMAND_SCALE = 50; // evita que la demanda se dispare con números pequeños
export const DEMAND_SMOOTHING = 0.1; // fracción del objetivo que se aplica cada día

// Crecimiento de lotes
export const DEVELOP_CHANCE = 0.05; // por día, con demanda 1
export const OCCUPANCY_STEP = 0.05; // fracción de la capacidad que entra/sale por día
export const LEVEL_UP_CHANCE = 0.01; // por día, con el lote lleno
export const LEVEL_UP_MIN_DEMAND = 0.05; // la demanda R a largo plazo ronda 0,1
export const MOVE_OUT_DEMAND = -0.2; // por debajo, los residentes se van

// Electricidad y agua (fase 4). Las carreteras, zonas y edificios conducen la electricidad;
// el agua llega por tuberías a las casillas cercanas.
export const POWER_PER_CAPACITY = 0.02; // MW por habitante/empleo de capacidad: una central de carbón da para ~5.000 habitantes
export const WATER_PER_CAPACITY = 0.02; // unidades de agua por habitante/empleo de capacidad
export const PIPE_RADIUS = 2; // casillas (en cuadrado) que cubre cada tubería

// Economía (fase 5). Todo en $ por mes.
export const TAX_DEFAULT = 9; // %
export const TAX_MIN = 0;
export const TAX_MAX = 20;
/** Impuesto que no altera la demanda; cada punto por encima la reduce y por debajo la aumenta. */
export const TAX_NEUTRAL = 9;
export const TAX_DEMAND_EFFECT = 0.02; // demanda por punto de impuesto
/** Por encima de este impuesto cada punto pesa cada vez más (castigo cuadrático): subir mucho no compensa. */
export const TAX_HIGH = 12;
export const TAX_HIGH_EFFECT = 0.03;
/** Recaudación por habitante (R) o trabajador (C/I) y punto de impuesto. */
export const TAX_PER_CAPITA: Record<ZoneType, number> = { R: 0.1, C: 0.12, I: 0.1 };
export const NETWORK_UPKEEP = 0.2; // por casilla de tendido eléctrico o tubería
export const LOAN_AMOUNTS = [10_000, 25_000, 50_000] as const;
export const LOAN_ANNUAL_RATE = 0.1;
export const LOAN_MONTHS = 120;
export const MAX_LOANS = 3;
export const BUDGET_HISTORY_MONTHS = 120;
export const STATS_HISTORY_MONTHS = 240;
/** Meses seguidos con saldo negativo hasta la bancarrota. */
export const BANKRUPTCY_MONTHS = 12;

// Tráfico (fase 7). Los costes y capacidades de cada vía están en data/roads.ts.
export const SHOPPING_TRIPS_PER_RESIDENT = 0.2; // viajes diarios a comercios por habitante
/** Coste extra de recorrer una casilla al 100 % de su capacidad (crece con el cuadrado de la carga). */
export const CONGESTION_COST = 3;
export const TRAFFIC_SMOOTHING = 0.3; // fracción del tráfico nuevo que se aplica cada día
export const COMMUTE_OK = 25; // trayecto (en coste de viaje) a partir del cual molesta
export const COMMUTE_HAPPINESS = 0.5; // felicidad que quita cada unidad de trayecto por encima
export const COMMUTE_MAX_PENALTY = 25;
export const NO_JOB_ACCESS_PENALTY = 15; // sin ningún empleo alcanzable por carretera
export const TRAFFIC_POLLUTION = 15; // contaminación máxima de una vía al 100 % de capacidad
export const TRAFFIC_POLLUTION_MAX = 30;
export const TRAFFIC_POLLUTION_RADIUS = 2;

// Influencia (fase 6). Todas las capas van de 0 a 100.
export const LAND_VALUE_BASE = 30; // con una escuela cerca ya se alcanza el nivel 2
export const WATERFRONT_BONUS = 15; // junto al agua, decreciendo hasta WATERFRONT_RADIUS
export const WATERFRONT_RADIUS = 3;
export const SERVICE_LAND_VALUE = 0.1; // por punto de cobertura de policía, bomberos, salud y educación
export const POLLUTION_LAND_VALUE = 0.5;
export const CRIME_LAND_VALUE = 0.3;
/** Contaminación máxima de un lote industrial de nivel 1 por densidad; se multiplica por el nivel. */
export const INDUSTRY_POLLUTION: readonly [number, number, number] = [8, 14, 20];
export const INDUSTRY_POLLUTION_RADIUS = 4;
export const CRIME_PER_OCCUPANT = 0.15; // crimen máximo que genera cada habitante o trabajador (R y C)
export const CRIME_RADIUS = 3;
export const POLICE_CRIME_REDUCTION = 1; // crimen que quita cada punto de cobertura policial
/** Valor del suelo necesario para alcanzar cada nivel (R y C); índice = nivel destino. */
export const LEVEL_LAND_VALUE: readonly number[] = [0, 0, 35, 55];
/** Cobertura educativa necesaria para que la industria alcance cada nivel. */
export const INDUSTRY_LEVEL_EDUCATION: readonly number[] = [0, 0, 20, 50];
export const HAPPINESS_BASE = 50;
/**
 * Felicidad que quita el paro estructural (puestos que faltan / población activa).
 * No se usa el paro del día: las contrataciones van un día por detrás de las mudanzas y eso
 * provocaba un ciclo de llegadas y huidas.
 */
export const UNEMPLOYMENT_HAPPINESS = 20;
export const UNHAPPY_MOVE_OUT = 25; // por debajo, los vecinos se van aunque haya demanda
export const HAPPINESS_DEMAND_EFFECT = 0.006; // demanda R por punto de felicidad sobre/bajo 50

export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const START_YEAR = 2000;

/** Milisegundos reales por día de juego según la velocidad. */
export const MS_PER_DAY: Record<Speed, number> = {
  0: Infinity,
  1: 1000,
  2: 400,
  3: 100,
};
