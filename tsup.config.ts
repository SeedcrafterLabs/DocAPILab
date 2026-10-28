import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/server/cli.ts'], format: ['esm'], outDir: 'dist/server', target: 'node24', removeNodeProtocol: false, sourcemap: true, clean: false, noExternal: [] });
