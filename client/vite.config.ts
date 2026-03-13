import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: 'dist',
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3005',
                changeOrigin: true,
            },
            '/covers': {
                target: 'http://localhost:3005',
                changeOrigin: true,
            },
            '/audio': {
                target: 'http://localhost:3005',
                changeOrigin: true,
            }
        }
    }
});
