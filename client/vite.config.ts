import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const PRODUCTION_ORIGIN = 'https://tramdoc.commocsan.cloud';

const redirectToProduction = (): Plugin => ({
    name: 'redirect-localhost-to-production',
    configureServer(server) {
        server.middlewares.use((req, res) => {
            const target = new URL(req.originalUrl || req.url || '/', PRODUCTION_ORIGIN);
            res.statusCode = 302;
            res.setHeader('Location', target.toString());
            res.end(`Redirecting to ${target.toString()}`);
        });
    },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const shouldRedirectLocalhost = env.VITE_REDIRECT_TO_PRODUCTION === '1';

    return {
        plugins: [
            react(),
            ...(shouldRedirectLocalhost ? [redirectToProduction()] : []),
        ],
        build: {
            outDir: 'dist',
        },
        server: {
            proxy: {
                '/api': {
                    target: PRODUCTION_ORIGIN,
                    changeOrigin: true,
                },
                '/covers': {
                    target: PRODUCTION_ORIGIN,
                    changeOrigin: true,
                },
                '/audio': {
                    target: PRODUCTION_ORIGIN,
                    changeOrigin: true,
                }
            }
        }
    };
});
