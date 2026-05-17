// these values are injected at build time
const MIKOTORD_ENV = process.env.MIKOTORD_ENV;
const MIKOTORD_BUILD_VERSION = process.env.MIKOTORD_BUILD_VERSION;
const MIKOTORD_BUILD_DATE = process.env.MIKOTORD_BUILD_DATE;

const SERVER_VERSION =
  typeof MIKOTORD_BUILD_VERSION !== 'undefined'
    ? MIKOTORD_BUILD_VERSION
    : '0.0.0-dev';

const BUILD_DATE =
  typeof MIKOTORD_BUILD_DATE !== 'undefined' ? MIKOTORD_BUILD_DATE : 'dev';

const env = typeof MIKOTORD_ENV !== 'undefined' ? MIKOTORD_ENV : 'development';
const IS_PRODUCTION = env === 'production';
const IS_DEVELOPMENT = !IS_PRODUCTION;
const IS_TEST = process.env.NODE_ENV === 'test';
const IS_E2E = process.env.IS_E2E === 'true';
const IS_DOCKER = process.env.RUNNING_IN_DOCKER === 'true';

export {
  BUILD_DATE,
  IS_DEVELOPMENT,
  IS_DOCKER,
  IS_E2E,
  IS_PRODUCTION,
  IS_TEST,
  SERVER_VERSION
};
