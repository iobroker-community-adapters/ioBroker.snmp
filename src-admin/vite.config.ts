import react from '@vitejs/plugin-react';
import commonjs from 'vite-plugin-commonjs';
import { federation } from '@module-federation/vite';
import { moduleFederationShared } from '@iobroker/gui-components/modulefederation.admin.config';
import { readFileSync } from 'node:fs';

/*
 * The admin host provides every module of moduleFederationShared() itself - that is what declaring
 * guiApi 2 in admin/jsonConfig.json means. Without `import: false` module federation additionally
 * bundles a local fallback copy of each of them, which alone adds roughly 9 MB to the npm package.
 */
function sharedWithoutFallback(packageJson: unknown): Record<string, unknown> {
    const shared = moduleFederationShared(packageJson) as Record<string, Record<string, unknown>>;
    for (const name of Object.keys(shared)) {
        shared[name] = { ...shared[name], import: false };
    }
    return shared;
}

const config = {
    plugins: [
        federation({
            manifest: true,
            // Must be unique per component set and must match the first segment of `name` in
            // admin/jsonConfig.json - two components sharing this name collide at runtime.
            name: 'SnmpComponentSet',
            filename: 'customComponents.js',
            exposes: {
                './Components': './src/Components.tsx',
            },
            remotes: {},
            shared: sharedWithoutFallback(JSON.parse(readFileSync('./package.json').toString())),
        }),
        react(),
        commonjs(),
    ],
    resolve: {
        tsconfigPaths: true,
    },
    server: {
        port: 3000,
    },
    base: './',
    build: {
        target: 'chrome89',
        outDir: './build',
    },
};

export default config;
