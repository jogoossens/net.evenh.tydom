import Homey from 'homey';
import setupPairing from '../../tydom/pairing';
import { Categories } from '../../tydom/typings';

class HeaterDriver extends Homey.Driver {
  async onInit() {
    this.homey.flow
      .getActionCard('pilot_wire_set_mode')
      .registerRunListener(async (args: { device: any; mode: string }) => {
        await args.device.setMode(args.mode);
      });
  }

  onPair(session: Parameters<NonNullable<Homey.Driver['onPair']>>[0]) {
    setupPairing(this, session, [Categories.PILOT_WIRE_HEATER]);
  }
}

module.exports = HeaterDriver;
