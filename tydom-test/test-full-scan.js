/* eslint-disable no-console */
const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

const { hostname, username, password } = loadCreds();

(async () => {
  const c = createClient({ hostname, username, password, followUpDebounce: 500 });
  await c.connect();
  await new Promise((r) => setTimeout(r, 300));
  await c.get('/ping');

  console.log('\n=== /info ===');
  try { console.log(JSON.stringify(await c.get('/info'), null, 2)); } catch (e) { console.log(e.message); }

  console.log('\n=== /configs/file (RAW ENDPOINTS) ===');
  const cfg = await c.get('/configs/file');
  for (const ep of cfg.endpoints || []) {
    console.log(`  ep dev=${ep.id_device} end=${ep.id_endpoint} name="${ep.name}" firstUsage=${ep.first_usage} lastUsage=${ep.last_usage} picto=${ep.picto}`);
  }
  console.log(`  groups: ${JSON.stringify(cfg.groups)}`);

  console.log('\n=== /groups/file ===');
  console.log(JSON.stringify(await c.get('/groups/file'), null, 2));

  console.log('\n=== /areas/file ===');
  try { console.log(JSON.stringify(await c.get('/areas/file'), null, 2)); } catch (e) { console.log(e.message); }

  console.log('\n=== /moments/file ===');
  try { console.log(JSON.stringify(await c.get('/moments/file'), null, 2)); } catch (e) { console.log(e.message); }

  console.log('\n=== /scenarios/file ===');
  try { console.log(JSON.stringify(await c.get('/scenarios/file'), null, 2)); } catch (e) { console.log(e.message); }

  console.log('\n=== /devices/meta (FULL) ===');
  const meta = await c.get('/devices/meta');
  for (const d of meta) {
    console.log(`  device id=${d.id}`);
    for (const ep of d.endpoints || []) {
      const names = (ep.metadata || []).map((m) => `${m.name}(${m.permission})`);
      console.log(`    ep id=${ep.id} error=${ep.error} fields=${names.length} : ${names.join(', ')}`);
    }
  }

  console.log('\n=== /devices/data ===');
  try { console.log(JSON.stringify(await c.get('/devices/data'), null, 2).slice(0, 4000)); } catch (e) { console.log(e.message); }

  console.log('\n=== /devices/cmeta ===');
  try {
    const cmeta = await c.get('/devices/cmeta');
    for (const d of cmeta) {
      console.log(`  device id=${d.id}`);
      for (const ep of d.endpoints || []) {
        const cmds = (ep.cmetadata || ep.metadata || []).map((m) => `${m.name}`);
        console.log(`    ep id=${ep.id} cmds=${cmds.length}: ${cmds.join(', ')}`);
      }
    }
  } catch (e) { console.log(e.message); }

  console.log('\n=== GETs per endpoint cdata ===');
  for (const ep of cfg.endpoints || []) {
    const { id_device: d, id_endpoint: e, name } = ep;
    try {
      const r = await c.get(`/devices/${d}/endpoints/${e}/cmeta`);
      console.log(`  ${name} cmeta:`, JSON.stringify(r).slice(0, 600));
    } catch (err) { console.log(`  ${name} cmeta ERR:`, err.message); }
  }

  c.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
