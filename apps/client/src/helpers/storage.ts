export enum LocalStorageKey {
  IDENTITY = 'mikotord-identity',
  REMEMBER_CREDENTIALS = 'mikotord-remember-identity',
  USER_PASSWORD = 'mikotord-user-password',
  SERVER_PASSWORD = 'mikotord-server-password',
  VITE_UI_THEME = 'vite-ui-theme',
  RECENT_EMOJIS = 'mikotord-recent-emojis',
  DEBUG = 'mikotord-debug',
  DRAFT_MESSAGES = 'mikotord-draft-messages',
  THREAD_SIDEBAR_WIDTH = 'mikotord-thread-sidebar-width',
  LEFT_SIDEBAR_WIDTH = 'mikotord-left-sidebar-width',
  RIGHT_SIDEBAR_WIDTH = 'mikotord-right-sidebar-width',
  CATEGORIES_EXPANDED = 'mikotord-categories-expanded',
  AUTO_LOGIN = 'mikotord-auto-login',
  AUTO_LOGIN_TOKEN = 'mikotord-auto-login-token',
  LAST_SELECTED_CHANNEL = 'mikotord-last-selected-channel',
  AUTO_JOIN_LAST_CHANNEL = 'mikotord-auto-join-last-channel',
  BROWSER_NOTIFICATIONS = 'mikotord-browser-notifications',
  BROWSER_NOTIFICATIONS_FOR_MENTIONS = 'mikotord-browser-notifications-for-mentions',
  BROWSER_NOTIFICATIONS_FOR_DMS = 'mikotord-browser-notifications-for-dms',
  CHAT_INPUT_HEIGHT_VH = 'mikotord-chat-input-height-vh',
  THREAD_INPUT_HEIGHT_VH = 'mikotord-thread-input-height-vh',
  BROWSER_NOTIFICATIONS_FOR_REPLIES = 'mikotord-browser-notifications-for-replies',
  LANGUAGE = 'mikotord-language',
  PLUGIN_SLOT_DEBUG = 'mikotord-plugin-slot-debug'
}

export enum SessionStorageKey {
  TOKEN = 'mikotord-token'
}

const getLocalStorageItem = (key: LocalStorageKey): string | null => {
  return localStorage.getItem(key);
};

const getLocalStorageItemBool = (
  key: LocalStorageKey,
  defaultValue: boolean = false
): boolean => {
  const item = localStorage.getItem(key);

  if (item === null) {
    return defaultValue ?? false;
  }

  return item === 'true';
};

const setLocalStorageItemBool = (
  key: LocalStorageKey,
  value: boolean
): void => {
  localStorage.setItem(key, value.toString());
};

const getLocalStorageItemAsNumber = (
  key: LocalStorageKey,
  defaultValue?: number
): number | undefined => {
  const item = localStorage.getItem(key);

  if (item === null) {
    return defaultValue;
  }

  const parsed = parseInt(item, 10);

  return Number.isNaN(parsed) ? defaultValue : parsed;
};

const getLocalStorageItemAsJSON = <T>(
  key: LocalStorageKey,
  defaultValue: T | undefined = undefined
): T | undefined => {
  const item = localStorage.getItem(key);

  if (item) {
    return JSON.parse(item) as T;
  }

  return defaultValue;
};

const setLocalStorageItemAsJSON = <T>(key: LocalStorageKey, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

const setLocalStorageItem = (key: LocalStorageKey, value: string): void => {
  localStorage.setItem(key, value);
};

const removeLocalStorageItem = (key: LocalStorageKey): void => {
  localStorage.removeItem(key);
};

const getSessionStorageItem = (key: SessionStorageKey): string | null => {
  return sessionStorage.getItem(key);
};

const setSessionStorageItem = (key: SessionStorageKey, value: string): void => {
  sessionStorage.setItem(key, value);
};

const removeSessionStorageItem = (key: SessionStorageKey): void => {
  sessionStorage.removeItem(key);
};

export {
  getLocalStorageItem,
  getLocalStorageItemAsJSON,
  getLocalStorageItemAsNumber,
  getLocalStorageItemBool,
  getSessionStorageItem,
  removeLocalStorageItem,
  removeSessionStorageItem,
  setLocalStorageItem,
  setLocalStorageItemAsJSON,
  setLocalStorageItemBool,
  setSessionStorageItem
};
