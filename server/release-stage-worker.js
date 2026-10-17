// ZIP extraction and full-art hashing run off the live server's event loop.
import { parentPort, workerData } from 'node:worker_threads';
import { stageZip } from './release-update.js';

const { zip, stage, tag, root } = workerData;
const manifest = stageZip(zip, stage, tag, { root });
parentPort.postMessage({ app: manifest.app });
