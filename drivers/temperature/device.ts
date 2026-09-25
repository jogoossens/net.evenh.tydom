import { batteryAlarm, outdoorTemperature } from '../../tydom/mappings';
import TydomDevice from '../../tydom/tydom-device';

class Temperature extends TydomDevice {
  protected async onValues() {
    await this.update('measure_temperature', outdoorTemperature(this.values));
    await this.update('alarm_battery', batteryAlarm(this.values));
  }
}

module.exports = Temperature;
