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
        manualChunks: {
          jspdf: ['jspdf'],
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
