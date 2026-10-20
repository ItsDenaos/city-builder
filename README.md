# AKROPOLIS

**BUILD BEYOND.**

Simulación urbana para navegador al estilo SimCity / Cities: Skylines. La ciudad se dibuja como una maqueta de arquitecto: volúmenes en tonos mármol con tejados teñidos por zona, sobre un zócalo elevado (la "ciudad en alto"), todo generado por código, sin imágenes.

## Uso

```bash
npm install
npm run dev        # http://localhost:5173  (?seed=123 para otro mapa de fondo)
npm test           # tests (simulación, guardado, marca y objetivos de balance, ~30 s)
npm run balance    # informe de balance: el jugador automático juega varios escenarios
npm run build      # comprobación de tipos y versión de producción en dist/
```

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
| Atrás, soltar herramienta, menú de pausa | Esc |

Los parques y los edificios de una casilla se colocan en serie arrastrando. En Ajustes (menú principal o de pausa) se eligen el autoguardado, mover la cámara con los bordes de la pantalla, el tamaño de la interfaz, reducir animaciones y los consejos del asesor.

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
- **Colores de datos:** conservan su significado habitual (verde residencial, azul comercial, amarillo industrial, rojo para lo negativo) en tonos que conviven con la marca.
- **Tipografía:** Sora para el logotipo y los títulos, e IBM Plex Sans para la interfaz y las cifras (tabulares). Se cargan de Google Fonts y, si no cargan, se usa la fuente del sistema. Los SVG exportados del logotipo usan Sora solo si está instalada.
- **Disposición del HUD:**
  - arriba, el estado de la ciudad;
  - abajo, el dock de construcción;
  - a la izquierda, el inspector de casilla;
  - a la derecha, el carril de gestión.

  En el menú principal, una ciudad de demostración crece en directo detrás del logotipo.
- **Idioma:** la interfaz está en español. El inglés se reserva para la marca (el lema BUILD BEYOND.).

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
    systems/      un archivo por sistema (demanda, crecimiento, redes, economía, influencia, tráfico...)
    data/         catálogos de zonas, edificios y vías: los menús se generan a partir de aquí
  render/       cámara y canvas (solo lee el estado)
    art/          suelo, calles, edificios, coches, paleta y la imagen por casilla para el zoom alejado
  input/        ratón, teclado y herramientas -> comandos
  ui/           HUD, menús, paneles, marca, iconos y descripciones emergentes
  styles/       hojas de estilo
public/brand/   logotipo y favicon en SVG
balance/        informes de balance (npm run balance)
```

## Roadmap

- [x] **Fase 0**: setup (Vite + TS + Vitest), bucle de juego con paso fijo
- [x] **Fase 1**: mapa generado por semilla, cámara (pan/zoom), hover, selección
- [x] Base de la fase 2: comandos de carretera, zonas, edificios y demoler, con costes y previsualización
- [x] **Fase 2**: herramientas de construcción (deshacer y rehacer, franjas y colocación en serie llegaron en la fase 11; quedan las curvas)
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
- [ ] **Fases 13-16, 19-21**: presupuestos por departamento y ordenanzas, transporte público, basura y salud, educación y edades, monumentos y turismo, ambiente (día y noche, clima, sonido), rendimiento y accesibilidad
