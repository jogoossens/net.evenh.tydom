import Homey from 'homey';
import TydomController from '../../tydom/controller';
import { Categories } from '../../tydom/typings';

class ThermostatDriver extends Homey.Driver {
  private api!: TydomController;

  async onInit() {
    this.api = await TydomController.getInstance();

    // Filter flow runs by the user's configured delta. Our device.ts fires
    // these triggers with state.difference = absolute overshoot/undershoot in
    // °C. Return true when it meets or exceeds the user-configured threshold.
    this.homey.flow
      .getDeviceTriggerCard('temp_above_setpoint')
      .registerRunListener(async (args: { delta: number }, state: { difference: number }) => {
        return state.difference >= args.delta;
      });
    this.homey.flow
      .getDeviceTriggerCard('temp_below_setpoint')
      .registerRunListener(async (args: { delta: number }, state: { difference: number }) => {
        return state.difference >= args.delta;
      });

    // Mode-aware: fires when the HVAC is under-performing by at least args.delta.
    this.homey.flow
      .getDeviceTriggerCard('setpoint_unmet')
      .registerRunListener(async (args: { delta: number }, state: { shortfall: number }) => {
        return state.shortfall >= args.delta;
      });

    // Mode-aware: fires when the room has reached / passed the setpoint
    // within the tolerance (shortfall <= tolerance, including negative).
    this.homey.flow
      .getDeviceTriggerCard('setpoint_reached')
      .registerRunListener(async (args: { tolerance: number }, state: { shortfall: number }) => {
        return state.shortfall <= args.tolerance;
      });

    this.homey.flow
      .getActionCard('boost_on')
      .registerRunListener(async (args: { device: any }) => {
        await args.device.applyBoost(true);
      });
    this.homey.flow
      .getActionCard('boost_off')
      .registerRunListener(async (args: { device: any }) => {
        await args.device.applyBoost(false);
      });
    this.homey.flow
      .getActionCard('boost_on_for')
      .registerRunListener(async (args: { device: any; minutes: number }) => {
        await args.device.applyBoost(true, args.minutes);
      });

    this.log('ThermostatDriver has been initialized');
    return Promise.resolve();
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return this.api.getDevices(Categories.THERMOSTAT);
  }
}

module.exports = ThermostatDriver;
