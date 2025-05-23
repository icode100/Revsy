import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import svgr from "vite-plugin-svgr";

// Remove import of typography plugin, as it's not a Vite plugin

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    svgr()
  ],
  server: {
    headers: {
      // Remove COOP/COEP headers to avoid popup issues
      'Cross-Origin-Opener-Policy': '',
      'Cross-Origin-Embedder-Policy': '',
    }
  }
})
