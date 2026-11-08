import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Las pruebas de balance simulan años de ciudad y acaparan la CPU mientras los demás archivos corren en
    // paralelo: con el límite de serie (5 s) los tests normales fallan de vez en cuando sin motivo.
    testTimeout: 60_000,
  },
});
