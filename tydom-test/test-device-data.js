/* eslint-disable no-console */
const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

const { hostname, username, password } = loadCreds();

(async () => {
  const client = createClient({ hostname, username, password, followUpDebounce: 500 });
  await client.connect();
  await new Promise((r) => setTimeout(r, 250));
  await client.get('/ping');

  const config = await client.get('/configs/file');
  await client.post('/refresh/all');
  await new Promise((r) => setTimeout(r, 2000));

  for (const ep of config.endpoints || []) {
    const { id_device: d, id_endpoint: e, name, first_usage: fu } = ep;
    const uri = `/devices/${d}/endpoints/${e}/data`;
    try {
      const data = await client.get(uri);
      console.log(`\n=== ${name} (${fu}) device=${d} endpoint=${e} ===`);
      console.log(JSON.stringify(data, null, 2));
    } catch (err) {
      console.log(`\n=== ${name} (${fu}) device=${d} endpoint=${e} ===`);
      console.log('ERROR', err.message);
    }
  }

  client.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
