import { defineConfig } from 'vite';

// Relative asset URLs so the same build works at a domain root and under a
// GitHub Pages project sub-path (/afterlight/).
export default defineConfig({
  base: './',
});
