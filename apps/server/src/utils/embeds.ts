import { getErrorMessage } from '@mikotord/shared';
import { embeddedFiles } from 'bun';
import fs from 'fs/promises';
import path from 'path';
import {
  DRIZZLE_PATH,
  INTERFACE_PATH,
  SRC_MIGRATIONS_PATH
} from '../helpers/paths';
import { unzipBlobToDirectory } from '../helpers/zip';
import { logger } from '../logger';
import { IS_DEVELOPMENT, IS_TEST } from '../utils/env';

const findEmbedFile = (fileName: string) => {
  const extension = path.extname(fileName);
  const prefix = fileName.replace(extension, '');

  return embeddedFiles.find((file) => {
    // for some reason this blob doesn't have a name but it works and it's in the documentation
    // https://bun.com/docs/bundler/executables#listing-embedded-files
    const fileName = (file as File).name;

    return fileName.startsWith(prefix) && fileName.endsWith(extension);
  });
};

const loadEmbeds = async () => {
  logger.debug('Loading embedded files...');

  if (IS_DEVELOPMENT || IS_TEST) {
    // files are only embedded in production
    logger.debug('Development mode, skipping embedded files extraction');

    // copy migrations from src/db/migrations to DRIZZLE_PATH to allow running migrations in development
    await fs.cp(SRC_MIGRATIONS_PATH, DRIZZLE_PATH, { recursive: true });

    return;
  }

  const interfaceBlob = findEmbedFile('interface.zip');
  const drizzleBlob = findEmbedFile('drizzle.zip');

  if (!interfaceBlob || !drizzleBlob) {
    throw new Error('Embedded files not found');
  }

  try {
    logger.debug('Extracting interface...');

    await unzipBlobToDirectory(interfaceBlob, INTERFACE_PATH);
  } catch (error) {
    logger.error('Failed to extract interface: %s', getErrorMessage(error));
    process.exit(1);
  }

  try {
    logger.debug('Extracting drizzle migrations...');

    await unzipBlobToDirectory(drizzleBlob, DRIZZLE_PATH);
  } catch (error) {
    logger.error(
      'Failed to extract drizzle migrations: %s',
      getErrorMessage(error)
    );
    process.exit(1);
  }

};

export { loadEmbeds };
