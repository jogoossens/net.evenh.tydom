/* eslint-disable no-console */
const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

(async () => {
  const c = createClient({ ...loadCreds(), followUpDebounce: 500 });
  await c.connect();
  await new Promise((r) => setTimeout(r, 300));
  await c.get('/ping');

  const paths = [
    '/protocols',
    '/site',
    '/site/file',
    '/gateway',
    '/collect',
    '/anticip',
    '/anticip/file',
    '/absence',
    '/bioclim',
    '/devices/init',
    '/devices/extra',
    '/devices/assoc',
    '/triggers',
    '/trigger',
    '/trigger/file',
    '/data_config',
    '/data_config/file',
    '/bdd',
    '/bdd/file',
    '/grp_proto',
    '/grp_proto/file',
    '/mom_api',
    '/mom_api/file',
    // try Zigbee-specific since gateway reports Zigbee running
    '/zigbee',
    '/zigbee/coordinator',
    '/zigbee/devices',
    '/zigbee/network',
    // try X3D since that's what drives the thermostats + receivers
    '/x3d',
    '/x3d/devices',
    '/x3d/receivers',
    '/x3d/actors',
    '/x3d/pairing',
    // try per-device info endpoints beyond data
    '/devices/1678115459',
    '/devices/1678115459/endpoints/1678115459',
    '/devices/1678115459/endpoints/1678115459/cdata',
    '/devices/1678115459/init',
    // any hidden device lists
    '/receivers',
    '/actors',
    '/pairing',
  ];

  for (const p of paths) {
    try {
      const r = await c.get(p);
      const s = JSON.stringify(r);
      const isErr = s.includes('Error 404') || s.includes('"error":1');
      if (!isErr) {
        console.log(`[OK ] ${p}  ${s.length}B  ${s.slice(0, 400)}${s.length > 400 ? '…' : ''}`);
      }
    } catch (e) {
      // ignore
    }
  }

  c.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
