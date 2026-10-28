/* Renders and encodes one synthetic clip off the main thread (see lib.encodeAll). */
const { parentPort, workerData } = require('worker_threads');

const { encode } = require('./lib');

encode(require(workerData.scenePath), workerData.o, workerData.file).then((frames) => parentPort.postMessage(frames));
