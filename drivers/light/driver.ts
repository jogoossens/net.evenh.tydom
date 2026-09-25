import Homey from 'homey';
import { Categories } from '../../tydom/typings';
import TydomController from '../../tydom/controller';

class LightDriver extends Homey.Driver {
  async onInit() {
    this.log('LightDriver has been initialized');
    return Promise.resolve();
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return TydomController.getInstances().flatMap((c) =>
      c.getDevices(Categories.LIGHTBULB),
    );
  }
}

module.exports = LightDriver;
