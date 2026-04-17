import { Device } from 'homey';
import _ from 'lodash';
import TydomController from '../../tydom/controller';
import { TydomDataElement } from '../../tydom/typings';

// Max derogation duration (minutes). 65535 ≈ 45 days — effectively "no auto-off"
// for a manually-toggled boost.
const BOOST_DURATION_MINUTES = 65535;
const BOOST_SETPOINT_HEATING = 30;
const BOOST_SETPOINT_COOLING = 10;

class Thermostat extends Device {
  api!: TydomController;
  private lastAuthorization: string = 'AUTO';
  private lastHvacMode: string = 'NORMAL';
  private sensorFaults: { defect: boolean; shortCut: boolean; openCirc: boolean } = {
    defect: false,
    shortCut: false,
    openCirc: false,
  };
  private lastMeasured: number | null = null;
  private lastSetpoint: number | null = null;

  async onInit() {
    this.api = await TydomController.getInstance();

    if (!this.hasCapability('thermostat_mode')) {
      await this.addCapability('thermostat_mode');
    }
    if (!this.hasCapability('onoff.boost')) {
      await this.addCapability('onoff.boost');
    }
    if (!this.hasCapability('alarm_battery')) {
      await this.addCapability('alarm_battery');
    }
    if (!this.hasCapability('alarm_generic.production')) {
      await this.addCapability('alarm_generic.production');
    }
    if (!this.hasCapability('alarm_generic.sensor')) {
      await this.addCapability('alarm_generic.sensor');
    }

    this.registerCapabilityListener('target_temperature', async (value) => {
      await this.setTargetTemperature(value);
    });

    this.registerCapabilityListener('onoff', async (value) => {
      await this.setThermostatState(value);
    });

    this.registerCapabilityListener('thermostat_mode', async (value: string) => {
      await this.setThermostatMode(value);
    });

    this.registerCapabilityListener('onoff.boost', async (value: boolean) => {
      await this.setThermostatBoost(value);
    });

    // Receive out-of-band level changes, e.g. performed with physical controls.
    this.api.subscribeTo(
      this.getData().id,
      async (update: TydomDataElement) => {
        super.log(`update: ${JSON.stringify(update)}`);
        await this.onTydomStateChange(update);
      },
    );

    await this.seedInitialState();

    this.log('Thermostat has been initialized');
  }

  private async evaluateDeltaTriggers() {
    if (this.lastMeasured === null || this.lastSetpoint === null) return;
    const measured = this.lastMeasured;
    const setpoint = this.lastSetpoint;
    const difference = measured - setpoint;
    const absoluteTokens = {
      measured,
      setpoint,
      difference: roundToOneDecimal(Math.abs(difference)),
    };

    // Absolute direction triggers (not mode-aware).
    try {
      if (difference > 0) {
        await (this.homey.flow.getDeviceTriggerCard('temp_above_setpoint') as any)
          .trigger(this, absoluteTokens, { difference });
      } else if (difference < 0) {
        await (this.homey.flow.getDeviceTriggerCard('temp_below_setpoint') as any)
          .trigger(this, absoluteTokens, { difference: -difference });
      }
    } catch (err) {
      this.error('Failed to fire absolute delta trigger:', err);
    }

    // Mode-aware triggers. Only fire for HEATING / COOLING (well-defined
    // "wrong direction"). In AUTO or STOP the semantic is ambiguous, so skip.
    const auth = this.lastAuthorization;
    if (auth !== 'HEATING' && auth !== 'COOLING') return;

    // shortfall is positive when HVAC is under-performing:
    //   HEATING: room colder than setpoint (setpoint - measured)
    //   COOLING: room warmer than setpoint (measured - setpoint)
    const shortfall = auth === 'HEATING' ? setpoint - measured : measured - setpoint;
    const modeTokens = {
      measured,
      setpoint,
      shortfall: roundToOneDecimal(shortfall),
      mode: auth,
    };

    try {
      await (this.homey.flow.getDeviceTriggerCard('setpoint_unmet') as any)
        .trigger(this, modeTokens, { shortfall });

      // "reached" fires when shortfall ≤ tolerance (i.e. target hit or passed).
      // Runlistener compares tolerance arg to -state.shortfall sign.
      await (this.homey.flow.getDeviceTriggerCard('setpoint_reached') as any)
        .trigger(this, { measured, setpoint, mode: auth }, { shortfall });
    } catch (err) {
      this.error('Failed to fire mode-aware trigger:', err);
    }
  }

  private async refreshSensorAlarm() {
    const any =
      this.sensorFaults.defect ||
      this.sensorFaults.shortCut ||
      this.sensorFaults.openCirc;
    await this.setCapabilityValue('alarm_generic.sensor', any);
  }

  private async seedInitialState() {
    const { deviceId, endpointId } = this.getData();
    try {
      const data = await this.api.getDeviceState(deviceId, endpointId);
      for (const element of data) await this.onTydomStateChange(element);
    } catch (err) {
      this.error('Failed to seed initial state:', err);
    }
  }

  // Clean up OOB level changes.
  async onUninit() {
    this.api.removeSubscription(this.getData().id);
  }

  private async setTargetTemperature(value: number) {
    const { endpointId, deviceId } = this.getData();
    await this.api
      .updateThermostatTemperature(deviceId, endpointId, value)
      .then(async () => {
        await this.updateTargetTemperatureUiValue(value);
      });
  }

  private async setThermostatState(value: boolean) {
    const { endpointId, deviceId } = this.getData();
    await this.api
      .updateThermostatState(deviceId, endpointId, value)
      .then(async () => {
        await this.setCapabilityValue('onoff', value);
      });
  }

  private async setThermostatMode(value: string) {
    const { endpointId, deviceId } = this.getData();
    const tydomValue = homeyModeToTydomAuthorization(value);
    if (!tydomValue) return;
    await this.api
      .updateThermostatMode(deviceId, endpointId, tydomValue)
      .then(async () => {
        await this.setCapabilityValue('thermostat_mode', value);
      });
  }

  private async setThermostatBoost(value: boolean) {
    await this.applyBoost(value);
  }

  /**
   * Public boost control — used by both the onoff.boost capability and the
   * flow action cards. When `minutes` is omitted the derogation runs for the
   * max (~45 days), which is effectively "no auto-off".
   */
  public async applyBoost(on: boolean, minutes?: number) {
    const { endpointId, deviceId } = this.getData();

    if (on) {
      // Re-fetch live state before deciding. We can't trust cached
      // lastHvacMode/lastAuthorization — push updates can be missed, and for
      // boost specifically we want to be certain we're not arming a derogation
      // on a stopped thermostat (which the Tybox firmware will auto-wake).
      let hvacMode = this.lastHvacMode;
      let authorization = this.lastAuthorization;
      try {
        const data = await this.api.getDeviceState(deviceId, endpointId);
        for (const element of data) {
          if (element.name === 'hvacMode' && element.value !== null) {
            hvacMode = <string>element.value;
            this.lastHvacMode = hvacMode;
          }
          if (element.name === 'authorization' && element.value !== null) {
            authorization = <string>element.value;
            this.lastAuthorization = authorization;
          }
        }
      } catch (err) {
        this.error('applyBoost: failed to refresh state, using cached:', err);
      }

      if (hvacMode !== 'NORMAL' || authorization === 'STOP') {
        this.log(
          `Refusing boost: thermostat is not active (hvacMode=${hvacMode} authorization=${authorization}). Turn the thermostat on first.`,
        );
        await this.setCapabilityValue('onoff.boost', false);
        return;
      }

      const target =
        authorization === 'COOLING'
          ? BOOST_SETPOINT_COOLING
          : BOOST_SETPOINT_HEATING;
      const duration = minutes ?? BOOST_DURATION_MINUTES;
      this.log(
        `Starting boost: setpoint=${target} for ${duration} min (auth=${authorization})`,
      );
      await this.api.startThermostatDerogation(
        deviceId,
        endpointId,
        target,
        duration,
      );
      await this.setCapabilityValue('onoff.boost', true);
      return;
    }

    // Turning boost OFF is always safe — cancel any stale derogation.
    this.log('Cancelling boost derogation');
    await this.api.cancelThermostatDerogation(deviceId, endpointId);
    await this.setCapabilityValue('onoff.boost', false);
  }

  private async updateTargetTemperatureUiValue(newValue: number) {
    // TODO: Determine if on
    await this.setCapabilityValue(
      'target_temperature',
      roundToOneDecimal(newValue),
    ).catch((err) => this.error(err));
  }

  // Receive out-of-band level changes, e.g. performed with physical controls.
  private async onTydomStateChange(newRemoteState: TydomDataElement) {
    if (newRemoteState.validity === 'expired') return Promise.resolve();

    switch (newRemoteState.name) {
      // Actual temperature reading
      case 'temperature':
        // modify current temperature
        await this.setCapabilityValue(
          'measure_temperature',
          <number>newRemoteState.value,
        );
        this.lastMeasured = <number>newRemoteState.value;
        await this.evaluateDeltaTriggers();
        break;
      // Desired temperature
      case 'setpoint':
        if (newRemoteState.value !== null) {
          const sp = roundToOneDecimal(<number>newRemoteState.value);
          await this.setCapabilityValue('target_temperature', sp);
          this.lastSetpoint = sp;
          await this.evaluateDeltaTriggers();
        }
        break;
      case 'hvacMode':
        if (newRemoteState.value !== null) {
          const stringValue = <string>newRemoteState.value;
          this.lastHvacMode = stringValue;
          const isOn = stringValue !== 'STOP';
          await this.setCapabilityValue('onoff', isOn);
        }
        break;
      case 'authorization':
        if (newRemoteState.value !== null) {
          this.lastAuthorization = <string>newRemoteState.value;
          const mode = tydomAuthorizationToHomeyMode(
            <string>newRemoteState.value,
          );
          if (mode) await this.setCapabilityValue('thermostat_mode', mode);
        }
        break;
      // On this Tybox model the `boostOn` flag is read-only / inert. We instead
      // implement "boost" via a setpoint derogation, whose active state shows
      // up as `tempoOn=true`. Mirror tempoOn into the onoff.boost capability
      // so Homey reflects derogations triggered from anywhere (this app or
      // the Tydom mobile app).
      case 'tempoOn':
        if (newRemoteState.value !== null) {
          await this.setCapabilityValue(
            'onoff.boost',
            <boolean>newRemoteState.value,
          );
        }
        break;
      case 'batteryCmdDefect':
        await this.setCapabilityValue(
          'alarm_battery',
          !!newRemoteState.value,
        );
        break;
      case 'productionDefect':
        await this.setCapabilityValue(
          'alarm_generic.production',
          !!newRemoteState.value,
        );
        break;
      case 'tempSensorDefect':
        this.sensorFaults.defect = !!newRemoteState.value;
        await this.refreshSensorAlarm();
        break;
      case 'tempSensorShortCut':
        this.sensorFaults.shortCut = !!newRemoteState.value;
        await this.refreshSensorAlarm();
        break;
      case 'tempSensorOpenCirc':
        this.sensorFaults.openCirc = !!newRemoteState.value;
        await this.refreshSensorAlarm();
        break;
      default:
        return Promise.resolve();
    }

    return Promise.resolve();
  }

  async onAdded() {
    this.log('Thermostat has been added');
  }

  async onSettings({oldSettings: {}, newSettings: {}, changedKeys: {}}): Promise<void> {
    this.log('Thermostat settings where changed');
  }

  async onRenamed(name: string) {
    this.log(`Thermostat was renamed to ${name}`);
  }

  async onDeleted() {
    this.log('Thermostat has been deleted');
  }
}

function roundToOneDecimal(n: number) {
  return _.round(n, 1);
}

function tydomAuthorizationToHomeyMode(value: string): string | null {
  switch (value) {
    case 'HEATING': return 'heat';
    case 'COOLING': return 'cool';
    case 'AUTO': return 'auto';
    case 'STOP': return 'off';
    default: return null;
  }
}

function homeyModeToTydomAuthorization(
  value: string,
): 'HEATING' | 'COOLING' | 'AUTO' | 'STOP' | null {
  switch (value) {
    case 'heat': return 'HEATING';
    case 'cool': return 'COOLING';
    case 'auto': return 'AUTO';
    case 'off': return 'STOP';
    default: return null;
  }
}

module.exports = Thermostat;
