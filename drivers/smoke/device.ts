import { batteryAlarm, smokeDetected } from '../../tydom/mappings';
import TydomDevice from '../../tydom/tydom-device';

class Smoke extends TydomDevice {
  protected async onValues() {
    await this.update('alarm_smoke', smokeDetected(this.values));
    await this.update('alarm_battery', batteryAlarm(this.values));
  }
}

module.exports = Smoke;
