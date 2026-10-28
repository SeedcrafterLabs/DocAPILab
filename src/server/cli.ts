#!/usr/bin/env node
import { createApp } from './app.js';
import open from 'open';
const { app, store } = await createApp();
const host = process.env.HOST || '127.0.0.1';
const preferred = Number(process.env.PORT || 4000);
async function listen(port: number): Promise<import('node:http').Server> {
  return new Promise((resolve, reject) => { const server = app.listen(port, host); server.once('listening', () => resolve(server)); server.once('error', reject); });
}
let server;
for (let attempt = 0; attempt < 20; attempt++) {
  try { server = await listen(preferred + attempt); break; }
  catch (error: any) { if (error.code !== 'EADDRINUSE') throw error; }
}
if (!server) throw new Error('No hay puertos libres. Configura PORT.');
const address = server.address() as import('node:net').AddressInfo;
const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${address.port}`;
console.log(`\n  docs2api · De documentación a tu API local\n\n  ${url}\n\n  Agrega tus docs o explora el catálogo. Ctrl+C para salir.\n`);
if (!process.argv.includes('--no-open') && process.env.DOCS2API_MODE !== 'hosted') void open(url).catch(() => {});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server!.close(() => { void store.close().then(() => process.exit(0)); }); });
