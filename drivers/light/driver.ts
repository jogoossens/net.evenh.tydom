import Homey from 'homey';
import { Categories } from '../../tydom/typings';
import setupPairing from '../../tydom/pairing';

class LightDriver extends Homey.Driver {
  async onInit() {
    this.log('LightDriver has been initialized');
    return Promise.resolve();
  }

  onPair(session: Parameters<NonNullable<Homey.Driver['onPair']>>[0]) {
    setupPairing(this, session, [Categories.LIGHTBULB]);
  }
}

module.exports = LightDriver;
