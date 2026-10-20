import { type SaveMeta, deserialize, serialize } from '../sim/save';
import type { GameState } from '../sim/state';

/**
 * Partidas en localStorage (una entrada por ranura) y en archivos .json.
 * localStorage puede no estar disponible (modo privado, bloqueado): todo va en try/catch
 * y los errores llegan al jugador con un mensaje.
 */
const PREFIX = 'citybuilder:save:';
export const AUTOSAVE_SLOT = 'auto';
export const MANUAL_SLOTS = ['1', '2', '3'] as const;

export interface SlotInfo {
  slot: string;
  meta: SaveMeta | null;
}

function readSlot(slot: string): string | null {
  try {
    return localStorage.getItem(PREFIX + slot);
  } catch {
    return null;
  }
}

export function listSlots(slots: readonly string[] = [AUTOSAVE_SLOT, ...MANUAL_SLOTS]): SlotInfo[] {
  return slots.map((slot) => {
    const raw = readSlot(slot);
    if (!raw) return { slot, meta: null };
    try {
      return { slot, meta: (JSON.parse(raw) as { meta: SaveMeta }).meta };
    } catch {
      return { slot, meta: null };
    }
  });
}

/** Devuelve un mensaje de error, o null si se guardó bien. */
export function saveToSlot(slot: string, state: GameState): string | null {
  try {
    localStorage.setItem(PREFIX + slot, JSON.stringify(serialize(state)));
    return null;
  } catch {
    return 'No se pudo guardar: el navegador no permite almacenar datos o no queda espacio.';
  }
}

export function loadFromSlot(slot: string): GameState {
  const raw = readSlot(slot);
  if (!raw) throw new Error('Esa ranura está vacía.');
  return deserialize(JSON.parse(raw));
}

export function deleteSlot(slot: string): void {
  try {
    localStorage.removeItem(PREFIX + slot);
  } catch {
    // nada que hacer: si no hay almacenamiento, tampoco hay partida que borrar
  }
}

/** Descarga la partida como archivo .json. */
export function exportToFile(state: GameState): void {
  const blob = new Blob([JSON.stringify(serialize(state))], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'ciudad'} - ${state.time.year}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importFromFile(file: File): Promise<GameState> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('El archivo no es una partida de AKROPOLIS.');
  }
  return deserialize(data);
}
