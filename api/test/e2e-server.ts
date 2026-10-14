import { createApp } from '../src/app.js';
import { MockGateway } from '../src/clients/mock-gateway.js';
import { loadConfig } from '../src/config.js';

// Deliberately does not load .env or real clients. Browser tests cannot write to upstream services.
const config = loadConfig({ API_MODE: 'mock', PORT: '4100', WEB_ORIGIN: 'http://127.0.0.1:5174' });
const server = createApp({ config, gateway: new MockGateway(), audit: () => {} }).listen(4100, '127.0.0.1');
process.on('SIGTERM', () => server.close());
