/* eslint-disable no-console */
const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

const { hostname: HOST, username: USER, password: PASS } = loadCreds();

// Beneden (setpoint 20, temp 20.82, cooling). Least invasive test.
const DEVICE = 1678115460;
const ENDPOINT = 1678115460;
const URI = `/devices/${DEVICE}/endpoints/${ENDPOINT}/data`;

const pick = (arr, n) => (arr.find((i) => i.name === n) || {}).value;

async function read(c) {
  const r = await c.get(URI);
  const items = Array.isArray(r) ? r : r.data;
  console.log(`  setpoint=${pick(items,'setpoint')} temp=${pick(items,'temperature')} boost=${pick(items,'boostOn')} tempo=${pick(items,'tempoOn')} timeDelay=${pick(items,'timeDelay')} auth=${pick(items,'authorization')} hvac=${pick(items,'hvacMode')}`);
  return items;
}

async function tryPut(c, label, body) {
  console.log(`\n--- ${label} ---`);
  console.log('  BODY:', JSON.stringify(body));
  try {
    const resp = await c.put(URI, body);
    console.log('  RESP:', JSON.stringify(resp).slice(0, 300));
  } catch (e) {
    console.log('  ERR:', e.message);
  }
  await new Promise((r) => setTimeout(r, 2500));
  await read(c);
}

(async () => {
  const c = createClient({ hostname: HOST, username: USER, password: PASS, followUpDebounce: 500 });
  c.on('message', (m) => {
    if (m.uri === '/devices/data' && m.method === 'PUT' && Array.isArray(m.body)) {
      for (const d of m.body) {
        if (d.id === DEVICE) {
          console.log('  [PUSH]', JSON.stringify(d).slice(0, 400));
        }
      }
    }
  });
  await c.connect();
  await new Promise((r) => setTimeout(r, 300));
  await c.get('/ping');

  console.log('\n=== Initial state ===');
  const initial = await read(c);
  const origSetpoint = pick(initial, 'setpoint');

  // Test 1: combined write (issue #14 recipe)
  await tryPut(c, 'combined: setpoint=20, tempoOn=true, boostOn=true', [
    { name: 'setpoint', value: 20.0 },
    { name: 'tempoOn', value: true },
    { name: 'boostOn', value: true },
  ]);

  // Test 2: add timeDelay to combined
  await tryPut(c, 'combined + timeDelay=60', [
    { name: 'setpoint', value: 20.0 },
    { name: 'tempoOn', value: true },
    { name: 'boostOn', value: true },
    { name: 'timeDelay', value: 60 },
  ]);

  // Test 3: delay trio (proper derogation)
  await tryPut(c, 'derogation trio: delaySetpoint=24, delayThermicLevel=COMFORT, timeDelay=5', [
    { name: 'delaySetpoint', value: 24.0 },
    { name: 'delayThermicLevel', value: 'COMFORT' },
    { name: 'timeDelay', value: 5 },
  ]);

  // Test 4: just timeDelay (as the user asked about)
  await tryPut(c, 'just timeDelay=10', [
    { name: 'timeDelay', value: 10 },
  ]);

  // Test 5: comfortMode (write-only field, maybe triggers something)
  await tryPut(c, 'comfortMode=HEATING', [
    { name: 'comfortMode', value: 'HEATING' },
  ]);

  // CLEANUP
  console.log('\n=== Cleanup (restore) ===');
  await tryPut(c, 'restore: setpoint+cancel tempo+timeDelay=0', [
    { name: 'setpoint', value: origSetpoint },
    { name: 'timeDelay', value: 0 },
    { name: 'tempoOn', value: false },
    { name: 'boostOn', value: false },
  ]);

  c.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
