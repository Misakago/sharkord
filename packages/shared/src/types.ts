import { ChannelPermission, type TFile, type TSettings, type TUser } from '.';

export enum ChannelType {
  TEXT = 'TEXT'
}

export type TPublicServerSettings = Pick<
  TSettings,
  | 'name'
  | 'description'
  | 'serverId'
  | 'storageUploadEnabled'
  | 'directMessagesEnabled'
  | 'storageQuota'
  | 'storageUploadMaxFileSize'
  | 'storageFileSharingInDirectMessages'
  | 'storageMaxAvatarSize'
  | 'storageMaxBannerSize'
  | 'storageMaxFilesPerMessage'
  | 'storageSpaceQuotaByUser'
  | 'storageOverflowAction'
  | 'enablePlugins'
  | 'enableSearch'
  | 'showWelcomeDialog'
  | 'storageSignedUrlsEnabled'
>;

export type TGenericObject = {
  [key: string]: any;
};

export type TGenericFunction = {
  (...args: any[]): any;
};

export type TMessageMediaMetadata = {
  kind: 'media';
  url: string;
  title?: string;
  description?: string;
  mediaType: 'image';
};

export type TMessageOpenGraphMetadata = {
  kind: 'open_graph';
  url: string;
  title?: string;
  siteName?: string;
  description?: string;
  mediaType: string;
  images?: string[];
  favicons?: string[];
};

export type TClaudeCodeTaskMetadata = {
  kind: 'claude_code_task';
  runId: string;
  status: 'running' | 'waiting_for_user' | 'completed' | 'failed';
};

export type TClaudeCodeAskUserQuestionOption = {
  label: string;
  description?: string;
};

export type TClaudeCodeAskUserQuestion = {
  question: string;
  header: string;
  options: TClaudeCodeAskUserQuestionOption[];
  multiSelect?: boolean;
};

export type TClaudeCodeAskUserQuestionAnswers = Record<string, string | string[]>;

export type TClaudeCodeAskUserQuestionMetadata = {
  kind: 'claude_code_ask_user_question';
  requestId: string;
  runId: string;
  status: 'pending' | 'answered' | 'cancelled' | 'expired';
  questions: TClaudeCodeAskUserQuestion[];
  answers?: TClaudeCodeAskUserQuestionAnswers;
  createdAt: number;
  updatedAt?: number;
  answeredAt?: number;
  cancelledAt?: number;
  expiredAt?: number;
};

export type TMessageMetadata =
  | TMessageMediaMetadata
  | TMessageOpenGraphMetadata
  | TClaudeCodeTaskMetadata
  | TClaudeCodeAskUserQuestionMetadata;

export type TClaudeCodeStatus = {
  state: 'idle' | 'starting' | 'running' | 'waiting_for_user' | 'failed';
  connected: boolean;
  runId?: string;
  channelId?: number;
  messageId?: number;
  lastError?: string;
  updatedAt: number;
};

export type WithOptional<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

export enum UserStatus {
  ONLINE = 'online',
  IDLE = 'idle',
  OFFLINE = 'offline'
}

export type TOwnUser = WithOptional<TUser, 'identity'>;

export type TConnectionParams = {
  token: string;
};

export type TTempFile = {
  id: string;
  originalName: string;
  size: number;
  md5: string;
  path: string;
  extension: string;
  userId: number;
};

export type TServerInfo = Pick<
  TSettings,
  'serverId' | 'name' | 'description' | 'allowNewUsers'
> & {
  logo: TFile | null;
  version: string;
};

export type TWebAppManifest = {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: Array<{
    src: string;
    sizes: string;
    type: string;
    purpose?: string;
  }>;
};

export type TArtifact = {
  name: string;
  target: string;
  size: number;
  checksum: string;
};

export type TVersionInfo = {
  version: string;
  releaseDate: string;
  artifacts: TArtifact[];
};

export type TIpInfo = {
  ip: string;
  hostname: string;
  city: string;
  region: string;
  country: string;
  loc: string;
  org: string;
  postal: string;
  timezone: string;
};

export type TChannelPermissionsMap = Record<ChannelPermission, boolean>;

export type TChannelUserPermissionsMap = Record<
  number,
  { channelId: number; permissions: TChannelPermissionsMap }
>;

export type TReadStateMap = Record<number, number>;

export type TDirectMessageConversation = {
  channelId: number;
  userId: number;
  unreadCount: number;
  lastMessageAt: number;
};
