import type { Camera } from '../render/camera';
import type { Command } from '../sim/commands';
import type { Point, Speed } from '../sim/types';
import { SELECT_TOOL, type Tool } from './tools';

export interface InputActions {
  getTool(): Tool;
  /** Comando que corresponde a usar la herramienta entre dos casillas (con sus ajustes). */
  buildCommand(start: Point, end: Point): Command | null;
  command(cmd: Command): void;
  undo(): void;
  redo(): void;
  /** F: cambia la franja de zonificación junto a las calles. */
  cycleStrip(): void;
  select(tile: Point): void;
  togglePause(): void;
  setSpeed(speed: Speed): void;
  cancelTool(): void;
  setTool(tool: Tool): void;
  toggleBudget(): void;
  toggleStats(): void;
  toggleHelp(): void;
  toggleProgress(): void;
  toggleAgora(): void;
  /** true mientras hay un menú abierto: solo Esc llega al juego. */
  blocked(): boolean;
  /** Ajuste: mover la cámara al llevar el ratón al borde de la ventana. */
  edgeScroll(): boolean;
}

const PAN_KEYS: Record<string, Point> = {
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
};
const KEY_PAN_SPEED = 700; // px de pantalla por segundo
/** Franja del borde de la ventana que mueve la cámara (px); cuanto más cerca del borde, más rápido. */
const EDGE_PX = 12;
const WHEEL_ZOOM = 1.15;

/**
 * Ratón: clic/arrastre izquierdo usa la herramienta, arrastre derecho o central mueve la cámara,
 * rueda hace zoom. Teclado: WASD/flechas mueven, espacio pausa, 1-3 velocidad, P presupuesto,
 * E estadísticas, H ayuda, Q/R/B herramientas, Esc cancela o abre el menú de pausa.
 */
export class InputController {
  hover: Point | null = null;
  dragStart: Point | null = null;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private keys = new Set<string>();
  /** Última posición del ratón en la ventana (null si está fuera). */
  private mouse: { x: number; y: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private actions: InputActions,
  ) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointerleave', () => {
      if (!this.dragStart && !this.panning) this.hover = null;
    });
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse = null;
    });
    window.addEventListener('pointermove', (e) => (this.mouse = { x: e.clientX, y: e.clientY }));
    document.documentElement.addEventListener('pointerleave', () => (this.mouse = null));
  }

  update(dtMs: number): void {
    let dx = 0;
    let dy = 0;
    for (const k of this.keys) {
      const dir = PAN_KEYS[k];
      if (dir) {
        dx += dir.x;
        dy += dir.y;
      }
    }
    if (this.mouse && !this.panning && this.actions.edgeScroll()) {
      const edge = (v: number, size: number) => (v < EDGE_PX ? -(1 - v / EDGE_PX) : v > size - EDGE_PX ? 1 - (size - v) / EDGE_PX : 0);
      dx += edge(this.mouse.x, window.innerWidth);
      dy += edge(this.mouse.y, window.innerHeight);
    }
    if (dx || dy) this.camera.panByScreen((-dx * KEY_PAN_SPEED * dtMs) / 1000, (-dy * KEY_PAN_SPEED * dtMs) / 1000);
  }

  private tileAt(e: PointerEvent | WheelEvent): Point {
    return this.camera.screenToTile(e.offsetX, e.offsetY);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.actions.blocked()) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      this.panning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      return;
    }
    if (e.button !== 0) return;
    const tile = this.tileAt(e);
    if (this.actions.getTool().kind === 'select') this.actions.select(tile);
    else this.dragStart = tile;
  };

  private onPointerMove = (e: PointerEvent) => {
    this.hover = this.tileAt(e);
    if (this.panning) {
      this.camera.panByScreen(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      this.panning = false;
      return;
    }
    if (e.button !== 0 || !this.dragStart) return;
    const cmd = this.actions.buildCommand(this.dragStart, this.tileAt(e));
    this.dragStart = null;
    if (cmd) this.actions.command(cmd);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.camera.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (this.actions.blocked()) {
      if (key === 'Escape') this.actions.cancelTool();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Z deshace; Ctrl+Y o Ctrl+Mayús+Z rehacen. Los demás atajos del navegador siguen funcionando.
      if (key === 'z' && !e.shiftKey) this.actions.undo();
      else if (key === 'y' || (key === 'z' && e.shiftKey)) this.actions.redo();
      else return;
      e.preventDefault();
    } else if (key in PAN_KEYS) {
      this.keys.add(key);
      e.preventDefault();
    } else if (key === ' ') {
      this.actions.togglePause();
      e.preventDefault();
    } else if (key === '1' || key === '2' || key === '3') {
      this.actions.setSpeed(Number(key) as Speed);
    } else if (key === 'p') {
      this.actions.toggleBudget();
    } else if (key === 'e') {
      this.actions.toggleStats();
    } else if (key === 'h') {
      this.actions.toggleHelp();
    } else if (key === 'l') {
      this.actions.toggleProgress();
    } else if (key === 'g') {
      this.actions.toggleAgora();
    } else if (key === 'q') {
      this.actions.setTool(SELECT_TOOL);
    } else if (key === 'r') {
      this.actions.setTool({ kind: 'road', road: 'street' });
    } else if (key === 'b') {
      this.actions.setTool({ kind: 'bulldoze' });
    } else if (key === 'f') {
      this.actions.cycleStrip();
    } else if (key === 'Escape') {
      if (this.dragStart) this.dragStart = null;
      else this.actions.cancelTool();
    }
  };
}
