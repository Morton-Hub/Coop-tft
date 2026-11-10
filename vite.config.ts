import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relative : l'app fonctionne telle quelle sous GitHub Pages (/Coop-tft/).
export default defineConfig({ base: './', plugins: [react()] });
