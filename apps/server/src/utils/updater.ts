import { SERVER_VERSION } from './env';

class Updater {
  public canUpdate = (): boolean => false;

  public getLatestVersion = async () => SERVER_VERSION;

  public hasUpdates = async () => false;

  public update = async (): Promise<void> => {};
}

const updater = new Updater();

export { updater };
