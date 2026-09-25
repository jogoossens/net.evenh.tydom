/* eslint-disable no-console */
/**
 * Replay recorded Tydom gateway traffic through the app's device recognition.
 *
 * Uses the real captures shipped with the Home Assistant Tydom integration
 * (TYDOM1, TYDOM2, Tydom Home/Pro, Tywell Pro), so device support can be
 * checked without owning the hardware.
 *
 *   git clone --depth 1 https://github.com/CyrilP/hass-deltadore-tydom-component /tmp/ha
 *   npm run build
 *   node tydom-test/replay-traces.js /tmp/ha/tools
 *
 * Prints, per first_usage → last_usage, the category our resolver picks, and
 * the Homey values the beta drivers' mappings produce from recorded data.
 */
// One escaped HTTP message per line → { product, config, meta, data } snapshots.
const fs = require('fs');
const dechunk = (b) => { let out = '', c = 0; for (;;) { const e = b.indexOf('\r\n', c); if (e < 0) return null; const n = parseInt(b.slice(c, e), 16); if (isNaN(n)) return null; if (n === 0) return out; out += b.slice(e + 2, e + 2 + n); c = e + 2 + n + 2; } };
function parseMessage(line) {
  const s = line.replace(/\\r\\n/g, '\r\n').replace(/\\"/g, '"');
  const i = s.indexOf('\r\n\r\n'); if (i < 0) return null;
  const head = s.slice(0, i); let body = s.slice(i + 4);
  const uri = (head.match(/Uri-Origin:\s*(\S+)/i) || [])[1] || (head.match(/^(?:PUT|GET|POST) (\S+)/) || [])[1];
  const method = (head.match(/^(PUT|GET|POST|DELETE)/) || [])[1] || 'RESP';
  if (/transfer-encoding:\s*chunked/i.test(head)) body = dechunk(body);
  if (body == null) return null;
  let json; try { json = JSON.parse(body); } catch { return null; }
  return { uri, method, json };
}
function load(path) {
  const snaps = []; let cur = null;
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('HTTP/1.1') && !line.startsWith('PUT') ) continue;
    const m = parseMessage(line.slice(line.indexOf(line.includes('HTTP/1.1') ? 'HTTP/1.1' : 'PUT')));
    if (!m || !m.uri) continue;
    if (m.uri === '/info') { cur = { file: path.split('/').pop(), product: m.json.productName, fw: m.json.mainVersionSW, ref: m.json.mainReference, config: null, meta: null, data: [] }; snaps.push(cur); }
    if (!cur) { cur = { file: path.split('/').pop(), product: '?', config: null, meta: null, data: [] }; snaps.push(cur); }
    if (m.uri === '/configs/file') cur.config = m.json;
    if (m.uri === '/devices/meta') cur.meta = m.json;
    if (m.uri === '/devices/data' || m.uri.startsWith('/devices/')) cur.data.push(m.json);
  }
  return snaps.filter((s) => s.config);
}

const { resolveEndpointCategory } = require('../.homeybuild/tydom/helpers');
const mappings = require('../.homeybuild/tydom/mappings');

const CATEGORY_NAMES = { 100: 'SMOKE_SENSOR', 101: 'TEMPERATURE_SENSOR', 102: 'PILOT_WIRE_HEATER', 1: 'OTHER', 4: 'GARAGE_DOOR_OPENER', 5: 'LIGHTBULB', 7: 'OUTLET', 9: 'THERMOSTAT', 10: 'SENSOR', 11: 'ALARM_SYSTEM', 12: 'DOOR', 13: 'WINDOW', 14: 'WINDOW_COVERING' };

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node tydom-test/replay-traces.js <path to hass-deltadore-tydom-component/tools>');
  process.exit(1);
}
// Homey values a beta driver would show, from an endpoint's recorded values.
const MAPPED = {
  14: (v) => ({ windowcoverings_set: mappings.shutterPosition(v) }),
  12: (v) => ({ alarm_contact: mappings.contactOpen(v), alarm_battery: mappings.batteryAlarm(v) }),
  13: (v) => ({ alarm_contact: mappings.contactOpen(v), alarm_battery: mappings.batteryAlarm(v) }),
  100: (v) => ({ alarm_smoke: mappings.smokeDetected(v), alarm_battery: mappings.batteryAlarm(v) }),
  101: (v) => ({ measure_temperature: mappings.outdoorTemperature(v), alarm_battery: mappings.batteryAlarm(v) }),
  102: (v) => ({ pilot_wire_mode: mappings.pilotWireMode(v), thermicLevel: v.thermicLevel }),
};
const samples = new Map();

const rows = new Map();
const seen = new Set();
for (const file of fs.readdirSync(dir).filter((f) => f.startsWith('traces'))) {
  for (const snap of load(`${dir}/${file}`)) {
    const meta = new Map();
    for (const d of snap.meta || []) for (const ep of d.endpoints || []) meta.set(`${d.id}:${ep.id}`, ep.metadata || []);
    const values = new Map();
    for (const update of snap.data)
      for (const d of Array.isArray(update) ? update : [])
        for (const e of d.endpoints || [])
          for (const x of e.data || []) {
            if (x.validity === 'expired') continue;
            const key = `${d.id}:${e.id}`;
            values.set(key, { ...(values.get(key) || {}), [x.name]: x.value });
          }
    for (const ep of snap.config.endpoints || []) {
      const id = `${snap.product}|${ep.id_device}:${ep.id_endpoint}`;
      const metadata = meta.get(`${ep.id_device}:${ep.id_endpoint}`);
      if (seen.has(id) || !metadata) continue;
      seen.add(id);
      const category = resolveEndpointCategory({ firstUsage: ep.first_usage, metadata, settings: {} });
      const key = `${ep.first_usage} → ${ep.last_usage}`.padEnd(30) + ` => ${CATEGORY_NAMES[category] || category}`;
      const row = rows.get(key) || { count: 0, gateways: new Set() };
      row.count += 1;
      row.gateways.add(snap.product);
      rows.set(key, row);
      const recorded = values.get(`${ep.id_device}:${ep.id_endpoint}`);
      if (MAPPED[category] && recorded) {
        const list = samples.get(category) || [];
        if (list.length < 6) list.push(`${snap.product.padEnd(11)} ${JSON.stringify(MAPPED[category](recorded))}`);
        samples.set(category, list);
      }
    }
  }
}
for (const [key, row] of [...rows].sort()) console.log(`${key.padEnd(60)} x${row.count}  ${[...row.gateways].join('/')}`);
for (const [category, list] of samples) {
  console.log(`\n${CATEGORY_NAMES[category]} — Homey values from recorded data:`);
  list.forEach((line) => console.log(`  ${line}`));
}
