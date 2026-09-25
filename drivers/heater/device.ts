import { pilotWireMode, thermicLevelFor } from '../../tydom/mappings';
import TydomDevice from '../../tydom/tydom-device';

// Pilot-wire zone (e.g. RF 6600 FP): no setpoint, only a heating order
// (thermicLevel) — Comfort, Comfort -1/-2 °C, Eco, Frost protection, Off.
class Heater extends TydomDevice {
  protected async onTydomInit() {
    this.registerCapabilityListener('pilot_wire_mode', (mode: string) =>
      this.setMode(mode),
    );
    this.registerCapabilityListener('onoff', (on: boolean) => {
      const current = pilotWireMode(this.values);
      return this.setMode(on ? (current && current !== 'off' ? current : 'comfort') : 'off');
    });
  }

  // Also used by the "Set heating mode" flow card.
  public async setMode(mode: string) {
    const level = thermicLevelFor(mode);
    if (!level) throw new Error(`Unknown heating mode "${mode}"`);
    await this.put('thermicLevel', level);
    this.values.thermicLevel = level;
    await this.onValues();
  }

  protected async onValues() {
    const mode = pilotWireMode(this.values);
    await this.update('pilot_wire_mode', mode);
    await this.update('onoff', mode === undefined ? undefined : mode !== 'off');
  }
}

module.exports = Heater;
