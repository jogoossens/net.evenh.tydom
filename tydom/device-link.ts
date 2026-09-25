import { Device } from 'homey';
import TydomController from './controller';
import { TydomDataElement } from './typings';

// Connects a Homey device to its gateway's controller and follows it:
// unavailable (with the reason) while the gateway is down, re-seeded when it
// is back. attach() is re-run by the app whenever the gateway list changes.
export default class DeviceLink {
  api?: TydomController;

  constructor(
    private device: Device,
    private onUpdate: (update: TydomDataElement) => Promise<void>,
    private onReady: () => Promise<void>,
  ) {}

  attach() {
    const api = TydomController.find(this.device.getData().mac);
    if (api === this.api) return;
    this.detach();
    if (!api) {
      this.setUnavailable(
        'This Tydom gateway is no longer set up — connect it again by adding a device (Devices → + → Delta Dore Tydom)',
      );
      return;
    }
    this.api = api;
    api.subscribeTo(this.device.getData().id, (update) =>
      this.onUpdate(update).catch((err) => this.device.error(err)),
    );
    api.on('ready', this.handleReady);
    api.on('unavailable', this.setUnavailable);
    if (api.ready) this.handleReady();
    else this.setUnavailable(api.lastError || 'Connecting to your Tydom gateway…');
  }

  detach() {
    if (!this.api) return;
    this.api.removeSubscription(this.device.getData().id);
    this.api.off('ready', this.handleReady);
    this.api.off('unavailable', this.setUnavailable);
    this.api = undefined;
  }

  // Throws a readable error for capability changes while disconnected.
  get connected(): TydomController {
    if (!this.api?.ready)
      throw new Error(this.api?.lastError || 'Tydom gateway not connected');
    return this.api;
  }

  private handleReady = () => {
    this.device
      .setAvailable()
      .then(() => this.onReady())
      .catch((err) => this.device.error(err));
  };

  private setUnavailable = (reason: string) => {
    this.device.setUnavailable(reason).catch((err) => this.device.error(err));
  };
}
