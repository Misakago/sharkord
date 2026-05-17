import { assertNotificationsPermission } from '@/helpers/assert-notifications-permission';
import { getFileUrl, getUrlFromServer } from '@/helpers/get-file-url';
import { LocalStorageKey, setLocalStorageItemBool } from '@/helpers/storage';
import type { TMessageJumpToTarget } from '@/types';
import type { TServerInfo } from '@mikotord/shared';
import { toast } from 'sonner';
import { setInfo } from '../server/actions';
import { store } from '../store';
import { pluginSlotDebugSelector } from './selectors';
import { appSliceActions } from './slice';

export const setAppLoading = (loading: boolean) =>
  store.dispatch(appSliceActions.setAppLoading(loading));

export const setIsAutoConnecting = (isAutoConnecting: boolean) =>
  store.dispatch(appSliceActions.setIsAutoConnecting(isAutoConnecting));

export const setPluginsLoading = (loading: boolean) =>
  store.dispatch(appSliceActions.setLoadingPlugins(loading));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const setOrCreateMeta = (name: string, content: string) => {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);

  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }

  el.content = content;
};

const setOrCreateLink = (rel: string, href: string) => {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);

  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }

  el.href = href;
};

const removeLinks = (rel: string) => {
  document
    .querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`)
    .forEach((el) => el.remove());
};

const applyServerBranding = (info: TServerInfo) => {
  document.title = info.name;

  if (info.logo) {
    const logoUrl = getFileUrl(info.logo);

    setOrCreateLink('icon', logoUrl);
    setOrCreateLink('apple-touch-icon', logoUrl);
  } else {
    removeLinks('icon');
    removeLinks('apple-touch-icon');
  }

  setOrCreateMeta('apple-mobile-web-app-title', info.name);
};

export const fetchServerInfo = async ({
  silent = false
}: { silent?: boolean } = {}): Promise<TServerInfo | undefined> => {
  try {
    const url = getUrlFromServer();
    const response = await fetch(`${url}/info`);

    if (!response.ok) {
      throw new Error('Failed to fetch server info');
    }

    const data = await response.json();

    return data;
  } catch (error) {
    if (!silent) {
      console.error('Error fetching server info:', error);
    }
  }
};

export const loadApp = async () => {
  let info = await fetchServerInfo();

  if (!info && import.meta.env.MODE === 'development') {
    console.info('Server is not ready yet. Retrying app load...');

    while (!info) {
      await sleep(500);
      info = await fetchServerInfo({ silent: true });
    }
  }

  if (!info) {
    console.error('Failed to load server info during app load');
    toast.error('Failed to load server info');
    return;
  }

  setInfo(info);
  applyServerBranding(info);
  setAppLoading(false);
};

export const setModViewOpen = (isOpen: boolean, userId?: number) =>
  store.dispatch(
    appSliceActions.setModViewOpen({
      modViewOpen: isOpen,
      userId
    })
  );

export const openThreadSidebar = (parentMessageId: number, channelId: number) =>
  store.dispatch(
    appSliceActions.setThreadSidebarOpen({
      open: true,
      parentMessageId,
      channelId
    })
  );

export const closeThreadSidebar = () =>
  store.dispatch(
    appSliceActions.setThreadSidebarOpen({
      open: false,
      parentMessageId: undefined,
      channelId: undefined
    })
  );

export const openClaudeCodePanel = () =>
  store.dispatch(appSliceActions.setClaudeCodePanelOpen(true));

export const closeClaudeCodePanel = () =>
  store.dispatch(appSliceActions.setClaudeCodePanelOpen(false));

export const openClaudeCodeHistoryPanel = () =>
  store.dispatch(appSliceActions.setClaudeCodeHistoryOpen(true));

export const closeClaudeCodeHistoryPanel = () =>
  store.dispatch(appSliceActions.setClaudeCodeHistoryOpen(false));

export const setClaudeCodeTerminalControl = (enabled: boolean) =>
  store.dispatch(appSliceActions.setClaudeCodeTerminalControl(enabled));

export const resetApp = () => {
  store.dispatch(
    appSliceActions.setModViewOpen({
      modViewOpen: false,
      userId: undefined
    })
  );
  store.dispatch(
    appSliceActions.setThreadSidebarOpen({
      open: false,
      parentMessageId: undefined,
      channelId: undefined
    })
  );
  store.dispatch(appSliceActions.setClaudeCodePanelOpen(false));
  store.dispatch(appSliceActions.setClaudeCodeHistoryOpen(false));
  store.dispatch(appSliceActions.setClaudeCodeTerminalControl(false));
};

export const setAutoJoinLastChannel = (autoJoin: boolean) => {
  store.dispatch(appSliceActions.setAutoJoinLastChannel(autoJoin));

  setLocalStorageItemBool(LocalStorageKey.AUTO_JOIN_LAST_CHANNEL, autoJoin);
};

export const setSelectedDmChannelId = (channelId: number | undefined) =>
  store.dispatch(appSliceActions.setSelectedDmChannelId(channelId));

export const setBrowserNotifications = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotifications(enabled));
  setLocalStorageItemBool(LocalStorageKey.BROWSER_NOTIFICATIONS, enabled);
};

export const setBrowserNotificationsForMentions = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotificationsForMentions(enabled));
  setLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_MENTIONS,
    enabled
  );
};

export const setBrowserNotificationsForDms = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotificationsForDms(enabled));
  setLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_DMS,
    enabled
  );
};

export const setBrowserNotificationsForReplies = async (enabled: boolean) => {
  if (enabled) {
    await assertNotificationsPermission();
  }

  store.dispatch(appSliceActions.setBrowserNotificationsForReplies(enabled));
  setLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_REPLIES,
    enabled
  );
};

export const setMessageJumpTarget = (
  payload: TMessageJumpToTarget | undefined
) => store.dispatch(appSliceActions.setMessageJumpTarget(payload));

export const togglePluginSlotDebug = () => {
  const state = store.getState();
  const current = pluginSlotDebugSelector(state);
  const next = !current;

  store.dispatch(appSliceActions.setPluginSlotDebug(next));
  setLocalStorageItemBool(LocalStorageKey.PLUGIN_SLOT_DEBUG, next);
};

export const setModifierKeysHeldMap = (keysDown: Record<string, boolean>) => {
  store.dispatch(appSliceActions.setModifierKeysHeldMap(keysDown));
};
