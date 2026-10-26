import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5791, strictPort: true },
  preview: { port: 5792, strictPort: true },
  build: {
    chunkSizeWarningLimit: 1200,
    // AWS icons stay separate files: ~300 of them, fetched only when a node uses one.
    assetsInlineLimit: (file) => (file.includes('aws-icons') ? false : undefined),
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
