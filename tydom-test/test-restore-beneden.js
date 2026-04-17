/* eslint-disable no-console */
const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

(async () => {
  const c = createClient({ ...loadCreds(), followUpDebounce: 500 });
  await c.connect();
  await new Promise((r) => setTimeout(r, 300));
  await c.get('/ping');
  const URI = `/devices/1678115460/endpoints/1678115460/data`;

  console.log('BEFORE:', JSON.stringify((await c.get(URI)).data.filter((i) => ['authorization','setpoint','hvacMode','timeDelay','tempoOn','boostOn','antifrostOn'].includes(i.name))));

  // Restore step 1: re-enable authorization=COOLING (summer season)
  await c.put(URI, [{ name: 'authorization', value: 'COOLING' }]);
  await new Promise((r) => setTimeout(r, 1000));
  // Step 2: ensure hvacMode=NORMAL
  await c.put(URI, [{ name: 'hvacMode', value: 'NORMAL' }]);
  await new Promise((r) => setTimeout(r, 1000));
  // Step 3: setpoint=20 (original)
  await c.put(URI, [{ name: 'setpoint', value: 20.0 }]);
  await new Promise((r) => setTimeout(r, 1000));
  // Step 4: cancel any tempo
  await c.put(URI, [{ name: 'timeDelay', value: 0 }, { name: 'tempoOn', value: false }]);
  await new Promise((r) => setTimeout(r, 2000));

  console.log('AFTER:', JSON.stringify((await c.get(URI)).data.filter((i) => ['authorization','setpoint','hvacMode','timeDelay','tempoOn','boostOn','antifrostOn'].includes(i.name))));

  c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
