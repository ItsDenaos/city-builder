import { defineConfig } from 'vitest/config';

// Informes de balance: simulaciones largas que imprimen tablas (npm run balance)
export default defineConfig({
  test: {
    include: ['balance/**/*.test.ts'],
    testTimeout: 600_000,
    reporters: ['default'],
  },
});
