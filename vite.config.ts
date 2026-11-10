import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relative : l'app fonctionne telle quelle sous GitHub Pages (/Coop-tft/).
export default defineConfig({
  base: './',
  plugins: [react()],
  // Commit dont est issu ce build (vide en local) : sert à détecter une version plus récente.
  define: { __BUILD_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? '') },
});
