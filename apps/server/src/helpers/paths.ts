import path from 'path';
import { IS_DEVELOPMENT, IS_TEST, SERVER_VERSION } from '../utils/env';
import { getAppDataPath } from './fs';

const getDataPath = (): string => {
  const INJECTED_DATA_PATH = process.env.MIKOTORD_DATA_PATH;

  if (INJECTED_DATA_PATH) {
    return path.resolve(INJECTED_DATA_PATH);
  }

  if (IS_TEST) {
    return path.resolve(process.cwd(), './data-test');
  }

  if (IS_DEVELOPMENT) {
    return path.resolve(process.cwd(), './data');
  }

  return path.join(getAppDataPath(), 'mikotord');
};

const DATA_PATH = getDataPath();
const DB_PATH = path.join(DATA_PATH, 'db.sqlite');
const LOGS_PATH = path.join(DATA_PATH, 'logs');
const PUBLIC_PATH = path.join(DATA_PATH, 'public');
const TMP_PATH = path.join(DATA_PATH, 'tmp');
const UPLOADS_PATH = path.join(DATA_PATH, 'uploads');
const INTERFACE_PATH = path.resolve(DATA_PATH, 'interface', SERVER_VERSION);
const DRIZZLE_PATH = path.resolve(DATA_PATH, 'drizzle');
const CONFIG_INI_PATH = path.resolve(DATA_PATH, 'config.ini');
const PLUGINS_PATH = path.join(DATA_PATH, 'plugins');
const SRC_MIGRATIONS_PATH = path.join(process.cwd(), 'src', 'db', 'migrations');

export {
  CONFIG_INI_PATH,
  DATA_PATH,
  DB_PATH,
  DRIZZLE_PATH,
  INTERFACE_PATH,
  LOGS_PATH,
  PLUGINS_PATH,
  PUBLIC_PATH,
  SRC_MIGRATIONS_PATH,
  TMP_PATH,
  UPLOADS_PATH
};
