/* eslint-disable no-console */
/**
 * Tests the beta device drivers without hardware: runs the compiled device
 * classes against a fake Homey and a fake gateway serving values like those in
 * the recorded Tydom traffic (see replay-traces.js).
 *
 *   npm run build && node tydom-test/driver-tests.js
 */
const Module = require('module');
const path = require('path');
const B = path.join(__dirname, '..', '.homeybuild');
class FakeDevice {
  constructor(data, store = {}, caps) { this._data = data; this._store = store; this.caps = new Map(caps.map((c) => [c, undefined])); this.listeners = {}; this.available = null; this.errors = []; }
  getData() { return this._data; } getStoreValue(k) { return this._store[k]; }
  hasCapability(c) { return this.caps.has(c); } async removeCapability(c) { this.caps.delete(c); }
  async setCapabilityValue(c, v) { if (!this.caps.has(c)) throw new Error('no cap ' + c); this.caps.set(c, v); }
  registerCapabilityListener(c, fn) { this.listeners[c] = fn; }
  async setAvailable() { this.available = true; } async setUnavailable(r) { this.available = r; }
  log() {} error(...a) { this.errors.push(a.join(' ')); }
}
const orig = Module._resolveFilename;
Module._resolveFilename = function (r, ...a) { return r === 'homey' ? 'homey-stub' : orig.call(this, r, ...a); };
require.cache['homey-stub'] = { id: 'homey-stub', filename: 'homey-stub', loaded: true, exports: { Device: FakeDevice, Driver: class {} } };
const C = require(B + '/tydom/controller').default;

// Fake gateway controller serving one endpoint's recorded values.
function fakeController(values) {
  const ee = new (require('events'))(); ee.ready = true; ee.puts = [];
  ee.getDeviceState = async () => Object.entries(values).map(([name, value]) => ({ name, value }));
  ee.putData = async (d, e, name, value) => { ee.puts.push({ name, value }); };
  ee.subscribeTo = (id, fn) => { ee.sub = fn; }; ee.removeSubscription = () => {};
  C.find = () => ee; return ee;
}
const tick = () => new Promise((r) => setTimeout(r, 20));
const results = [];
const check = (label, cond, detail = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`);

async function run(driver, caps, values, steps) {
  const Klass = require(`${B}/drivers/${driver}/device.js`);
  const ctl = fakeController(values);
  const dev = new Klass({ id: 'x', mac: 'M', deviceId: 1, endpointId: 1 }, {}, caps);
  await dev.onInit(); await tick();
  await steps(dev, ctl);
  if (dev.errors.length) check(`${driver}: no errors`, false, dev.errors.join('; '));
}
(async () => {
  // Values below are taken from the recorded traces (replay-traces.js output).
  await run('shutter', ['windowcoverings_set', 'windowcoverings_state'], { position: 98, positionCmd: null, thermicDefect: false }, async (d, c) => {
    check('shutter: position 98 → 0.98', d.caps.get('windowcoverings_set') === 0.98, String(d.caps.get('windowcoverings_set')));
    check('shutter: available', d.available === true);
    await d.listeners.windowcoverings_set(0.5); check('shutter: set 0.5 → PUT position 50', JSON.stringify(c.puts.pop()) === '{"name":"position","value":50}');
    await d.listeners.windowcoverings_state('down'); check('shutter: down → PUT positionCmd DOWN', JSON.stringify(c.puts.pop()) === '{"name":"positionCmd","value":"DOWN"}');
    await d.listeners.windowcoverings_state('idle'); check('shutter: idle → PUT positionCmd STOP', JSON.stringify(c.puts.pop()) === '{"name":"positionCmd","value":"STOP"}');
    await c.sub({ name: 'position', value: 30, validity: 'upToDate' }); await tick(); check('shutter: push position 30 → 0.3', d.caps.get('windowcoverings_set') === 0.3);
  });
  await run('contact', ['alarm_contact', 'alarm_battery'], { intrusionDetect: false, openState: 'UNLOCKED', battDefect: false }, async (d, c) => {
    check('contact: openState UNLOCKED → open', d.caps.get('alarm_contact') === true);
    await c.sub({ name: 'openState', value: 'LOCKED', validity: 'upToDate' }); await tick(); check('contact: LOCKED → closed', d.caps.get('alarm_contact') === false);
    check('contact: sends nothing', c.puts.length === 0);
  });
  await run('contact', ['alarm_contact', 'alarm_battery'], { intrusionDetect: true, battDefect: false }, async (d) => {
    check('contact: intrusionDetect true (no openState) → open', d.caps.get('alarm_contact') === true);
  });
  await run('smoke', ['alarm_smoke', 'alarm_battery'], { techSmokeDefect: false, battDefect: true }, async (d, c) => {
    check('smoke: no smoke, battery alarm on', d.caps.get('alarm_smoke') === false && d.caps.get('alarm_battery') === true);
    await c.sub({ name: 'techSmokeDefect', value: true, validity: 'upToDate' }); await tick(); check('smoke: push → alarm', d.caps.get('alarm_smoke') === true);
    await c.sub({ name: 'techSmokeDefect', value: false, validity: 'expired' }); await tick(); check('smoke: expired value ignored', d.caps.get('alarm_smoke') === true);
  });
  await run('temperature', ['measure_temperature', 'alarm_battery'], { outTemperature: 13.32, battDefect: false }, async (d) => {
    check('temperature: 13.32 °C', d.caps.get('measure_temperature') === 13.32);
  });
  await run('heater', ['onoff', 'pilot_wire_mode'], { thermicLevel: 'ECO', hvacMode: 'NORMAL' }, async (d, c) => {
    check('heater: ECO → eco, on', d.caps.get('pilot_wire_mode') === 'eco' && d.caps.get('onoff') === true);
    await d.listeners.onoff(false); check('heater: off → PUT thermicLevel STOP', JSON.stringify(c.puts.pop()) === '{"name":"thermicLevel","value":"STOP"}');
    check('heater: now off', d.caps.get('onoff') === false && d.caps.get('pilot_wire_mode') === 'off');
    await d.listeners.onoff(true); check('heater: on from off → COMFORT', JSON.stringify(c.puts.pop()) === '{"name":"thermicLevel","value":"COMFORT"}');
    await d.setMode('frost'); check('heater: flow frost → ANTI_FROST', JSON.stringify(c.puts.pop()) === '{"name":"thermicLevel","value":"ANTI_FROST"}');
    let threw = false; try { await d.setMode('bogus'); } catch { threw = true; } check('heater: unknown mode rejected, nothing sent', threw && c.puts.length === 0);
  });
  // Light: on/off-only receiver loses dim; dimmable keeps it.
  for (const [dimmable, expectDim] of [[false, false], [undefined, true]]) {
    const Klass = require(`${B}/drivers/light/device.js`); fakeController({ level: 100 });
    const dev = new Klass({ id: 'l', mac: 'M', deviceId: 2, endpointId: 2 }, { dimmable }, ['onoff', 'dim']);
    dev.registerMultipleCapabilityListener = (caps) => { dev.multi = caps; };
    await dev.onInit(); await tick();
    check(`light: dimmable=${dimmable} → dim ${expectDim ? 'kept' : 'removed'}`, dev.hasCapability('dim') === expectDim && dev.caps.get('onoff') === true, `listens ${dev.multi}`);
  }
  console.log(results.join('\n'));
  const passed = results.filter((r) => r.startsWith("PASS")).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
