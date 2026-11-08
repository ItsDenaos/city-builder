/// <reference lib="webworker" />
import { type FromHost, SimHost, type ToHost, stateBuffers } from './host';

/**
 * Worker de la simulación (fase 21): la partida corre aquí, en segundo plano, y el hilo principal solo dibuja.
 * Cada estado se clona aquí y se transfiere sin copiar: el coste de la copia no lo paga el dibujo.
 */
const host = new SimHost();
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<ToHost>) => {
  const out: FromHost | null = host.handle(e.data);
  if (!out) return;
  if (out.type === 'state') {
    const copy = structuredClone(out.state);
    scope.postMessage({ ...out, state: copy }, stateBuffers(copy));
  } else {
    scope.postMessage(out);
  }
};
