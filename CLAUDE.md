# AKROPOLIS · guía para Claude

City builder para navegador al estilo SimCity / Cities: Skylines, con simulación agregada en un mapa de casillas (128 × 128 por defecto) y vista cenital con volumen. Proyecto personal, independiente de cualquier repo de trabajo. El README describe el juego, los controles, la identidad visual y el roadmap; este archivo dice cómo trabajar en él.

## Cómo trabaja el usuario (respetar siempre)

- **Idioma**: conversación, interfaz, comentarios del código y mensajes de los tests, en español. El inglés solo aparece en la marca ("BUILD BEYOND.").
- **Nunca hacer commit sin que lo pida.** Al terminar un bloque, ofrecerlo como opción; el usuario prefiere probar el juego antes de fijar cambios. Durante todo el proyecto ha respondido "sin commit todavía".
- **Por fases**: se trabaja fase a fase según el roadmap del README. Al acabar cada una: tests, tipos y build en verde, prueba en el navegador, README al día, y preguntar si se sigue con la siguiente.
- **Lógica antes que arte**, pero el arte tiene identidad propia: el usuario rechazó un primer arte por "genérico".
- **Sin dependencias nuevas**: solo `typescript`, `vite` y `vitest`. Nada de frameworks; la UI es DOM imperativo.

## Comandos

```bash
npm install
npm run dev        # http://localhost:5173 (?seed=123 cambia el mapa de la demostración)
npm test           # 159 tests en ~35 s, incluidos los objetivos de balance
npm run typecheck  # tsc --noEmit
npm run build      # tipos + build de producción en dist/
npm run balance    # informe largo con el jugador automático (balance/, hasta 10 min)
```

`.claude/launch.json` tiene la configuración `dev` para el panel de vista previa.

## Arquitectura

```
src/sim/       lógica pura, sin DOM: todo se prueba con Vitest
  state.ts       GameState; mapa en capas tipadas (struct of arrays) y capas derivadas
  commands.ts    ÚNICA forma de modificar el estado desde la UI: plan → checkFunds → apply
  simulation.ts  tick() diario: lista ordenada de sistemas; refreshDerived() tras cargar
  systems/       un archivo por sistema (acceso, redes, demanda, crecimiento, economía,
                 influencia, tráfico, progreso, incidentes, Ágora...)
  data/          catálogos (zonas, edificios, vías, rangos, logros, escenarios, eventos, Ágora):
                 los menús de la UI se generan a partir de aquí
  save.ts        serialización con SAVE_VERSION y migraciones
  undo.ts        deshacer/rehacer por diferencias de casillas
  autoplayer.ts  jugador automático: tests de balance y ciudad de demostración del menú
src/render/    cámara y canvas; solo lee el estado (art/ = dibujo procedural)
src/input/     ratón, teclado y herramientas → comandos
src/ui/        HUD, menús, paneles, ventanas, marca, iconos
src/styles/    CSS; los valores llegan como variables desde src/theme.ts
tests/         un archivo por área; balance.test.ts fija los objetivos de crecimiento y economía
```

### Reglas que no hay que romper

- **El estado solo cambia con comandos** (o con los sistemas dentro de `tick`). La UI nunca escribe en `state` directamente; las excepciones aceptadas son cerrar la guía (`state.tutorial = null`) y la velocidad.
- **Determinismo**: todo lo aleatorio usa `random(state)` (generador guardado en el estado). El Ágora usa su propio generador (`random(state.agora)`) para que lo que digan los vecinos no altere la simulación. Una partida cargada debe seguir exactamente igual que la original (hay un test de esto).
- **Capas persistentes y derivadas**: las persistentes están en `MAP_LAYERS` (save.ts) y en `LAYERS` (undo.ts). Las derivadas (acceso, redes, cobertura, contaminación, felicidad...) se recalculan y no se guardan, salvo el tráfico, que se guarda porque se suaviza día a día.
- **Al añadir una capa persistente o un campo al estado**: subir `SAVE_VERSION`, migrar en `deserialize` (las capas que falten se quedan a cero; los objetos nuevos se completan con su `new...()`), añadirla a `LAYERS` en undo.ts si la tocan los comandos, y probar el guardado.
- **Los valores por defecto de `createGame` no tienen sorpresas**: `incidents: 0`, `elections: false`, sin parcelas ni guía. Así los tests y el balance no cambian al añadir sistemas. El menú elige otros valores para el jugador.
- **Números de balance** en `src/sim/config.ts` y en los catálogos de `data/`. Si un cambio rompe `tests/balance.test.ts`, mirar el informe con `npm run balance` antes de tocar los umbrales.
- **El jugador automático** elige siempre la opción por defecto de los eventos (la última, que es gratis) y no atiende peticiones: sirve para comprobar que el juego sigue siendo jugable aunque uno no reaccione.

## Identidad visual (resumen; detalle en el README)

- Marca **AKROPOLIS** (con K, en mayúsculas), lema "BUILD BEYOND.".
- Colores: Midnight Slate `#172B3A`, Aegean Gold `#D2AE70`, Marble `#EAE6DC`, Olive Grove `#577A70`. El oro se usa poco: solo selección, avenidas, emblemas y lo que tiene significado.
- Tipografía: Sora para títulos, IBM Plex Sans para la interfaz.
- Arte: maqueta de arquitecto. Volúmenes de mármol con tejados teñidos por zona, base salvia, agua pizarra y zócalo elevado sobre una mesa slate. Sin kitsch de mitología griega.
- **Tokens**: todo color, fuente y espaciado sale de `src/theme.ts` (`BRAND`, `UI`, `DATA`...), que los publica como variables CSS (`--ui-*`, `--data-*`, `--font-*`...). El mundo usa `src/render/art/palette.ts`. No escribir colores sueltos en el CSS.
- Lenguaje de selección: subrayado dorado de 2 px. Las descripciones emergentes van con `data-tip` y `data-key`.
- Logotipos SVG en `public/brand/`, generados desde `src/ui/brand.ts`; `tests/brand.test.ts` comprueba que coinciden.

## Interfaz: detalles técnicos

- La interfaz se escala con el ajuste "Tamaño de la interfaz" (`--ui-scale` y `transform` en `#ui`). Por eso:
  - en lugar de `100vw` y `100vh` se usan `var(--vw)` y `var(--vh)`;
  - las reglas por anchura son `@container ui (...)`, nunca `@media`.
- `[hidden]` y `.hidden` llevan `display: none !important` globalmente.
- Paneles laterales: el Ágora (G), el progreso (L), el presupuesto (P), las estadísticas (E) y la ayuda (H) ocupan el mismo sitio, así que abrir uno cierra los demás. La columna izquierda (`.left-stack`) apila la guía y el inspector.
- `Modal` encola ventanas y detiene la partida mientras hay una abierta. Las decisiones de eventos usan `choices` y `dismissable: false`.
- Los ajustes se guardan en `localStorage` con las claves `akropolis.settings` y `akropolis.tutorialDone`. Las partidas van por ranuras, con autoguardado.

## Probar en el navegador

- Los eventos de puntero sintéticos fallan en `setPointerCapture`. Para simular arrastres desde JS, primero `canvas.setPointerCapture = () => {}`.
- Editar `main.ts`, el renderer y otros módulos raíz provoca una recarga completa con Vite, que devuelve al menú principal. Hay que volver a crear la partida de prueba.
- `window.game` expone `{ state, camera, demo }` para depurar.
- Si el panel del navegador está oculto, `requestAnimationFrame` se pausa. Para leer el estado es más fiable el DOM o JS que las capturas, que a veces salen recortadas o desfasadas.
- Después de probar, dejar `localStorage` sin ajustes de prueba.

## Estado del proyecto (20/10/2026)

**Hecho**:
- fases 0 a 10 (simulación, redes, economía, influencia, tráfico, menús, balance y arte);
- la identidad AKROPOLIS;
- en este orden: fase 12 (progresión), 11 (comodidad), 17 (eventos) y 18 (Ágora), detalladas en el README.

**Pendiente, en el orden recomendado**:
1. **Fase 13**: presupuesto por departamento (deslizadores del 50 al 150 % que cambian la cobertura y el mantenimiento), ordenanzas (políticas con coste y efecto) y distritos con nombre. Ya hay barrios automáticos de 24 × 24 casillas en `data/agora.ts` que pueden servir de base.
2. **Fase 16**: transporte público (autobuses, metro, estación de tren) y reparto entre modos de transporte. Se engancha al tráfico (`systems/traffic.ts`) y a la queja "trayecto" del Ágora.
3. **Fase 14**: basura y salud.
4. **Fase 15**: niveles de educación y edades de la población.
5. **Fase 19**: monumentos y turismo.
6. **Fase 20**: ambiente (día y noche, clima, sonido), seguir a un ciudadano y modo foto.
7. **Fase 21**: simulación en Web Worker, mapas de 256, editor de terreno, inglés y paletas para daltonismo.
8. **Resto de la fase 2**: carreteras curvas.

Cada fase nueva debe:
- llevar tests propios;
- comprobar con el jugador automático que el balance aguanta;
- si añade estado, migrar el guardado.

## Recetas

- **Edificio nuevo**: añadir una entrada en `src/sim/data/buildings.ts`. Menú, validación y dibujo lo leen de ahí. Si necesita forma propia, hay que darle volúmenes en `art/buildings.ts`.
- **Sistema nuevo**: crear un archivo en `src/sim/systems/` y registrarlo en `SYSTEMS` (simulation.ts) en el lugar que le toque por sus dependencias. Si emite avisos, se añade su tipo a `SimEvent` (types.ts) y se atiende en `onEvents` de `main.ts`.
- **Evento con decisión**: añadir una entrada en `src/sim/data/incidents.ts` con al menos una opción gratis, que debe ir la última. Los efectos temporales se crean con `addEffect` (effects.ts), y los sistemas los leen con `effectDemand`, `effectHappiness`, etc.
- **Logro**: añadir una entrada en `src/sim/data/achievements.ts`; se comprueba al cerrar cada mes.
- **Tema del Ágora**: añadir una entrada en `TOPICS` (data/agora.ts) con su `detect` sobre datos reales. Si debe dar petición, se le añade `petition` con un objetivo medible en la casilla.
- **Ajuste del jugador**: añadir una entrada en `SETTING_FIELDS` (ui/settings.ts) y aplicarla en `main.ts`.

## Continuar en otro PC

El repositorio **aún no tiene ningún commit**. Para llevar el proyecto a otro equipo:
1. hacer un commit y un push a un remoto, o bien copiar la carpeta sin `node_modules/` ni `dist/`;
2. en el equipo nuevo, ejecutar `npm install` y después `npm test` para comprobar que todo está en verde.

La memoria de Claude de cada equipo es local; las preferencias importantes están en este archivo.
