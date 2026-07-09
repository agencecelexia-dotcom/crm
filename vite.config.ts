import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Config Vite : plugin React + Tailwind v4 + alias "@" vers src/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Découpage des gros vendors pour un chargement plus léger sur mobile
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-map': ['leaflet', 'react-leaflet'],
          'vendor-charts': ['recharts'],
          'vendor-pdf': ['pdfjs-dist'],
        },
      },
    },
  },
})
