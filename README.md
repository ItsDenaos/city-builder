# AKROPOLIS

**BUILD BEYOND.**

Simulación urbana para navegador al estilo SimCity / Cities: Skylines. La ciudad se dibuja como una maqueta de arquitecto: volúmenes en tonos mármol con tejados teñidos por zona, sobre un zócalo elevado (la "ciudad en alto"), todo generado por código, sin imágenes.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173  (?seed=123 para otro mapa de fondo)
npm test           # tests (simulación, guardado, marca y objetivos de balance, ~3 min)
npm run balance    # informe de balance: el jugador automático juega varios escenarios
npm run build      # comprobación de tipos y versión de producción en dist/
npm run preview    # sirve la versión de producción de dist/ (http://localhost:4173)
```

## Desplegar en Netlify

El juego es una página estática: Netlify compila con `npm run build` y publica `dist/`. Toda la configuración está en `netlify.toml` (versión de Node, caché de los archivos con hash y redirección de cualquier ruta al juego).

1. En [app.netlify.com](https://app.netlify.com), **Add new site → Import an existing project → GitHub** y elige `ItsDenaos/city-builder`.
2. Netlify lee `netlify.toml`: no hay que tocar la configuración de compilación. Pulsa **Deploy**.
3. A partir de ahí, cada `git push` a `master` publica una versión nueva (y cada pull request, una vista previa).

Sin conectar el repositorio, también se puede subir a mano desde la terminal (pide iniciar sesión en Netlify la primera vez):

```bash
npm run build
npx netlify-cli deploy --prod --dir dist
```

Las partidas se guardan en el navegador de cada jugador (`localStorage`), así que no hace falta servidor ni base de datos.

## Controles

| Acción | Control |
|---|---|
| Usar herramienta | Clic / arrastre izquierdo |
| Mover cámara | Arrastre derecho o central, WASD, flechas |
| Zoom | Rueda del ratón |
| Pausa / velocidad | Espacio, 1, 2, 3 |
| Ágora · Progreso · Presupuesto · Estadísticas · Ayuda | G · L · P · E · H |
| Inspeccionar / calle / demoler | Q / R / B |
| Franja de zonas junto a calles (todo, 1, 2, 3) | F |
| Deshacer / rehacer | Ctrl+Z / Ctrl+Y (o Ctrl+Mayús+Z) |
| Seguir a un vecino (el de la vivienda seleccionada o uno al azar) | V |
| Modo foto (hora, desenfoque de maqueta y guardar PNG) | M |
| Atrás, salir del modo foto o de seguir, soltar herramienta, menú de pausa | Esc |

Los parques y los edificios de una casilla se colocan en serie arrastrando. Cada vía tiene versión curva (Carreteras → «Calle curva» o «Avenida curva»: arrastra de un extremo a otro), y la categoría Terreno excava agua o rellena tierra. En Ajustes (menú principal o de pausa) se eligen el idioma (español o inglés), el autoguardado, mover la cámara con los bordes de la pantalla, el tamaño de la interfaz, reducir animaciones, los consejos del asesor, el volumen del sonido, el ciclo de día y noche y los colores para daltonismo.

## Identidad AKROPOLIS

| Elemento | Dónde |
|---|---|
| Colores, tipografía, espaciado y radios | `src/theme.ts` (única fuente). `applyTheme()` los publica como variables CSS (`--ui-*`, `--data-*`, `--brand-*`, `--font-*`); el canvas los importa directamente |
| Paleta del mundo (maqueta) | `src/render/art/palette.ts`, construida sobre los colores de marca |
| Símbolo y logotipo | `src/ui/brand.ts` (SVG generado en el código). Archivos exportados en `public/brand/`: símbolo claro, oscuro y monocromo, logotipo claro y oscuro y favicon. `tests/brand.test.ts` comprueba que coinciden con el código |
| Iconos | `src/ui/icons.ts`: una sola familia de trazo (1,6 px, esquinas rectas) en rejilla de 20 × 20 |
| Estilos | `src/styles/`: `base`, `components`, `hud`, `panels` y `menu` |

- **Colores de marca:** Midnight Slate `#172B3A`, Aegean Gold `#D2AE70`, Marble `#EAE6DC` y Olive Grove `#577A70`.
- **Uso del oro:** solo donde tiene significado. Marca la selección (una línea de 2 px), los ejes de las avenidas, los emblemas de los servicios públicos, el remate de las torres más altas y los desbloqueos.
- **Colores de datos:** conservan su significado habitual (verde residencial, azul comercial, amarillo industrial, rojo para lo negativo) en tonos que conviven con la marca. Hay dos paletas para daltonismo (rojo-verde y azul-amarillo, en `VISION_PALETTES` de `src/theme.ts`) que cambian zonas, estados y vistas de datos; `tests/colorvision.test.ts` comprueba con una simulación de daltonismo que se distinguen.
- **Tipografía:** Sora para el logotipo y los títulos, e IBM Plex Sans para la interfaz y las cifras (tabulares). Se cargan de Google Fonts y, si no cargan, se usa la fuente del sistema. Los SVG exportados del logotipo usan Sora solo si está instalada.
- **Disposición del HUD:**
  - arriba, el estado de la ciudad;
  - abajo, el dock de construcción;
  - a la izquierda, el inspector de casilla;
  - a la derecha, el carril de gestión.

  En el menú principal, una ciudad de demostración crece en directo detrás del logotipo.
- **Idioma:** la interfaz está en español. El inglés se reserva para la marca (el lema BUILD BEYOND.) y para la traducción opcional (Ajustes → Idioma), que es una capa aparte (`src/ui/i18n.ts`): el código del juego sigue escrito en español.

## Arquitectura

```
src/
  theme.ts      sistema de diseño (tokens)
  sim/          lógica pura, sin DOM (se prueba con Vitest)
    state.ts      GameState y mapa en capas tipadas (struct of arrays)
    commands.ts   única forma de modificar el estado: validan, cobran y aplican
    undo.ts       deshacer y rehacer: antes y después de las casillas que toca cada comando
    land.ts       terreno por parcelas
    tutorial.ts   primeros pasos: objetivos que se cumplen mirando el estado
    zoning.ts     franjas de zonificación junto a las calles
    effects.ts    efectos temporales de los eventos (los consultan los sistemas)
    save.ts       serializar y restaurar partidas (las capas derivadas se recalculan)
    simulation.ts tick diario y lista de sistemas
    autoplayer.ts jugador automático (balance y ciudad de demostración)
    systems/      un archivo por sistema (demanda, crecimiento, redes, economía, influencia, tráfico, transporte, basura, salud, demografía, turismo, distritos...)
    data/         catálogos de zonas, edificios, vías, departamentos y ordenanzas: los menús se generan a partir de aquí
    host.ts       anfitrión de la simulación (tick, comandos, deshacer) que corre en el worker
    worker.ts     Web Worker de la simulación
  simClient.ts  la pestaña: habla con el worker y predice los comandos mientras llega el estado
  render/       cámara y canvas (solo lee el estado); ambient.ts: día y noche y tiempo
    art/          suelo, calles, edificios, coches, paleta y la imagen por casilla para el zoom alejado
  input/        ratón, teclado y herramientas -> comandos
  ui/           HUD, menús, paneles, marca, iconos y descripciones emergentes; i18n.ts: traducción al inglés
  styles/       hojas de estilo
public/brand/   logotipo y favicon en SVG
balance/        informes de balance (npm run balance)
```

## Roadmap

- [x] **Fase 0**: setup (Vite + TS + Vitest), bucle de juego con paso fijo
- [x] **Fase 1**: mapa generado por semilla, cámara (pan/zoom), hover, selección
- [x] Base de la fase 2: comandos de carretera, zonas, edificios y demoler, con costes y previsualización
- [x] **Fase 2**: herramientas de construcción (deshacer y rehacer, franjas y colocación en serie llegaron en la fase 11, y las carreteras curvas al final: cada vía tiene versión curva que traza un arco entre sus extremos; los giros se dibujan redondeados y los tramos en escalera, como una diagonal)
- [x] **Fase 3**: demanda RCI, acceso vial (3 casillas, conectado al borde), crecimiento y niveles, empleo, desbloqueos y consejos
- [x] **Fase 4**: electricidad (conducen carreteras, zonas, edificios y tendido) y agua (tuberías con radio 2), reparto por cercanía, vistas de red
- [x] **Fase 5**: economía: impuestos por zona (afectan a la demanda), mantenimiento, cierre mensual, préstamos y bancarrota
- [x] **Fase 6**: cobertura de servicios, contaminación, crimen, valor del suelo y felicidad; los niveles 2-3 exigen valor del suelo (R/C) o educación (I); vistas de calor
- [x] **Fase 7**: tráfico agregado (viajes al trabajo y a comercios por el camino más rápido, congestión que desvía rutas), calles y avenidas, trayectos que afectan a la felicidad, contaminación por tráfico
- [x] **Fase 8**: menú principal y de pausa, nueva partida configurable, guardar/cargar (3 ranuras, autoguardado trimestral y archivo .json), estadísticas con gráficas, ayuda, atajos y puentes
- [x] **Fase 9**: balance con un jugador automático: recaudación y mantenimiento ajustados, valor del suelo base 30, castigo cuadrático de impuestos por encima del 12 %, préstamos con saldo negativo; objetivos fijados en `tests/balance.test.ts`
- [x] **Fase 10**: arte procedural en vista cenital con volumen, animaciones y coches
- [x] **Identidad AKROPOLIS**: sistema de diseño, logotipo, iconos, HUD y menús rediseñados, dirección de arte de maqueta
- [x] **Fase 12**: progresión: 7 rangos con subvención, terreno por parcelas de 32 × 32 que se compran al subir de rango, 14 logros y 4 escenarios con objetivos y plazo
- [x] **Fase 11**: primeros pasos guiados (8 objetivos), deshacer y rehacer (30 días de juego, devuelve el coste de lo que aún no ha cambiado), zonas en franja junto a las calles, parques en serie, modo libre (dinero ilimitado y todo desbloqueado), ajustes y cámara por los bordes
- [x] **Fase 17**: eventos y desastres según el nivel elegido (ninguno, pocos, normales, muchos): incendios que se propagan entre edificios vecinos y que la cobertura de bomberos previene y apaga (las calles y la demolición hacen de cortafuegos), averías de centrales, y seis eventos con decisión (ola de calor, recesión, festival, una fábrica, lluvias torrenciales, un mecenas) con efectos temporales sobre la demanda, la felicidad, el agua o la recaudación
- [x] **Fase 18**: la voz de la ciudad: el Ágora recoge lo que dicen vecinos y negocios de cada barrio (cada mensaje sale de la causa real de su lote y lleva a su sitio), las quejas repetidas se convierten en peticiones con plazo (±6 de aprobación), la aprobación del alcalde sigue a la felicidad, el paro, los impuestos y las cuentas, y cada 4 años hay elecciones (opcionales) que se pierden por debajo del 50 %; 18 logros en total
- [x] **Fase 13**: gestión municipal: financiación por departamento (policía, bomberos, salud, educación y parques, del 50 al 150 % de 10 en 10: cambia el mantenimiento de sus edificios, y la cobertura es más débil por debajo de 100 % y llega más lejos por encima), 6 ordenanzas con coste mensual (hasta 4 a la vez: vigilancia vecinal, filtros industriales, ahorro de agua, incentivos al comercio, fomento industrial y fiestas populares) y distritos con nombre (hasta 12, dibujados con la herramienta «Distritos»; el Ágora los usa como nombre de barrio y el presupuesto muestra sus habitantes, empleos, felicidad, contaminación y crimen)
- [x] **Fase 16**: transporte público y reparto modal. Paradas de autobús (por las calles, con la mitad de la congestión), estaciones de metro unidas por túneles que se trazan como las tuberías (rápidas y sin atascos) y estaciones de tren (línea regional entre estaciones; la primera trae demanda comercial e industrial). Cada vivienda compara el trayecto en coche con el de la parada a pie más barata (andar, esperar, viajar y andar hasta el empleo) y una parte de sus trabajadores deja el coche: menos tráfico y trayectos más cortos. Departamento de Transporte en la financiación (más frecuencia, esperas más cortas), billetes como ingreso, vista de datos «Transporte público», viajeros por parada en el inspector (y por qué no los tiene), gráfica de reparto modal, queja y petición «transporte público» en el Ágora y el logro «Sin coche» (19 logros)
- [x] **Fase 14**: basura y salud (en las partidas del menú y los escenarios). Cada lote produce basura según sus ocupantes; el vertedero (que se llena), el centro de reciclaje y la incineradora la recogen hasta su capacidad diaria, de los lotes más cercanos a los más lejanos de su radio. Donde no se recoge se acumula y, pasado un mínimo, quita felicidad, valor del suelo y salud. Cada vivienda tiene un índice de salud (sanidad, contaminación y basura): con salud baja hay enfermos, que no trabajan y ocupan camas de clínicas y hospitales; sin cama, más descontento. Departamento de Residuos en la financiación, ordenanza «Recogida selectiva», vistas «Basura» y «Salud de los vecinos», gráfica de salud, quejas y peticiones en el Ágora, avisos del asesor, logro «Ciudad limpia» (20 logros) y el jugador automático gestiona la basura (hay un objetivo de balance con el sistema activo)
- [x] **Fase 15**: educación y edades (en las partidas del menú y los escenarios). La población se reparte en niños, adultos y mayores: cada mes nacen niños, los niños se hacen adultos, los adultos se jubilan y los mayores mueren (menos con buena sanidad); los recién llegados traen su propia mezcla y una ciudad que no crece envejece. Solo trabajan los adultos. Los adultos tienen estudios básicos, superiores o ninguno: las plazas escolares (escuela para los básicos; instituto y la nueva universidad para los superiores) educan a los niños que se hacen adultos y atraen a familias con estudios. Los sueldos, y con ellos el impuesto residencial, dependen de los estudios (los mayores pagan menos); el comercio y la industria necesitan trabajadores con estudios para subir a los niveles 2 y 3, y la falta de plazas escolares disgusta a las familias. Plazas en el inspector, desglose de la población en la barra superior, gráficas de edades y de estudios, quejas, petición y elogio en el Ágora, avisos del asesor y logro «Ciudad universitaria» (21 logros); el jugador automático construye escuelas, institutos y universidad (objetivo de balance de una partida completa)
- [x] **Fase 19**: monumentos y turismo. Cinco monumentos únicos que se desbloquean con la población (jardín botánico, museo de la ciudad, teatro, estadio y torre mirador): suben el valor del suelo a su alrededor y dan orgullo de ciudad (felicidad en todas las viviendas). Los visitantes diarios dependen de su atractivo y de lo feliz y segura que es la ciudad; gastan dinero (ingreso de turismo, que sigue al impuesto comercial), piden comercio y llegan en coche desde el borde del mapa (cargan las calles hasta los monumentos) o en tren, si hay estación (y entonces vienen más). Sección de monumentos en el panel de progreso, visitantes en el inspector, gráfica de turismo, Ágora, avisos del asesor y los logros «Destino turístico» y «Patrimonio» (23 logros). Los monumentos solo salen rentables en una ciudad feliz y segura
- [x] **Fase 20**: ambiente. Ciclo de día y noche (un día dura unos 4 minutos de juego y se para en pausa): de noche la maqueta se oscurece en azul, las ventanas se encienden poco a poco, hay farolas en las calles y los coches llevan faros; al amanecer y al atardecer, luz cálida. Clima por estaciones (despejado, nubes, lluvia, tormenta con relámpagos, niebla y nieve en invierno), con su propio generador para no alterar la simulación; la lluvia y la nieve frenan los incendios y los rayos de las tormentas los provocan. Sonido generado por el juego, sin archivos: murmullo de la ciudad según el tráfico y el zoom, lluvia, viento, truenos, pájaros de día y grillos de noche, y avisos al construir, demoler, equivocarse o lograr algo. Seguir a un vecino (V): la cámara le acompaña de casa al trabajo, al colegio o al parque según su edad y la hora, con su ficha. Modo foto (M): sin interfaz, con la hora a elegir, desenfoque de maqueta y botón para guardar la imagen en PNG. Ajustes de volumen y de día y noche
- [x] **Fase 21**: rendimiento y accesibilidad. La simulación corre en un Web Worker: la pestaña solo dibuja, cada comando se aplica al momento en una copia local (predicción) y el worker devuelve el estado de verdad, con las capas del mapa en buffers transferibles; si el navegador no puede, sigue en la pestaña. Mapas «Enorme» de 256 × 256: una ciudad de 30.000 habitantes va a 60 fps a velocidad 3. Las partidas se guardan comprimidas (PackBits: unas 10 veces menos, y el autoguardado ya no da tirones; las antiguas se siguen cargando). Editor de terreno: excavar agua y rellenar tierra, con coste y deshacer. Traducción completa al inglés: un diccionario con plantillas traduce la interfaz sin tocar el código, con números y fechas en formato inglés. Colores para daltonismo rojo-verde y azul-amarillo
