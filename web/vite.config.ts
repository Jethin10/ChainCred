import react from '@vitejs/plugin-react'
import { defaultClientConditions, defineConfig } from 'vite'

// "source" resolves the @paykit/* workspace packages to their TypeScript source,
// so edits to the SDK show up live in this preview.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source', ...defaultClientConditions] },
})
