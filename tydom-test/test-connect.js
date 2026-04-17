/**
 * Manual Tydom connection test.
 *
 * Usage:
 *   node tydom-test/test-connect.js
 *
 * Requires the gateway password (see tydom-test/_common.js).
 * Connects to the gateway, queries /configs/file, /groups/file, /devices/meta,
 * and logs every message received on the websocket.
 */

/* eslint-disable no-console */
process.env.DEBUG = 'tydom-client';

const { loadCreds } = require('./_common');
const { createClient } = require('../node_modules/tydom-client');

const { hostname, username, password } = loadCreds();

(async () => {
  console.log('[test] hostname=%s username=%s', hostname, username);

  const client = createClient({
    hostname,
    username,
    password,
    followUpDebounce: 500,
  });

  client.on('connect', () => console.log('[test] event: connect'));
  client.on('disconnect', () => console.log('[test] event: disconnect'));
  client.on('message', (msg) => {
    console.log('[test] ws message uri=%s method=%s', msg.uri, msg.method);
  });

  try {
    console.log('[test] connecting...');
    await client.connect();
    console.log('[test] connected. ping...');
    const ping = await client.get('/ping');
    console.log('[test] ping ok:', JSON.stringify(ping).slice(0, 200));

    console.log('[test] fetching /configs/file ...');
    const config = await client.get('/configs/file');
    console.log('[test] config endpoints=%d groups=%d',
      Array.isArray(config.endpoints) ? config.endpoints.length : 0,
      Array.isArray(config.groups) ? config.groups.length : 0);
    for (const ep of config.endpoints || []) {
      console.log('  - endpoint deviceId=%s endpointId=%s name="%s" firstUsage=%s',
        ep.id_device, ep.id_endpoint, ep.name, ep.first_usage);
    }

    console.log('[test] fetching /groups/file ...');
    const groups = await client.get('/groups/file');
    console.log('[test] groups=%s', JSON.stringify(groups).slice(0, 300));

    console.log('[test] fetching /devices/meta ...');
    const meta = await client.get('/devices/meta');
    console.log('[test] meta count=%d', Array.isArray(meta) ? meta.length : 0);

    console.log('[test] refreshing /refresh/all ...');
    await client.post('/refresh/all');

    console.log('[test] ALL GOOD. Leaving socket open for 15s to observe push updates...');
    await new Promise((r) => setTimeout(r, 15000));
    client.close();
    console.log('[test] closed cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('[test] ERROR:', err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
