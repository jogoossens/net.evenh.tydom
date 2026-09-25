import { Driver } from 'homey';
import TydomController from './controller';
import type Gateways from './gateways';
import { Categories } from './typings';

const READY_TIMEOUT_MS = 25 * 1000;

type PairSession = Parameters<NonNullable<Driver['onPair']>>[0];

const connectedController = async (controller: TydomController) => {
  if (!(await controller.waitUntilReady(READY_TIMEOUT_MS)))
    throw new Error(controller.lastError || 'Could not connect to the gateway');
};

// Pair flow shared by all drivers: the `start` view connects a gateway (button
// press, Tydom app account, or sticker password) and is skipped once one is
// connected; `list_devices` then lists that gateway's devices.
export default function setupPairing(
  driver: Driver,
  session: PairSession,
  category: Categories,
) {
  const { gateways } = driver.homey.app as unknown as { gateways: Gateways };

  session.setHandler('showView', async (viewId: string) => {
    if (viewId === 'start' && TydomController.getInstances().some((c) => c.ready))
      await session.showView('list_devices');
  });

  session.setHandler('status', async () => gateways.status());

  // One attempt; the view repeats it while the user presses the button.
  session.setHandler(
    'button_try',
    async ({ mac, hostname }: { mac: string; hostname: string }) => ({
      paired: await gateways.pairWithButton(mac, hostname),
    }),
  );

  session.setHandler(
    'manual',
    async (entry: { mac: string; hostname: string; password: string }) => {
      await connectedController(gateways.upsert(entry));
      return true;
    },
  );

  session.setHandler(
    'login',
    async ({ username, password }: { username: string; password: string }) => {
      const controllers = await gateways.addFromCloud(username, password, true);
      await Promise.all(controllers.map((c) => c.waitUntilReady(READY_TIMEOUT_MS)));
      if (!controllers.some((c) => c.ready))
        throw new Error(
          controllers.map((c) => c.lastError).find(Boolean) ||
            'Could not connect to your Tydom gateway',
        );
      return true;
    },
  );

  session.setHandler('list_devices', async () => {
    const controllers = TydomController.getInstances();
    if (!controllers.length)
      throw new Error(
        'No Tydom gateway set up yet — go back and connect your gateway first.',
      );
    await Promise.all(controllers.map((c) => c.waitUntilReady(READY_TIMEOUT_MS)));
    const ready = controllers.filter((c) => c.ready);
    if (!ready.length)
      throw new Error(
        controllers.map((c) => c.lastError).find(Boolean) ||
          'Could not connect to your Tydom gateway',
      );
    return ready.flatMap((c) => c.getDevices(category));
  });
}
