import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5791, strictPort: true },
  preview: { port: 5792, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ['@xyflow/react', '@dagrejs/dagre'],
          editor: ['@uiw/react-codemirror', '@codemirror/lang-yaml', '@codemirror/lang-json', '@codemirror/lint'],
        },
      },
    },
  },
});
