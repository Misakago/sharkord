export enum ServerEvents {
  NEW_MESSAGE = 'newMessage',
  MESSAGE_UPDATE = 'messageUpdate',
  MESSAGE_DELETE = 'messageDelete',
  MESSAGE_TYPING = 'messageTyping',
  THREAD_REPLY_COUNT_UPDATE = 'threadReplyCountUpdate',

  USER_JOIN = 'userJoin',
  USER_LEAVE = 'userLeave',

  CHANNEL_CREATE = 'channelCreate',
  CHANNEL_UPDATE = 'channelUpdate',
  CHANNEL_DELETE = 'channelDelete',
  CHANNEL_PERMISSIONS_UPDATE = 'channelPermissionsUpdate',
  CHANNEL_READ_STATES_UPDATE = 'channelReadStatesUpdate',
  CHANNEL_READ_STATES_DELTA = 'channelReadStatesDelta',

  EMOJI_CREATE = 'emojiCreate',
  EMOJI_UPDATE = 'emojiUpdate',
  EMOJI_DELETE = 'emojiDelete',

  ROLE_CREATE = 'roleCreate',
  ROLE_UPDATE = 'roleUpdate',
  ROLE_DELETE = 'roleDelete',

  USER_CREATE = 'userCreate',
  USER_UPDATE = 'userUpdate',
  USER_DELETE = 'userDelete',

  SERVER_SETTINGS_UPDATE = 'serverSettingsUpdate',

  PLUGIN_LOG = 'pluginLog',
  PLUGIN_COMMANDS_CHANGE = 'pluginCommandsChange',
  PLUGIN_COMPONENTS_CHANGE = 'pluginComponentsChange',
  PLUGIN_METADATA_CHANGE = 'pluginMetadataChange',

  CATEGORY_CREATE = 'categoryCreate',
  CATEGORY_UPDATE = 'categoryUpdate',
  CATEGORY_DELETE = 'categoryDelete',

  DM_CONVERSATION_OPEN = 'dmConversationOpen',

  CLAUDE_CODE_STATUS = 'claudeCodeStatus'
}

export type TNewMessage = {
  content: string;
  channelId: number;
};
