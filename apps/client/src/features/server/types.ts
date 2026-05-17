import type { TJoinedMessage } from '@mikotord/shared';

export enum SoundType {
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_SENT = 'message_sent',
  SERVER_DISCONNECTED = 'server_disconnected'
}

export type TMessagesMap = {
  [channelId: number]: TJoinedMessage[];
};

export type TThreadMessagesMap = {
  [parentMessageId: number]: TJoinedMessage[];
};

export type TMessagesPagination = {
  cursor: number | null;
};

export type TDisconnectInfo = {
  code: number;
  reason: string;
  wasClean: boolean;
  time: Date;
};
