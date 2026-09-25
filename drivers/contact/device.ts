import { batteryAlarm, contactOpen } from '../../tydom/mappings';
import TydomDevice from '../../tydom/tydom-device';

class Contact extends TydomDevice {
  protected async onValues() {
    await this.update('alarm_contact', contactOpen(this.values));
    await this.update('alarm_battery', batteryAlarm(this.values));
  }
}

module.exports = Contact;
