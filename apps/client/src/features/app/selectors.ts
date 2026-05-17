import { createSelector } from '@reduxjs/toolkit';
import type { IRootState } from '../store';

export const appLoadingSelector = (state: IRootState) => state.app.appLoading;

export const isAutoConnectingSelector = (state: IRootState) =>
  state.app.isAutoConnecting;

export const modViewOpenSelector = (state: IRootState) => state.app.modViewOpen;

export const modViewUserIdSelector = (state: IRootState) =>
  state.app.modViewUserId;

export const loadingPluginsSelector = (state: IRootState) =>
  state.app.loadingPlugins;

export const threadSidebarOpenSelector = (state: IRootState) =>
  state.app.threadSidebarOpen;

export const threadParentMessageIdSelector = (state: IRootState) =>
  state.app.threadParentMessageId;

export const threadChannelIdSelector = (state: IRootState) =>
  state.app.threadChannelId;

export const autoJoinLastChannelSelector = (state: IRootState) =>
  state.app.autoJoinLastChannel;

export const selectedDmChannelIdSelector = (state: IRootState) =>
  state.app.selectedDmChannelId;

export const browserNotificationsSelector = (state: IRootState) =>
  state.app.browserNotifications;

export const browserNotificationsForMentionsSelector = (state: IRootState) =>
  state.app.browserNotificationsForMentions;

export const browserNotificationsForDmsSelector = (state: IRootState) =>
  state.app.browserNotificationsForDms;

export const browserNotificationsForRepliesSelector = (state: IRootState) =>
  state.app.browserNotificationsForReplies;

export const messageJumpTargetSelector = (state: IRootState) =>
  state.app.messageJumpTarget;

export const pluginSlotDebugSelector = (state: IRootState) =>
  state.app.pluginSlotDebug;

export const claudeCodePanelOpenSelector = (state: IRootState) =>
  state.app.claudeCodePanelOpen;

export const claudeCodeHistoryOpenSelector = (state: IRootState) =>
  state.app.claudeCodeHistoryOpen;

export const claudeCodeTerminalControlSelector = (state: IRootState) =>
  state.app.claudeCodeTerminalControl;

export const threadSidebarDataSelector = createSelector(
  [
    threadSidebarOpenSelector,
    threadParentMessageIdSelector,
    threadChannelIdSelector
  ],
  (isOpen, parentMessageId, channelId) => ({
    isOpen,
    parentMessageId,
    channelId,
    activeThreadMessageId: isOpen ? parentMessageId : undefined
  })
);

export const isShiftHeldSelector = (state: IRootState) =>
  state.app.modifierKeysHeldMap?.Shift ?? false;

export const isCtrlHeldSelector = (state: IRootState) =>
  state.app.modifierKeysHeldMap?.Control ?? false;

export const isAltHeldSelector = (state: IRootState) =>
  state.app.modifierKeysHeldMap?.Alt ?? false;
