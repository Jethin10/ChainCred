import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Use the workspace SDK source directly (not needed when installing from npm).
  resolve: { conditions: ['source', ...defaultClientConditions] },
})
