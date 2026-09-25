import { Device } from 'homey';
import TydomController from './controller';
import DeviceLink from './device-link';
import { EndpointValues } from './mappings';
import { TydomDataElement } from './typings';

// Base for the beta device types: keeps the endpoint's latest data values and
// calls onValues() whenever they change (initial read or a Tydom push).
export default abstract class TydomDevice extends Device {
  link!: DeviceLink;
  protected values: EndpointValues = {};

  protected get api(): TydomController {
    return this.link.connected;
  }

  async onInit() {
    await this.onTydomInit();
    this.link = new DeviceLink(
      this,
      (update) => this.handleUpdates([update]),
      () => this.seed(),
    );
    this.link.attach();
  }

  async onUninit() {
    this.link?.detach();
  }

  // Register capability listeners here.
  protected async onTydomInit(): Promise<void> {
    return Promise.resolve();
  }

  // Map this.values onto capabilities.
  protected abstract onValues(): Promise<void>;

  protected async put(name: string, value: unknown) {
    const { deviceId, endpointId } = this.getData();
    await this.api.putData(deviceId, endpointId, name, value);
  }

  protected async update(capability: string, value: unknown) {
    if (value === undefined || !this.hasCapability(capability)) return;
    await this.setCapabilityValue(capability, value).catch((err) =>
      this.error(err),
    );
  }

  private async seed() {
    const { deviceId, endpointId } = this.getData();
    try {
      await this.handleUpdates(await this.api.getDeviceState(deviceId, endpointId));
    } catch (err) {
      this.error('Failed to read initial state:', err);
    }
  }

  private async handleUpdates(updates: TydomDataElement[]) {
    updates
      .filter((u) => u.validity !== 'expired')
      .forEach((u) => {
        this.values[u.name] = u.value;
      });
    await this.onValues();
  }
}
