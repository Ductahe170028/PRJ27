// Runs inside the container (see docker-sandbox.ts verify()). Prints one JSON line.
import { collectProbeReport } from './probe.js';

process.stdout.write(`${JSON.stringify(await collectProbeReport())}\n`, () => process.exit(0));
