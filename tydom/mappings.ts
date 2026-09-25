// Tydom data → Homey capability values for the shutter, sensor and heater drivers. Pure
// functions over an endpoint's latest data values, so they can be checked
// against recorded gateway traffic (tydom-test/replay-traces.js). Semantics
// follow the Home Assistant Tydom integration.

export type EndpointValues = Record<string, unknown>;

const bool = (value: unknown) =>
  typeof value === 'boolean' ? value : undefined;

// Shutter position: 0 = closed, 100 = open → Homey 0..1.
export const shutterPosition = (v: EndpointValues) =>
  typeof v.position === 'number'
    ? Math.max(0, Math.min(100, v.position)) / 100
    : undefined;

// Door/window contacts: openState (LOCKED = closed) wins over intrusionDetect.
export const contactOpen = (v: EndpointValues) => {
  if (typeof v.openState === 'string') return v.openState !== 'LOCKED';
  return bool(v.intrusionDetect);
};

export const smokeDetected = (v: EndpointValues) => bool(v.techSmokeDefect);

export const batteryAlarm = (v: EndpointValues) => bool(v.battDefect);

export const outdoorTemperature = (v: EndpointValues) =>
  typeof v.outTemperature === 'number' ? v.outTemperature : undefined;

// Pilot-wire order (thermicLevel) ↔ Homey pilot_wire_mode values.
export const PILOT_WIRE_MODES: Record<string, string> = {
  COMFORT: 'comfort',
  MODERATO: 'comfort_1',
  MEDIO: 'comfort_2',
  ECO: 'eco',
  ANTI_FROST: 'frost',
  STOP: 'off',
  AUTO: 'auto',
};

export const pilotWireMode = (v: EndpointValues) =>
  typeof v.thermicLevel === 'string'
    ? PILOT_WIRE_MODES[v.thermicLevel]
    : undefined;

export const thermicLevelFor = (mode: string) =>
  Object.keys(PILOT_WIRE_MODES).find((k) => PILOT_WIRE_MODES[k] === mode);
