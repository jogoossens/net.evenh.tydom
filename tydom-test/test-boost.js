/* eslint-disable no-console */
const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

const { hostname: HOST, username: USER, password: PASS } = loadCreds();

// Bureau thermostat per earlier scan
const DEVICE = Number(process.env.DEVICE || 1678803746);
const ENDPOINT = Number(process.env.ENDPOINT || 1678803746);

const DATA_URI = `/devices/${DEVICE}/endpoints/${ENDPOINT}/data`;

async function readBoost(client) {
  const data = await client.get(DATA_URI);
  const items = Array.isArray(data) ? data : (data.data || []);
  const boost = items.find((i) => i.name === 'boostOn');
  const setpoint = items.find((i) => i.name === 'setpoint');
  const temp = items.find((i) => i.name === 'temperature');
  const hvac = items.find((i) => i.name === 'hvacMode');
  const auth = items.find((i) => i.name === 'authorization');
  console.log(
    `  boostOn=${boost && boost.value} tempoOn=${(items.find((i)=>i.name==='tempoOn')||{}).value} timeDelay=${(items.find((i)=>i.name==='timeDelay')||{}).value} setpoint=${setpoint && setpoint.value} temp=${temp && temp.value} hvac=${hvac && hvac.value} auth=${auth && auth.value}`,
  );
  return boost ? boost.value : null;
}

(async () => {
  const client = createClient({
    hostname: HOST, username: USER, password: PASS, followUpDebounce: 500,
  });
  client.on('message', (msg) => {
    if (msg.uri === '/devices/data' && msg.method === 'PUT') {
      console.log('  [push]', JSON.stringify(msg.body).slice(0, 300));
    }
  });

  await client.connect();
  await new Promise((r) => setTimeout(r, 300));
  await client.get('/ping');

  console.log(`\n=== Initial state (device=${DEVICE} endpoint=${ENDPOINT}) ===`);
  await readBoost(client);

  console.log('\n=== PUT boostOn=true ===');
  try {
    const resp = await client.put(DATA_URI, [{ name: 'boostOn', value: true }]);
    console.log('PUT response:', JSON.stringify(resp).slice(0, 500));
  } catch (err) {
    console.log('PUT error:', err.message || err);
  }

  await new Promise((r) => setTimeout(r, 2000));
  console.log('\n=== After 2s ===');
  await readBoost(client);

  await new Promise((r) => setTimeout(r, 5000));
  console.log('\n=== After 7s total ===');
  await readBoost(client);

  console.log('\n=== PUT boostOn=false (clean up) ===');
  try {
    const resp = await client.put(DATA_URI, [{ name: 'boostOn', value: false }]);
    console.log('PUT response:', JSON.stringify(resp).slice(0, 500));
  } catch (err) {
    console.log('PUT error:', err.message || err);
  }
  await new Promise((r) => setTimeout(r, 1500));
  console.log('\n=== Final state ===');
  await readBoost(client);

  client.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
