import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { archivePlugin } from './archive.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [react(), archivePlugin(env.ARCHIVE_DIR || 'archive')], base: './' };
});
