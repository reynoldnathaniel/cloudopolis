import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  // Keep vitest to the engine's unit tests — the e2e/ specs are Playwright's,
  // and vitest's default glob would otherwise try to run them.
  test: { include: ['src/**/*.test.ts'] },
})
