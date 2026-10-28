// Library entry point for hosts that embed docs2api (e.g. a serverless deployment) instead of running the CLI.
export { createApp } from './app.js';
export { createStore, SettingsStore, type Store, type Coordination, type StoreOptions } from './store.js';
