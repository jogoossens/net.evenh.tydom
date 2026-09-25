import { shutterPosition } from '../../tydom/mappings';
import TydomDevice from '../../tydom/tydom-device';

const COMMANDS: Record<string, string> = { up: 'UP', down: 'DOWN', idle: 'STOP' };

class Shutter extends TydomDevice {
  protected async onTydomInit() {
    this.registerCapabilityListener('windowcoverings_set', (value: number) =>
      this.put('position', Math.round(value * 100)),
    );
    this.registerCapabilityListener('windowcoverings_state', (value: string) =>
      this.put('positionCmd', COMMANDS[value]),
    );
  }

  protected async onValues() {
    await this.update('windowcoverings_set', shutterPosition(this.values));
  }
}

module.exports = Shutter;
