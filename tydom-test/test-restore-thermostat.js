/* eslint-disable no-console */
const { loadCreds, loadDevice } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

(async () => {
  const c = createClient({ ...loadCreds(), followUpDebounce: 500 });
  await c.connect();
  await new Promise((r) => setTimeout(r, 300));
  await c.get('/ping');
  const { device, endpoint } = loadDevice();
  const URI = `/devices/${device}/endpoints/${endpoint}/data`;
  // Values to restore after a boost test; override via env.
  const AUTHORIZATION = process.env.AUTHORIZATION || 'COOLING';
  const SETPOINT = Number(process.env.SETPOINT || 20);

  console.log('BEFORE:', JSON.stringify((await c.get(URI)).data.filter((i) => ['authorization','setpoint','hvacMode','timeDelay','tempoOn','boostOn','antifrostOn'].includes(i.name))));

  // Restore step 1: re-enable authorization (COOLING in summer, HEATING in winter)
  await c.put(URI, [{ name: 'authorization', value: AUTHORIZATION }]);
  await new Promise((r) => setTimeout(r, 1000));
  // Step 2: ensure hvacMode=NORMAL
  await c.put(URI, [{ name: 'hvacMode', value: 'NORMAL' }]);
  await new Promise((r) => setTimeout(r, 1000));
  // Step 3: restore setpoint
  await c.put(URI, [{ name: 'setpoint', value: SETPOINT }]);
  await new Promise((r) => setTimeout(r, 1000));
  // Step 4: cancel any tempo
  await c.put(URI, [{ name: 'timeDelay', value: 0 }, { name: 'tempoOn', value: false }]);
  await new Promise((r) => setTimeout(r, 2000));

  console.log('AFTER:', JSON.stringify((await c.get(URI)).data.filter((i) => ['authorization','setpoint','hvacMode','timeDelay','tempoOn','boostOn','antifrostOn'].includes(i.name))));

  c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
