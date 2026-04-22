import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // jspdf pushes the main bundle past Vite's default 500kb soft-warn.
    // Bumping the threshold silences the warning without changing behavior.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split jspdf into its own chunk so it's cached separately from app
        // code and only re-downloaded when jspdf itself changes.
        // Vite 8 uses Rolldown, which requires manualChunks as a function.
        manualChunks: (id) => {
          if (id.includes('node_modules/jspdf')) return 'jspdf';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
