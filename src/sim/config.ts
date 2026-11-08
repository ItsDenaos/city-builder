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

// Presupuesto por departamento y ordenanzas (fase 13)
/** Financiación de cada departamento, en %: 100 es lo normal. Cambia el mantenimiento y la cobertura. */
export const FUNDING_MIN = 50;
export const FUNDING_MAX = 150;
export const FUNDING_STEP = 10;
export const FUNDING_DEFAULT = 100;
/** Cada punto de financiación por encima de 100 amplía el radio de cobertura esta fracción (a 150 %, +20 %). */
export const FUNDING_RADIUS_GAIN = 0.004;
/** Ordenanzas que se pueden tener activas a la vez. */
export const MAX_ORDINANCES = 4;
/** Distritos con nombre: máximo, longitud del nombre y lado máximo (casillas). */
export const MAX_DISTRICTS = 12;
export const DISTRICT_NAME_MAX = 24;

// Transporte público (fase 16). Los costes van en la misma unidad que el trayecto en coche
// (una casilla de calle sin tráfico cuesta 1).
/** Coste de cada casilla a pie, de casa a la parada y de la parada al empleo (se mide en línea recta). */
export const WALK_COST = 1.5;
/** Espera media en cada modo con la financiación de transporte al 100 % (a más financiación, más frecuencia). */
export const TRANSIT_WAIT = { bus: 4, metro: 3, train: 6 } as const;
/** El autobús va por las calles: cada casilla cuesta como en coche por este factor (para en las paradas). */
export const BUS_TRAVEL_FACTOR = 1.1;
/** Fracción de la congestión que sufre el autobús (prioridad en cruces, carriles propios en los tramos peores). */
export const BUS_CONGESTION = 0.5;
/** Coste por casilla de túnel de metro: rápido y sin atascos. */
export const METRO_TILE_COST = 0.35;
/** Coste por casilla, en línea recta, entre dos estaciones de tren. */
export const TRAIN_TILE_COST = 0.25;
/** Fracción máxima de trabajadores que deja el coche aunque el transporte sea mucho mejor. */
export const TRANSIT_MAX_SHARE = 0.7;
/** Lo que el coche cuesta y el transporte no (aparcar, gasolina): inclina la balanza hacia el transporte. */
export const CAR_OVERHEAD = 6;
/** Suavidad del reparto entre coche y transporte (curva logística sobre la diferencia de costes). */
export const MODE_SPLIT_SCALE = 5;
/** Viajes de coche que equivale cada viajero de autobús: los autobuses también ocupan la calle. */
export const BUS_ROAD_LOAD = 0.15;
/** Ingresos por billetes: dinero al mes por cada viajero diario. */
export const TRANSIT_FARE = 0.5;
export const METRO_TUNNEL_COST = 30;
/** Mantenimiento mensual por casilla de túnel (se escala con la financiación de transporte). */
export const METRO_TUNNEL_UPKEEP = 0.5;
/** Demanda que trae una estación de tren activa: visitantes para el comercio y mercancías para la industria. */
export const TRAIN_DEMAND: Partial<Record<ZoneType, number>> = { C: 0.03, I: 0.06 };

// Basura y salud (fase 14). Solo funcionan en partidas con `sanitation` (las del menú; no en tests ni balance).
/** Basura que produce al día cada habitante (R) o trabajador (C/I), en unidades de recogida. */
export const GARBAGE_PER_OCCUPANT: Record<ZoneType, number> = { R: 0.02, C: 0.015, I: 0.04 };
/**
 * Basura acumulada (escala 0-100) que suma cada día un lote sin recogida por cada unidad que produce:
 * una casa tarda casi un año en llenarse de basura y una torre, unos días.
 */
export const GARBAGE_BUILDUP = 4;
/** La que se quita cada día un lote con recogida. */
export const GARBAGE_CLEANUP = 10;
/** Un poco de basura no molesta: por encima de esto, cada punto quita felicidad, valor del suelo y salud. */
export const GARBAGE_TOLERANCE = 20;
export const GARBAGE_HAPPINESS = 0.15;
export const GARBAGE_LAND_VALUE = 0.2;
/** Salud de los vecinos (0-100): base + cobertura sanitaria − contaminación − basura. */
export const HEALTH_BASE = 60;
export const HEALTH_COVERAGE = 0.4;
export const HEALTH_POLLUTION = 0.6;
export const HEALTH_GARBAGE = 0.4;
/** Por debajo de esta salud hay enfermos; con salud 0, enferma esta fracción de los vecinos. */
export const HEALTH_SICK = 45;
export const SICK_MAX = 0.2;
/** Felicidad que quita estar enfermo (multiplicada por la fracción de enfermos del lote)... */
export const SICK_HAPPINESS = 15;
/** ...y la que quita además no encontrar cama en una clínica u hospital. */
export const UNTREATED_HAPPINESS = 20;

// Educación y edades (fase 15). Solo funcionan en partidas con `demographics` (las del menú; no en tests ni balance).
/** Mezcla de quien llega a vivir a la ciudad: fracción de niños, adultos y mayores. */
export const ARRIVAL_AGES = { children: 0.25, adults: 0.65, elderly: 0.1 } as const;
/** Fracción de los adultos que trabaja (con la mezcla de llegada da la misma población activa de siempre, ~0,5). */
export const PARTICIPATION = 0.77;
/** Años que se es niño y adulto; nacimientos al año por adulto; mortalidad anual de los mayores con sanidad media. */
export const CHILD_YEARS = 18;
export const ADULT_YEARS = 47;
export const BIRTH_RATE = 0.03;
export const ELDERLY_MORTALITY = 0.08;
/** La mortalidad de los mayores va de ×1,5 sin sanidad a ×0,5 con sanidad 100 (cobertura media de los vecinos). */
export const MORTALITY_HEALTH_EFFECT = 1;
/** Estudios de los adultos que llegan: con malas escuelas y con las mejores (las familias con estudios eligen ciudad). */
export const ARRIVAL_EDUCATION_MIN = { basic: 0.4, higher: 0.08 } as const;
export const ARRIVAL_EDUCATION_MAX = { basic: 0.55, higher: 0.4 } as const;
/** Fracción de los niños en edad de estudios superiores (instituto y universidad). */
export const HIGHER_AGE_SHARE = 0.5;
/** Sueldo relativo de un adulto según sus estudios y pensión de un mayor (multiplican el impuesto residencial). */
export const WAGE = { none: 0.8, basic: 1, higher: 1.5, elderly: 0.5 } as const;
/** Felicidad que quita a todas las viviendas que no haya plaza escolar para ningún niño (proporcional a lo que falta). */
export const SCHOOL_SHORTAGE_HAPPINESS = 8;

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
