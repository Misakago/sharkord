import { getLocalStorageItemBool, LocalStorageKey } from '@/helpers/storage';
import type { TMessageJumpToTarget } from '@/types';
import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface TAppState {
  appLoading: boolean;
  isAutoConnecting: boolean;
  loadingPlugins: boolean;
  modViewOpen: boolean;
  modViewUserId: number | undefined;
  threadSidebarOpen: boolean;
  threadParentMessageId: number | undefined;
  threadChannelId: number | undefined;
  autoJoinLastChannel: boolean;
  selectedDmChannelId: number | undefined;
  browserNotifications: boolean;
  browserNotificationsForMentions: boolean;
  browserNotificationsForDms: boolean;
  browserNotificationsForReplies: boolean;
  messageJumpTarget: TMessageJumpToTarget | undefined;
  pluginSlotDebug: boolean;
  modifierKeysHeldMap: Record<string, boolean>;
  claudeCodePanelOpen: boolean;
  claudeCodeHistoryOpen: boolean;
  claudeCodeTerminalControl: boolean;
}

const initialState: TAppState = {
  appLoading: true,
  isAutoConnecting: false,
  loadingPlugins: true,
  modViewOpen: false,
  modViewUserId: undefined,
  threadSidebarOpen: false,
  threadParentMessageId: undefined,
  threadChannelId: undefined,
  autoJoinLastChannel: getLocalStorageItemBool(
    LocalStorageKey.AUTO_JOIN_LAST_CHANNEL,
    false
  ),
  selectedDmChannelId: undefined,
  browserNotifications: getLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS,
    false
  ),
  browserNotificationsForMentions: getLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_MENTIONS,
    false
  ),
  browserNotificationsForDms: getLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_DMS,
    false
  ),
  browserNotificationsForReplies: getLocalStorageItemBool(
    LocalStorageKey.BROWSER_NOTIFICATIONS_FOR_REPLIES,
    false
  ),
  messageJumpTarget: undefined,
  pluginSlotDebug: getLocalStorageItemBool(
    LocalStorageKey.PLUGIN_SLOT_DEBUG,
    false
  ),
  modifierKeysHeldMap: { Shift: false, Control: false, Alt: false },
  claudeCodePanelOpen: false,
  claudeCodeHistoryOpen: false,
  claudeCodeTerminalControl: false
};

export const appSlice = createSlice({
  name: 'app',
  initialState,
  reducers: {
    setAppLoading: (state, action: PayloadAction<boolean>) => {
      state.appLoading = action.payload;
    },
    setLoadingPlugins: (state, action: PayloadAction<boolean>) => {
      state.loadingPlugins = action.payload;
    },
    setModViewOpen: (
      state,
      action: PayloadAction<{
        modViewOpen: boolean;
        userId?: number;
      }>
    ) => {
      state.modViewOpen = action.payload.modViewOpen;
      state.modViewUserId = action.payload.userId;
    },
    setThreadSidebarOpen: (
      state,
      action: PayloadAction<{
        open: boolean;
        parentMessageId?: number;
        channelId?: number;
      }>
    ) => {
      state.threadSidebarOpen = action.payload.open;
      state.threadParentMessageId = action.payload.parentMessageId;
      state.threadChannelId = action.payload.channelId;
    },
    setAutoJoinLastChannel: (state, action: PayloadAction<boolean>) => {
      state.autoJoinLastChannel = action.payload;
    },
    setIsAutoConnecting: (state, action: PayloadAction<boolean>) => {
      state.isAutoConnecting = action.payload;
    },
    setSelectedDmChannelId: (
      state,
      action: PayloadAction<number | undefined>
    ) => {
      state.selectedDmChannelId = action.payload;
    },
    setBrowserNotifications: (state, action: PayloadAction<boolean>) => {
      state.browserNotifications = action.payload;
    },
    setBrowserNotificationsForMentions: (
      state,
      action: PayloadAction<boolean>
    ) => {
      state.browserNotificationsForMentions = action.payload;
    },
    setBrowserNotificationsForDms: (state, action: PayloadAction<boolean>) => {
      state.browserNotificationsForDms = action.payload;
    },
    setBrowserNotificationsForReplies: (
      state,
      action: PayloadAction<boolean>
    ) => {
      state.browserNotificationsForReplies = action.payload;
    },
    setMessageJumpTarget: (
      state,
      action: PayloadAction<TMessageJumpToTarget | undefined>
    ) => {
      state.messageJumpTarget = action.payload;
    },
    setPluginSlotDebug: (state, action: PayloadAction<boolean>) => {
      state.pluginSlotDebug = action.payload;
    },
    setModifierKeysHeldMap: (
      state,
      action: PayloadAction<Record<string, boolean>>
    ) => {
      state.modifierKeysHeldMap = action.payload;
    },
    setClaudeCodePanelOpen: (state, action: PayloadAction<boolean>) => {
      state.claudeCodePanelOpen = action.payload;
    },
    setClaudeCodeHistoryOpen: (state, action: PayloadAction<boolean>) => {
      state.claudeCodeHistoryOpen = action.payload;
    },
    setClaudeCodeTerminalControl: (state, action: PayloadAction<boolean>) => {
      state.claudeCodeTerminalControl = action.payload;
    }
  }
});

const appSliceActions = appSlice.actions;
const appSliceReducer = appSlice.reducer;

export { appSliceActions, appSliceReducer };
