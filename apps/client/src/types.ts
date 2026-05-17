export type TMessageJumpToTarget = {
  channelId: number;
  messageId: number;
  isDm: boolean;
  threadParentMessageId?: number | null;
  fileId?: number;
  highlightTime?: number;
};

export type TReplyTarget = {
  userId: number | null;
  pluginId: string | null;
};
