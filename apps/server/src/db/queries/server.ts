import type { TJoinedSettings, TPublicServerSettings } from '@mikotord/shared';
import { eq } from 'drizzle-orm';
import { db } from '..';
import { files, settings } from '../schema';

// since this is static, we can keep it in memory to avoid querying the DB every time
let token: string;

const BRAND_PATTERN = /\b(?:sharkord|mikotord)\b/gi;

const sanitizeBrandText = (value: string) =>
  value.replace(BRAND_PATTERN, '').replace(/\s+/g, ' ').trim();

const sanitizeBrandName = (name: string) => sanitizeBrandText(name) || 'Server';

const sanitizeBrandDescription = (description?: string | null) => {
  const value = description ?? '';
  const cleaned = sanitizeBrandText(value);

  if (
    /^this is the default server description\. change me in the server settings!$/i.test(
      cleaned
    )
  ) {
    return '';
  }

  return cleaned;
};

const getSettings = async (): Promise<TJoinedSettings> => {
  const serverSettings = await db.select().from(settings).get();

  if (!serverSettings) {
    throw new Error(
      'Server settings not found in database. Something is wrong.'
    );
  }

  if (!token && serverSettings.secretToken) {
    token = serverSettings.secretToken;
  }

  const logo = serverSettings.logoId
    ? await db
        .select()
        .from(files)
        .where(eq(files.id, serverSettings.logoId))
        .get()
    : undefined;

  return {
    ...serverSettings,
    name: sanitizeBrandName(serverSettings.name),
    description: sanitizeBrandDescription(serverSettings.description),
    logo: logo ?? null
  };
};

const getPublicSettings: () => Promise<TPublicServerSettings> = async () => {
  const settings = await getSettings();

  const publicSettings: TPublicServerSettings = {
    description: settings.description ?? '',
    name: settings.name,
    serverId: settings.serverId,
    storageUploadEnabled: settings.storageUploadEnabled,
    directMessagesEnabled: settings.directMessagesEnabled,
    storageQuota: settings.storageQuota,
    storageUploadMaxFileSize: settings.storageUploadMaxFileSize,
    storageFileSharingInDirectMessages:
      settings.storageFileSharingInDirectMessages,
    storageMaxAvatarSize: settings.storageMaxAvatarSize,
    storageMaxBannerSize: settings.storageMaxBannerSize,
    storageMaxFilesPerMessage: settings.storageMaxFilesPerMessage,
    storageSpaceQuotaByUser: settings.storageSpaceQuotaByUser,
    storageOverflowAction: settings.storageOverflowAction,
    enablePlugins: settings.enablePlugins,
    enableSearch: settings.enableSearch,
    showWelcomeDialog: settings.showWelcomeDialog,
    storageSignedUrlsEnabled: settings.storageSignedUrlsEnabled,
    officeServerUrl: settings.officeServerUrl
  };

  return publicSettings;
};

const getServerTokenSync = (): string => {
  if (!token) {
    throw new Error('Server token has not been initialized yet');
  }

  return token;
};

const getServerToken = async (): Promise<string> => {
  if (token) return token;

  const { secretToken } = await getSettings();

  if (!secretToken) {
    throw new Error('Secret token not found in database settings');
  }

  token = secretToken;

  return token;
};

export { getPublicSettings, getServerToken, getServerTokenSync, getSettings };
