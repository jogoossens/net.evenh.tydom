import EventEmitter from 'events';
import { debounce, get } from 'lodash';
import { TydomHttpMessage, TydomResponse } from 'tydom-client/lib/utils/tydom';
import TydomClient, { createClient } from 'tydom-client';
import { Logger, stringIncludes } from './util';
import {
  Categories,
  ControllerUpdatePayload,
  TydomAccessoryContext,
  TydomAccessoryUpdateContext,
  TydomConfigResponse,
  TydomDataElement,
  TydomDeviceDataUpdateBody,
  TydomGroupsResponse,
  TydomMetaResponse,
  TydomPlatformConfig,
} from './typings';
import {
  asyncWait,
  getEndpointDetailsFromMeta,
  getEndpointGroupIdFromGroups,
  getTydomDeviceData,
  resolveEndpointCategory,
} from './helpers';
import { TydomEndpointData } from './typings';

const DEFAULT_REFRESH_INTERVAL_SEC = 4 * 60 * 60; // 4 hours
const CONNECT_TIMEOUT_MS = 20 * 1000;
const RETRY_DELAYS_SEC = [10, 30, 60];

export type GatewayState = 'connecting' | 'connected' | 'error' | 'stopped';

export interface GatewayStatus {
  mac: string;
  name?: string;
  hostname: string;
  state: GatewayState;
  error?: string;
  thermostats: number;
  lights: number;
}

const UNREACHABLE = [
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
];

// Turn tydom-client / network errors into something a user can act on.
// Tydom 1.0 answers a wrong password with a 401 or with silence, and serves
// only one local client at a time.
export const describeConnectionError = (err: any, hostname: string) => {
  const message = err instanceof Error ? err.message : String(err);
  if (!hostname) return 'Looking for this gateway on your network…';
  if (/\b401\b/.test(message)) return 'Wrong gateway password';
  if (UNREACHABLE.includes(err?.code))
    return `Can't reach ${hostname} — is the gateway powered on and on the same network as Homey?`;
  if (/No answer/.test(message))
    return `The gateway at ${hostname} didn't answer. Check the gateway password, and close the Tydom app on this network (the gateway serves one connection at a time)`;
  return message;
};

export default class TydomController extends EventEmitter {
  // One controller per gateway, keyed by gateway MAC (= Tydom username).
  private static instances: Map<string, TydomController> = new Map();

  private log: Logger;
  private apiClient?: TydomClient;
  public config!: TydomPlatformConfig;
  private refreshInterval?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private retryCount = 0;
  private stopped = false;

  public state: GatewayState = 'connecting';
  public lastError?: string;
  // Connected and devices scanned.
  public ready = false;

  private devicesInCategories: Map<string, Categories> = new Map();
  private devices: Map<string, TydomAccessoryContext> = new Map();
  private state_: Map<string, unknown> = new Map();

  private subscribers: Map<string, (update: TydomDataElement) => void> =
    new Map();
  private constructor(log: Logger, config: TydomPlatformConfig) {
    super();
    this.log = log;
    this.config = config;
    // Every device of this gateway listens to ready/unavailable.
    this.setMaxListeners(0);
    this.on('update', async (update: ControllerUpdatePayload) => {
      await this.handleUpdate(update);
    });
  }

  // Create the controller for a gateway, or update it and reconnect when its
  // connection settings changed.
  public static upsert(
    log: Logger,
    config: TydomPlatformConfig,
  ): TydomController {
    const existing = TydomController.instances.get(config.username);
    if (!existing) {
      const controller = new TydomController(log, config);
      TydomController.instances.set(config.username, controller);
      controller.start();
      return controller;
    }
    const changed =
      existing.config.hostname !== config.hostname ||
      existing.config.password !== config.password;
    existing.config = { ...existing.config, ...config };
    if (changed) existing.restart();
    return existing;
  }

  public static remove(mac: string) {
    const controller = TydomController.instances.get(mac);
    if (!controller) return;
    controller.stop();
    TydomController.instances.delete(mac);
  }

  // Devices paired before multi-gateway support carry no mac in their data;
  // they belong to the first (then only) configured gateway.
  public static find(mac?: string): TydomController | undefined {
    return mac
      ? TydomController.instances.get(mac)
      : TydomController.instances.values().next().value;
  }

  public static getInstances(): TydomController[] {
    return [...TydomController.instances.values()];
  }

  private static getUniqueId(deviceId: number, endpointId: number): string {
    return deviceId === endpointId
      ? `${deviceId}`
      : `${deviceId}:${endpointId}`;
  }

  private getAccessoryId(deviceId: number, endpointId: number): string {
    return `tydom:${this.config.username.slice(
      6,
    )}:accessories:${TydomController.getUniqueId(deviceId, endpointId)}`;
  }

  private get client(): TydomClient {
    if (!this.apiClient) throw new Error('Not connected to the Tydom gateway');
    return this.apiClient;
  }

  private start() {
    this.stopped = false;
    clearTimeout(this.retryTimer);
    this.state = 'connecting';
    if (!this.config.hostname) {
      // Waiting for discovery to find the gateway; upsert() restarts us.
      this.fail(new Error('No address yet'), false);
      return;
    }
    this.connectAndScan();
  }

  private async connectAndScan() {
    const { hostname } = this.config;
    const client = this.createApiClient();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          await client.connect();
          await asyncWait(250);
          await client.get('/ping');
          await this.scan();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`No answer from ${hostname}`)),
            CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
      if (client !== this.apiClient) return; // superseded by a restart
      this.retryCount = 0;
      this.state = 'connected';
      this.lastError = undefined;
      this.ready = true;
      this.log.info(`Tydom ${this.config.username} connected at ${hostname}`);
      this.emit('ready');
    } catch (err) {
      if (client !== this.apiClient || this.stopped) return;
      this.closeApiClient();
      this.fail(err);
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(err: unknown, retry = true) {
    this.ready = false;
    this.state = 'error';
    this.lastError = describeConnectionError(err, this.config.hostname);
    this.log.error(`Tydom ${this.config.username}: ${this.lastError}`);
    this.emit('unavailable', this.lastError);
    if (!retry || this.stopped) return;
    const delay =
      RETRY_DELAYS_SEC[Math.min(this.retryCount, RETRY_DELAYS_SEC.length - 1)];
    this.retryCount += 1;
    this.retryTimer = setTimeout(() => this.start(), delay * 1000);
  }

  // tydom-client's own retryOnClose is off: a close() doesn't stop it, so
  // closed clients would keep reconnecting and hog the gateway's single
  // connection. Reconnects are handled here instead.
  private createApiClient(): TydomClient {
    this.closeApiClient();
    const { hostname, username, password } = this.config;
    const client = createClient({
      hostname,
      username,
      password,
      followUpDebounce: 500,
      retryOnClose: false,
    });
    client.on('disconnect', () => {
      if (client !== this.apiClient || this.stopped) return;
      if (this.state !== 'connected') return; // connect failure, handled above
      this.apiClient = undefined;
      this.fail(new Error('Connection to the gateway was lost'));
    });
    client.on('message', (message: TydomHttpMessage) => {
      try {
        this.handleMessage(message);
      } catch (err) {
        this.log.error(
          `Encountered an uncaught error while processing message=${JSON.stringify(
            message,
          )}`,
        );
        this.log.debug(`${err instanceof Error ? err.stack : err}`);
      }
    });
    this.apiClient = client;
    return client;
  }

  private closeApiClient() {
    const client = this.apiClient;
    this.apiClient = undefined;
    if (!client) return;
    try {
      client.close();
    } catch {
      // never connected
    }
  }

  private restart() {
    this.ready = false;
    this.closeApiClient();
    this.emit('unavailable', 'Reconnecting to the Tydom gateway…');
    this.retryCount = 0;
    this.start();
  }

  public stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.ready = false;
    this.state = 'stopped';
    this.closeApiClient();
    this.emit(
      'unavailable',
      'This Tydom gateway was removed — connect it again by adding a device (Devices → + → Delta Dore Tydom)',
    );
  }

  // Resolves true once connected and scanned, false on a failed attempt or
  // timeout.
  public waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (value: boolean) => {
        clearTimeout(timer);
        this.off('ready', onReady);
        this.off('unavailable', onFail);
        resolve(value);
      };
      const onReady = () => done(true);
      const onFail = () => {
        if (this.state === 'error') done(false);
      };
      const timer = setTimeout(() => done(this.ready), timeoutMs);
      this.on('ready', onReady);
      this.on('unavailable', onFail);
    });
  }

  public getStatus(): GatewayStatus {
    const count = (category: Categories) =>
      [...this.devicesInCategories.values()].filter((c) => c === category)
        .length;
    return {
      mac: this.config.username,
      name: this.config.gatewayName,
      hostname: this.config.hostname,
      state: this.state,
      error: this.lastError,
      thermostats: count(Categories.THERMOSTAT),
      lights: count(Categories.LIGHTBULB),
    };
  }

  // Every message from Tydom gets checked here
  private handleMessage(message: TydomHttpMessage): void {
    const { uri, method, body } = message;
    const isDeviceUpdate = uri === '/devices/data' && method === 'PUT';
    if (isDeviceUpdate) {
      this.handleDeviceDataUpdate(body, 'data');
      return;
    }
    const isDeviceCommandUpdate = uri === '/devices/cdata' && method === 'PUT';
    if (isDeviceCommandUpdate) {
      this.handleDeviceDataUpdate(body, 'cdata');
      return;
    }
    this.log.debug('Unknown message from Tydom client', message);
  }

  private handleDeviceDataUpdate(
    body: TydomResponse,
    type: 'data' | 'cdata',
  ): void {
    if (!Array.isArray(body)) {
      this.log.debug('Unsupported non-array device update', body);
      return;
    }

    (body as TydomDeviceDataUpdateBody).forEach((device) => {
      const { id: deviceId, endpoints } = device;
      for (const endpoint of endpoints) {
        const { id: endpointId, data, cdata } = endpoint;
        const updates = type === 'data' ? data : cdata;
        const uniqueId = TydomController.getUniqueId(deviceId, endpointId);
        if (!this.devicesInCategories.has(uniqueId)) {
          this.log.debug(
            `←PUT:ignored for device id=${deviceId} and endpointId=${endpointId}`,
          );
          return;
        }
        const category =
          this.devicesInCategories.get(uniqueId) ?? Categories.OTHER;
        const accessoryId = this.getAccessoryId(deviceId, endpointId);
        this.log.debug(
          `←PUT:update for deviceId=${deviceId} and endpointId=${endpointId}, updates:\n`,
          JSON.stringify(updates),
        );
        const context: TydomAccessoryUpdateContext = {
          category,
          deviceId,
          endpointId,
          accessoryId,
        };
        this.emit('update', {
          type,
          updates,
          context,
        } as ControllerUpdatePayload);
      }
    });
  }

  public async sync(): Promise<{
    config: TydomConfigResponse;
    groups: TydomGroupsResponse;
    meta: TydomMetaResponse;
  }> {
    const { hostname, refreshInterval = DEFAULT_REFRESH_INTERVAL_SEC } =
      this.config;
    this.log.debug(`Syncing state from hostname=${hostname}...`);

    const config = await this.client.get<TydomConfigResponse>(
      '/configs/file',
    );
    const groups = await this.client.get<TydomGroupsResponse>(
      '/groups/file',
    );
    const meta = await this.client.get<TydomMetaResponse>('/devices/meta');

    // Final outro handshake
    await this.refresh();
    if (this.refreshInterval) {
      this.log.debug('Removing existing refresh interval');
      clearInterval(this.refreshInterval);
    }
    this.log.debug(
      `Configuring refresh interval of ${Math.round(refreshInterval)}s`,
    );
    this.refreshInterval = setInterval(async () => {
      try {
        await this.refresh();
      } catch (err) {
        this.log.debug('Failed interval refresh with err', err);
      }
    }, refreshInterval * 1000);
    Object.assign(this.state_, { config, groups, meta });
    return { config, groups, meta };
  }

  public async scan(): Promise<void> {
    this.log.info(`Scanning devices from hostname=${this.config.hostname}...`);
    const {
      settings = {},
      includedDevices = [],
      excludedDevices = [],
      includedCategories = [],
      excludedCategories = [],
    } = this.config;
    const { config, groups, meta } = await this.sync();
    const { endpoints, groups: configGroups } = config;
    endpoints.forEach((endpoint) => {
      const {
        id_endpoint: endpointId,
        id_device: deviceId,
        name: deviceName,
        first_usage: firstUsage,
      } = endpoint;
      const uniqueId = TydomController.getUniqueId(deviceId, endpointId);
      const { metadata } = getEndpointDetailsFromMeta(endpoint, meta);
      const groupId = getEndpointGroupIdFromGroups(endpoint, groups);
      const group = groupId
        ? configGroups.find(({ id }) => id === groupId)
        : undefined;
      const deviceSettings = settings[deviceId] || {};
      const categoryFromSettings = deviceSettings.category;
      // @TODO resolve endpoint productType
      this.log.debug(
        `Found new device with firstUsage=${firstUsage}, deviceId=${deviceId} and endpointId=${endpointId}`,
      );
      if (includedDevices.length && !stringIncludes(includedDevices, deviceId))
        return;

      if (excludedDevices.length && stringIncludes(excludedDevices, deviceId))
        return;

      const category =
        categoryFromSettings ||
        resolveEndpointCategory({
          firstUsage,
          metadata,
          settings: deviceSettings,
        });
      if (!category) {
        this.log.warn(
          `Unsupported firstUsage="${firstUsage}" for endpoint with deviceId="${deviceId}"`,
        );
        this.log.debug({ endpoint });
        return;
      }
      if (
        includedCategories.length &&
        !stringIncludes(includedCategories, category)
      )
        return;

      if (
        excludedCategories.length &&
        stringIncludes(excludedCategories, category)
      )
        return;

      if (!this.devicesInCategories.has(uniqueId)) {
        this.log.debug(
          `Adding new device with firstUsage=${firstUsage}, deviceId=${deviceId} and endpointId=${endpointId}`,
        );
        const accessoryId = this.getAccessoryId(deviceId, endpointId);
        const nameFromSetting = get(settings, `${deviceId}.name`) as
          | string
          | undefined;
        const name = nameFromSetting || deviceName;
        this.devicesInCategories.set(uniqueId, category);
        const context: TydomAccessoryContext = {
          name,
          category,
          metadata,
          settings: deviceSettings,
          group,
          deviceId,
          endpointId,
          accessoryId,
          manufacturer: 'Delta Dore',
          serialNumber: `ID${deviceId}`,
          // model: 'N/A',
          state: {},
        };
        this.devices.set(uniqueId, context);
        this.emit('device', context);
      }
    });
  }

  async refresh(): Promise<unknown> {
    this.log.debug('Refreshing Tydom controller ...');
    return this.client.post('/refresh/all');
  }

  public getDevicesForCategory(
    category: Categories,
  ): (TydomAccessoryContext | undefined)[] {
    const items = [];
    for (const entry of this.devicesInCategories.entries())
      if (entry[1] === category) items.push(entry[0]);

    return items.map((id) => this.devices.get(id));
  }

  public async updateLightLevel(
    deviceId: string,
    endpointId: string,
    level: number,
  ) {
    await this.doPut(deviceId, endpointId, 'level')(level);
  }

  public async updateThermostatTemperature(
    deviceId: string,
    endpointId: string,
    temperature: number,
  ) {
    await this.doPut(deviceId, endpointId, 'setpoint')(temperature);
  }

  public async updateThermostatState(
    deviceId: string,
    endpointId: string,
    enabled: boolean,
  ) {
    await this.doPut(
      deviceId,
      endpointId,
      'hvacMode',
    )(enabled ? 'NORMAL' : 'STOP');
  }

  public async updateThermostatMode(
    deviceId: string,
    endpointId: string,
    tydomAuthorization: 'HEATING' | 'COOLING' | 'AUTO' | 'STOP',
  ) {
    await this.doPut(deviceId, endpointId, 'authorization')(tydomAuthorization);
  }

  public async updateThermostatBoost(
    deviceId: string,
    endpointId: string,
    enabled: boolean,
  ) {
    await this.doPut(deviceId, endpointId, 'boostOn')(enabled);
  }

  // Start a setpoint derogation. This is the Tydom-native mechanism for "force
  // the thermostat to run at a specific setpoint for N minutes". Writing all
  // three fields in a single PUT arms the derogation; on this Tybox model the
  // derogation overrides the weekly schedule until timeDelay reaches 0 or the
  // caller cancels.
  public async startThermostatDerogation(
    deviceId: string,
    endpointId: string,
    setpoint: number,
    minutes: number,
  ) {
    await this.client.put(
      `/devices/${deviceId}/endpoints/${endpointId}/data`,
      [
        { name: 'delaySetpoint', value: setpoint },
        { name: 'delayThermicLevel', value: 'COMFORT' },
        { name: 'timeDelay', value: minutes },
      ],
    );
  }

  public async cancelThermostatDerogation(
    deviceId: string,
    endpointId: string,
  ) {
    await this.client.put(
      `/devices/${deviceId}/endpoints/${endpointId}/data`,
      [{ name: 'timeDelay', value: 0 }],
    );
  }

  public subscribeTo(id: string, fn: (update: TydomDataElement) => void) {
    this.log.debug(`Adding subscriber for ID=${id}`);
    this.subscribers.set(id, fn);
  }

  public removeSubscription(id: string) {
    this.log.debug(`Removing subscriber for ID=${id}`);
    this.subscribers.delete(id);
  }

  public async getDeviceState(
    deviceId: number,
    endpointId: number,
  ): Promise<TydomEndpointData> {
    return getTydomDeviceData(this.client, { deviceId, endpointId });
  }

  public getDevices(category: Categories) {
    // Tell same-named devices apart in the pair list when several gateways exist.
    const suffix =
      TydomController.instances.size > 1
        ? ` · ${this.config.gatewayName || this.config.username}`
        : '';
    return this.getDevicesForCategory(category).map((v) => ({
      name: `${v?.name}${suffix}`,
      data: {
        id: v?.accessoryId,
        mac: this.config.username,
        deviceId: v?.deviceId,
        endpointId: v?.endpointId,
      },
    }));
  }

  private async handleUpdate(update: ControllerUpdatePayload) {
    try {
      const fn = this.subscribers.get(update.context.accessoryId);
      if (fn) update.updates.map((u) => <TydomDataElement>u).forEach(fn);

      return await Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  private doPut(deviceId: string, endpointId: string, updateType: string) {
    return debounce(
      async (value: unknown) => {
        await this.client.put(
          `/devices/${deviceId}/endpoints/${endpointId}/data`,
          [
            {
              name: updateType,
              value,
            },
          ],
        );
      },
      15,
      { leading: true, trailing: true },
    );
  }
}
