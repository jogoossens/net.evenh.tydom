import Homey from 'homey';
import setupPairing from '../../tydom/pairing';
import { Categories } from '../../tydom/typings';

class SmokeDriver extends Homey.Driver {
  onPair(session: Parameters<NonNullable<Homey.Driver['onPair']>>[0]) {
    setupPairing(this, session, [Categories.SMOKE_SENSOR]);
  }
}

module.exports = SmokeDriver;
