import {
  ChannelPermission,
  ChannelType,
  FileSaveType,
  ServerEvents,
  getErrorMessage,
  getPlainTextFromHtml,
  hasMention,
  type TClaudeCodeAskUserQuestion,
  type TClaudeCodeAskUserQuestionAnswers,
  type TClaudeCodeAskUserQuestionMetadata,
  type TClaudeCodeStatus,
  type TFile,
  type TJoinedMessage,
  type TMessageMetadata
} from '@mikotord/shared';
import { randomUUIDv7 } from 'bun';
import { spawn as spawnChildProcess } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from '../config';
import { db } from '../db';
import {
  publishChannelPermissions,
  publishMessage,
  publishUser
} from '../db/publishers';
import { channelUserCan } from '../db/queries/channels';
import {
  getDirectMessageChannel,
  getDirectMessageChannelParticipantIds,
  isDirectMessageChannel,
  normalizePair
} from '../db/queries/dms';
import { getMessage, joinMessagesWithRelations } from '../db/queries/messages';
import { getUserByIdentity, getUserByToken } from '../db/queries/users';
import {
  channels,
  createMessageBusinessId,
  directMessages,
  files,
  messageFiles,
  messages,
  users
} from '../db/schema';
import { DATA_PATH, INTERFACE_PATH, PUBLIC_PATH } from '../helpers/paths';
import { logger } from '../logger';
import { fileManager } from '../utils/file-manager';
import { pubsub } from '../utils/pubsub';

type TPty = {
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onData: (handler: (data: string) => void) => void;
  onExit: (
    handler: (event: { exitCode: number; signal?: number | string }) => void
  ) => void;
  kill: () => void;
};

type TClaudeCodeDmScope = {
  kind: 'dm';
  key: string;
  storageKey: string;
  userId: number;
};

type TClaudeCodeChannelScope = {
  kind: 'channel';
  key: string;
  storageKey: string;
  channelId: number;
};

type TClaudeCodeSessionScope = TClaudeCodeDmScope | TClaudeCodeChannelScope;

type TClaudeCodeSession = {
  scope: TClaudeCodeSessionScope;
  pty?: TPty;
  clients: Set<WebSocket>;
  askUserQuestionRequests: Map<string, TPendingAskUserQuestionRequest>;
  hookToken: string;
  settingsPath: string;
  output: string;
  starting?: Promise<void>;
  runId?: string;
  channelId?: number;
  messageId?: number;
  chatSessionId?: string;
  claudeSessionId?: string;
  readyMarkedChatSessionId?: string;
  lastInjectedMessageDbId?: number;
  pendingGroupTriggerMessageId?: number;
  bracketedPasteMode?: boolean;
  shouldResumeClaudeSession?: boolean;
  stopping?: boolean;
  recoveringMissingClaudeSession?: boolean;
  status: TClaudeCodeStatus;
};

type TClaudeCodeChatSessionRecord = {
  id: string;
  claudeSessionId: string;
  createdAt: number;
  updatedAt: number;
  readyAt?: number;
};

type TClaudeCodeSessionStateRecord = {
  chatSessionId?: string;
  claudeSessionId?: string;
  sessionId?: string;
  createdAt?: number;
  updatedAt?: number;
  readyAt?: number;
  lastInjectedMessageDbId?: number;
};

type TClaudeCodeMessageSnapshot = {
  messages: (typeof messages.$inferSelect)[];
  messageFiles: (typeof messageFiles.$inferSelect)[];
};

type TStopHookInput = {
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  transcript_path?: string;
};

type TStopHookResponse = {
  suppressOutput: boolean;
  systemMessage?: string;
};

type TAskUserQuestionHookInput = {
  tool_name?: string;
  tool_input?: {
    questions?: unknown;
  };
};

type TAskUserQuestionHookResponse = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
    updatedInput?: {
      questions: TClaudeCodeAskUserQuestion[];
      answers: TClaudeCodeAskUserQuestionAnswers;
    };
  };
};

type TPendingAskUserQuestionRequest = {
  requestId: string;
  scope: TClaudeCodeSessionScope;
  runId: string;
  channelId: number;
  messageId: number;
  questions: TClaudeCodeAskUserQuestion[];
  timeout: ReturnType<typeof setTimeout>;
  resolve: (response: TAskUserQuestionHookResponse) => void;
};

const CLAUDE_CODE_AGENT_IDENTITY = 'agent:claude-code';
const CLAUDE_CODE_AGENT_NAME = 'ClaudeCode';
const CLAUDE_CODE_AVATAR_ORIGINAL_NAME = 'claude-code-avatar.png';
const CLAUDE_CODE_AVATAR_MIME_TYPE = 'image/png';
const CLAUDE_CODE_PTY_PATH = '/claude-code/pty';
const CLAUDE_CODE_STOP_HOOK_PATH = '/claude-code/hooks/stop';
const CLAUDE_CODE_ASK_USER_QUESTION_HOOK_PATH =
  '/claude-code/hooks/ask-user-question';
const CLAUDE_CODE_MESSAGE_LOOKUP_PATH = '/claude-code/messages';
const CLAUDE_CODE_COMMAND =
  process.env.CLAUDE_CODE_COMMAND || '/Users/xy/.local/bin/claude';
const CLAUDE_CODE_NODE_COMMAND =
  process.env.CLAUDE_CODE_NODE_COMMAND || '/opt/homebrew/bin/node';
const MAX_OUTPUT_BUFFER = 200_000;
const ASK_USER_QUESTION_HOOK_TIMEOUT_SECONDS = 1800;
const ASK_USER_QUESTION_TIMEOUT_MS =
  (ASK_USER_QUESTION_HOOK_TIMEOUT_SECONDS - 10) * 1000;

const getWorkspaceRoot = () => {
  const cwd = process.cwd();

  if (
    path.basename(cwd) === 'server' &&
    path.basename(path.dirname(cwd)) === 'apps'
  ) {
    return path.resolve(cwd, '../..');
  }

  return cwd;
};

const WORKSPACE_ROOT = getWorkspaceRoot();
const PTY_HELPER_PATH = fileURLToPath(
  new URL('./claude-code-pty-helper.mjs', import.meta.url)
);
const CLAUDE_CODE_AVATAR_SOURCE_PATHS = [
  path.resolve(
    import.meta.dir,
    '..',
    '..',
    '..',
    'client',
    'public',
    'claude-code',
    CLAUDE_CODE_AVATAR_ORIGINAL_NAME
  ),
  path.resolve(
    process.cwd(),
    '..',
    'client',
    'public',
    'claude-code',
    CLAUDE_CODE_AVATAR_ORIGINAL_NAME
  ),
  path.join(INTERFACE_PATH, 'claude-code', CLAUDE_CODE_AVATAR_ORIGINAL_NAME)
];
const createDmScope = (userId: number): TClaudeCodeDmScope => ({
  kind: 'dm',
  key: `dm:${userId}`,
  storageKey: String(userId),
  userId
});
const createChannelScope = (channelId: number): TClaudeCodeChannelScope => ({
  kind: 'channel',
  key: `channel:${channelId}`,
  storageKey: `channel-${channelId}`,
  channelId
});
const getClaudeSessionPath = (storageKey: string) =>
  path.join(DATA_PATH, 'claude-code', `${storageKey}.session.json`);
const getClaudeChatSessionsPath = (storageKey: string) =>
  path.join(DATA_PATH, 'claude-code', `${storageKey}.chat-sessions.json`);
const getClaudeChatSessionMessagesPath = (
  storageKey: string,
  chatSessionId: string
) =>
  path.join(
    DATA_PATH,
    'claude-code',
    `${storageKey}.${chatSessionId}.messages.json`
  );
const getClaudeProjectPath = () =>
  path.join(
    process.env.HOME ?? '/Users/xy',
    '.claude',
    'projects',
    WORKSPACE_ROOT.replace(/\//g, '-')
  );

const getClaudePath = () => {
  const pathEntries = [
    path.dirname(CLAUDE_CODE_COMMAND),
    process.env.PATH,
    '/Users/xy/.local/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/bin',
    '/usr/bin',
    '/sbin',
    '/usr/sbin'
  ]
    .filter(Boolean)
    .join(':');

  return pathEntries;
};

const isClaudeSessionAvailable = async (sessionId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false;

  const sessionFile = path.join(getClaudeProjectPath(), `${sessionId}.jsonl`);

  return Boolean(await fs.stat(sessionFile).catch(() => undefined));
};

const deleteClaudeSessionFile = async (sessionId: string) => {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return;

  await fs.rm(path.join(getClaudeProjectPath(), `${sessionId}.jsonl`), {
    force: true
  });
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toMessageHtml = (value: string) => {
  const text = value.trim() || '已完成。';

  return `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
};

const toClaudeCodeMarkdownMessageHtml = (value: string) => {
  const text = value.trim() || '已完成。';

  return `<pre data-claude-code-markdown="true">${escapeHtml(text)}</pre>`;
};

const formatClaudeMessageTime = (timestamp: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(timestamp));

const sendJson = (ws: WebSocket, payload: unknown) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPathInside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);

  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

const normalizeAskUserQuestions = (
  input: TAskUserQuestionHookInput
): TClaudeCodeAskUserQuestion[] => {
  const rawQuestions = input.tool_input?.questions;

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    throw new Error('AskUserQuestion hook input is missing questions');
  }

  if (rawQuestions.length > 4) {
    throw new Error('AskUserQuestion supports at most four questions');
  }

  return rawQuestions.map((rawQuestion, questionIndex) => {
    if (!isRecord(rawQuestion)) {
      throw new Error(
        `AskUserQuestion question ${questionIndex + 1} is invalid`
      );
    }

    const { question, header, options, multiSelect } = rawQuestion;

    if (typeof question !== 'string' || !question.trim()) {
      throw new Error(
        `AskUserQuestion question ${questionIndex + 1} has no text`
      );
    }

    if (typeof header !== 'string' || !header.trim()) {
      throw new Error(
        `AskUserQuestion question ${questionIndex + 1} has no header`
      );
    }

    if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
      throw new Error(
        `AskUserQuestion question ${questionIndex + 1} must have 2-4 options`
      );
    }

    return {
      question,
      header,
      options: options.map((rawOption, optionIndex) => {
        if (!isRecord(rawOption)) {
          throw new Error(
            `AskUserQuestion option ${optionIndex + 1} for question ${questionIndex + 1} is invalid`
          );
        }

        const label = rawOption.label;
        const description = rawOption.description;

        if (typeof label !== 'string' || !label.trim()) {
          throw new Error(
            `AskUserQuestion option ${optionIndex + 1} for question ${questionIndex + 1} has no label`
          );
        }

        return {
          label,
          ...(typeof description === 'string' ? { description } : {})
        };
      }),
      ...(typeof multiSelect === 'boolean' ? { multiSelect } : {})
    };
  });
};

const buildAskUserQuestionAllowResponse = (
  questions: TClaudeCodeAskUserQuestion[],
  answers: TClaudeCodeAskUserQuestionAnswers
): TAskUserQuestionHookResponse => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'Answered through the Sharkord chat UI.',
    updatedInput: {
      questions,
      answers
    }
  }
});

const buildAskUserQuestionDenyResponse = (
  reason: string
): TAskUserQuestionHookResponse => ({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }
});

const getStatus = (session: TClaudeCodeSession): TClaudeCodeStatus => ({
  ...session.status,
  connected: session.clients.size > 0,
  runId: session.runId,
  channelId: session.channelId,
  messageId: session.messageId,
  updatedAt: Date.now()
});

const splitFilesMarker = (message: string) => {
  const files: string[] = [];
  const summary = message
    .replace(/@files\(([^)]*)\)/g, (_match, body: string) => {
      body
        .split(',')
        .map((item) => item.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean)
        .forEach((item) => files.push(item));

      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { summary, files };
};

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const CLEAR_CURRENT_TTY_INPUT = '\x1b\x15\x15';
const SUBMIT_CURRENT_TTY_INPUT = '\r';

const normalizePtyInputLineEndings = (value: string) =>
  value.replace(/\r\n?/g, '\n');

const toPtyPastePayload = (
  rawText: string,
  options: { bracketedPaste: boolean }
) => {
  const text = normalizePtyInputLineEndings(rawText);

  if (options.bracketedPaste) {
    return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
  }

  return text;
};

const createNodePtyHelper = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; cols: number; rows: number }
): TPty => {
  const payload = Buffer.from(
    JSON.stringify({
      command,
      args,
      cwd: options.cwd,
      env: options.env,
      cols: options.cols,
      rows: options.rows
    })
  ).toString('base64');
  const child = spawnChildProcess(
    CLAUDE_CODE_NODE_COMMAND,
    [PTY_HELPER_PATH, payload],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );
  const dataHandlers = new Set<(data: string) => void>();
  const exitHandlers = new Set<
    (event: { exitCode: number; signal?: number | string }) => void
  >();
  let stdoutBuffer = '';
  let didExit = false;
  const emitData = (text: string) => {
    for (const handler of dataHandlers) {
      handler(text);
    }
  };
  const emitExit = (event: { exitCode: number; signal?: number | string }) => {
    if (didExit) {
      return;
    }

    didExit = true;

    for (const handler of exitHandlers) {
      handler(event);
    }
  };
  const onStdout = (data: Buffer) => {
    stdoutBuffer += data.toString();

    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as
          | { type: 'output'; data: string }
          | { type: 'exit'; exitCode: number; signal?: number | string };

        if (message.type === 'output') {
          emitData(message.data);
        } else if (message.type === 'exit') {
          emitExit({
            exitCode: message.exitCode,
            signal: message.signal
          });
        }
      } catch {
        emitData(`${line}\r\n`);
      }
    }
  };
  const onStderr = (data: Buffer) => {
    emitData(`[ClaudeCode helper stderr] ${data.toString()}`);
  };

  child.stdout?.on('data', onStdout);
  child.stderr?.on('data', onStderr);
  child.on('error', (error) => {
    emitData(`[ClaudeCode helper spawn error] ${getErrorMessage(error)}\r\n`);
    emitExit({ exitCode: 1 });
  });
  child.on('exit', (code, signal) => {
    if (stdoutBuffer.trim()) {
      onStdout(Buffer.from('\n'));
    }

    emitExit({
      exitCode: code ?? 1,
      signal: signal ?? undefined
    });
  });

  return {
    write: (data) => {
      child.stdin?.write(JSON.stringify({ type: 'input', data }) + '\n');
    },
    resize: (cols, rows) => {
      child.stdin?.write(JSON.stringify({ type: 'resize', cols, rows }) + '\n');
    },
    onData: (handler) => {
      dataHandlers.add(handler);
    },
    onExit: (handler) => {
      exitHandlers.add(handler);
    },
    kill: () => {
      child.stdin?.write(JSON.stringify({ type: 'kill' }) + '\n');
      child.kill();
    }
  };
};

class ClaudeCodeAgentManager {
  private sessions = new Map<string, TClaudeCodeSession>();
  private agentUserId: number | undefined;

  public getAgentIdentity = () => CLAUDE_CODE_AGENT_IDENTITY;

  public getAgentName = () => CLAUDE_CODE_AGENT_NAME;

  public getPtyPath = () => CLAUDE_CODE_PTY_PATH;

  private readAgentAvatar = async () => {
    for (const avatarPath of CLAUDE_CODE_AVATAR_SOURCE_PATHS) {
      try {
        return await fs.readFile(avatarPath);
      } catch {
        // Try the next runtime location.
      }
    }

    throw new Error('ClaudeCode avatar image not found');
  };

  private ensureAgentAvatar = async (userId: number) => {
    const avatar = await this.readAgentAvatar();
    const md5 = createHash('md5').update(avatar).digest('hex');
    const name = `system-agent-claude-code-avatar-${md5.slice(0, 12)}.png`;
    const avatarPath = path.join(PUBLIC_PATH, name);

    await fs.mkdir(PUBLIC_PATH, { recursive: true });
    await fs.writeFile(avatarPath, avatar);

    const existing = await db
      .select()
      .from(files)
      .where(eq(files.name, name))
      .get();

    if (existing) {
      if (
        existing.userId !== userId ||
        existing.originalName !== CLAUDE_CODE_AVATAR_ORIGINAL_NAME ||
        existing.md5 !== md5 ||
        existing.size !== avatar.length ||
        existing.mimeType !== CLAUDE_CODE_AVATAR_MIME_TYPE ||
        existing.extension !== '.png'
      ) {
        await db
          .update(files)
          .set({
            userId,
            originalName: CLAUDE_CODE_AVATAR_ORIGINAL_NAME,
            md5,
            size: avatar.length,
            mimeType: CLAUDE_CODE_AVATAR_MIME_TYPE,
            extension: '.png',
            updatedAt: Date.now()
          })
          .where(eq(files.id, existing.id));
      }

      return existing.id;
    }

    const inserted = await db
      .insert(files)
      .values({
        name,
        originalName: CLAUDE_CODE_AVATAR_ORIGINAL_NAME,
        md5,
        userId,
        size: avatar.length,
        mimeType: CLAUDE_CODE_AVATAR_MIME_TYPE,
        extension: '.png',
        createdAt: Date.now()
      })
      .returning({ id: files.id })
      .get();

    return inserted.id;
  };

  public ensureAgentUser = async () => {
    if (this.agentUserId) return this.agentUserId;

    const existing = await getUserByIdentity(CLAUDE_CODE_AGENT_IDENTITY);

    if (existing) {
      this.agentUserId = existing.id;
      const avatarId = await this.ensureAgentAvatar(existing.id);

      if (
        existing.name !== CLAUDE_CODE_AGENT_NAME ||
        existing.banned ||
        existing.avatarId !== avatarId
      ) {
        await db
          .update(users)
          .set({
            name: CLAUDE_CODE_AGENT_NAME,
            banned: false,
            avatarId,
            updatedAt: Date.now()
          })
          .where(eq(users.id, existing.id));

        await publishUser(existing.id, 'update');
      }

      return existing.id;
    }

    const password = await Bun.password.hash(randomUUIDv7());
    const now = Date.now();

    const user = await db
      .insert(users)
      .values({
        identity: CLAUDE_CODE_AGENT_IDENTITY,
        name: CLAUDE_CODE_AGENT_NAME,
        password,
        avatarId: null,
        bannerId: null,
        bio: 'Local Claude Code agent',
        bannerColor:
          'linear-gradient(135deg, rgba(34,197,94,0.9), rgba(14,165,233,0.9))',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();

    const avatarId = await this.ensureAgentAvatar(user.id);

    await db
      .update(users)
      .set({
        avatarId,
        updatedAt: Date.now()
      })
      .where(eq(users.id, user.id));

    this.agentUserId = user.id;

    return user.id;
  };

  public getStatusForUser = async (
    userId: number
  ): Promise<TClaudeCodeStatus> => {
    const session = this.sessions.get(createDmScope(userId).key);

    if (!session) {
      return {
        state: 'idle',
        connected: false,
        updatedAt: Date.now()
      };
    }

    return getStatus(session);
  };

  public openDirectMessage = async (userId: number) => {
    const agentUserId = await this.ensureAgentUser();
    const [userOneId, userTwoId] = normalizePair(userId, agentUserId);
    const existing = await getDirectMessageChannel(userOneId, userTwoId);

    if (existing) {
      return { channelId: existing.channelId, userId: agentUserId };
    }

    const now = Date.now();

    const channel = await db.transaction(async (tx) => {
      const newChannel = await tx
        .insert(channels)
        .values({
          type: ChannelType.TEXT,
          name: `DM - ${userId}:${agentUserId}`,
          topic: null,
          private: true,
          isDm: true,
          position: 0,
          categoryId: null,
          createdAt: now
        })
        .returning()
        .get();

      await tx.insert(directMessages).values({
        channelId: newChannel.id,
        userOneId,
        userTwoId,
        createdAt: now
      });

      return newChannel;
    });

    pubsub.publishFor(
      [userId, agentUserId],
      ServerEvents.CHANNEL_CREATE,
      channel
    );
    pubsub.publishFor(
      [userId, agentUserId],
      ServerEvents.DM_CONVERSATION_OPEN,
      {
        channelId: channel.id
      }
    );

    await publishChannelPermissions([userId, agentUserId]);

    return { channelId: channel.id, userId: agentUserId };
  };

  public getDirectMessageForUser = async (userId: number) => {
    const agentUserId = await this.ensureAgentUser();
    const [userOneId, userTwoId] = normalizePair(userId, agentUserId);
    const existing = await getDirectMessageChannel(userOneId, userTwoId);

    return { channelId: existing?.channelId, userId: agentUserId };
  };

  private publishStatus = (session: TClaudeCodeSession) => {
    session.status = getStatus(session);

    if (session.scope.kind === 'dm') {
      pubsub.publishFor(
        session.scope.userId,
        ServerEvents.CLAUDE_CODE_STATUS,
        session.status
      );
    }

    for (const client of session.clients) {
      sendJson(client, { type: 'status', status: session.status });
    }
  };

  private getSessionByHookToken = (token: string) =>
    Array.from(this.sessions.values()).find((item) => item.hookToken === token);

  private getSessionForScope = (scope: TClaudeCodeSessionScope) => {
    let session = this.sessions.get(scope.key);

    if (!session) {
      const hookToken = randomUUIDv7();
      const settingsPath = path.join(
        DATA_PATH,
        'claude-code',
        `${scope.storageKey}.settings.json`
      );

      session = {
        scope,
        hookToken,
        settingsPath,
        clients: new Set(),
        askUserQuestionRequests: new Map(),
        output: '',
        status: {
          state: 'idle',
          connected: false,
          updatedAt: Date.now()
        }
      };

      this.sessions.set(scope.key, session);
    }

    return session;
  };

  private getSession = (userId: number) =>
    this.getSessionForScope(createDmScope(userId));

  private buildSettings = (session: TClaudeCodeSession) => ({
    hooks: {
      PreToolUse: [
        {
          matcher: 'AskUserQuestion',
          hooks: [
            {
              type: 'http',
              url: `http://127.0.0.1:${config.server.port}${CLAUDE_CODE_ASK_USER_QUESTION_HOOK_PATH}?token=${session.hookToken}`,
              timeout: ASK_USER_QUESTION_HOOK_TIMEOUT_SECONDS,
              statusMessage: '等待聊天室回答 ClaudeCode 问题'
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'http',
              url: `http://127.0.0.1:${config.server.port}${CLAUDE_CODE_STOP_HOOK_PATH}?token=${session.hookToken}`,
              timeout: 60
            }
          ]
        }
      ]
    }
  });

  private getSystemPrompt = (session: TClaudeCodeSession) => {
    const scopePrompt =
      session.scope.kind === 'dm'
        ? `当前私聊用户 ID: ${session.scope.userId}。这是稳定上下文，不需要用户每条消息重复提供。`
        : [
            `当前群聊频道 ID: ${session.scope.channelId}。`,
            '注入内容可能包含多位用户的消息；必须使用每条消息的 user_id 区分发送者、引用关系和指令归属。'
          ].join('\n');

    return [
      '你是聊天室内置的 ClaudeCode Agent。',
      scopePrompt,
      'TTY stdin 注入内容是结构化聊天室消息批次；不要把字段名、id 或时间戳当作需要复述的正文。',
      `如需消息时间、附件路径、发送者等详细信息，使用本地接口查询: curl -s "http://127.0.0.1:${config.server.port}${CLAUDE_CODE_MESSAGE_LOOKUP_PATH}/<id>?token=${session.hookToken}"。`,
      'message_id 是当前 ClaudeCode 聊天室会话内的业务消息 ID，不是数据库自增主键；不要猜测、递增或跨会话复用。',
      '优先遵循项目 CLAUDE.md 中的 Agent 行为约束。',
      '完成后只输出简洁 Markdown 回复；如果有输出产物，在最终回复末尾追加 @files(path1,path2)，只列真实存在的文件路径。',
      '不要把长篇日志、过程推理或无关命令输出放进最终回复。'
    ].join('\n');
  };

  private getMessageMetadata = async (messageId: number) => {
    const row = await db
      .select({ metadata: messages.metadata })
      .from(messages)
      .where(eq(messages.id, messageId))
      .get();

    return row?.metadata ?? [];
  };

  private withClaudeCodeTaskMetadata = (
    metadata: TMessageMetadata[],
    runId: string,
    status: 'running' | 'waiting_for_user' | 'completed' | 'failed'
  ): TMessageMetadata[] => [
    ...metadata.filter((item) => item?.kind !== 'claude_code_task'),
    {
      kind: 'claude_code_task',
      runId,
      status
    }
  ];

  private updateMessageMetadata = async (
    messageId: number,
    channelId: number,
    metadata: TMessageMetadata[]
  ) => {
    await db
      .update(messages)
      .set({
        metadata,
        updatedAt: Date.now()
      })
      .where(eq(messages.id, messageId));

    await publishMessage(messageId, channelId, 'update');
  };

  private addAskUserQuestionMetadata = async (
    pending: Omit<TPendingAskUserQuestionRequest, 'timeout' | 'resolve'>
  ) => {
    const metadata = await this.getMessageMetadata(pending.messageId);
    const now = Date.now();
    const askMetadata: TClaudeCodeAskUserQuestionMetadata = {
      kind: 'claude_code_ask_user_question',
      requestId: pending.requestId,
      runId: pending.runId,
      status: 'pending',
      questions: pending.questions,
      createdAt: now,
      updatedAt: now
    };

    await this.updateMessageMetadata(
      pending.messageId,
      pending.channelId,
      this.withClaudeCodeTaskMetadata(
        [...metadata, askMetadata],
        pending.runId,
        'waiting_for_user'
      )
    );
  };

  private updateAskUserQuestionMetadata = async (
    pending: TPendingAskUserQuestionRequest,
    status: TClaudeCodeAskUserQuestionMetadata['status'],
    answers?: TClaudeCodeAskUserQuestionAnswers
  ) => {
    const metadata = await this.getMessageMetadata(pending.messageId);
    const now = Date.now();
    const nextMetadata = metadata.map((item) => {
      if (
        item?.kind !== 'claude_code_ask_user_question' ||
        item.requestId !== pending.requestId
      ) {
        return item;
      }

      return {
        ...item,
        status,
        ...(answers ? { answers } : {}),
        updatedAt: now,
        ...(status === 'answered' ? { answeredAt: now } : {}),
        ...(status === 'cancelled' ? { cancelledAt: now } : {}),
        ...(status === 'expired' ? { expiredAt: now } : {})
      };
    });

    await this.updateMessageMetadata(
      pending.messageId,
      pending.channelId,
      this.withClaudeCodeTaskMetadata(nextMetadata, pending.runId, 'running')
    );
  };

  private readSessionState = async (
    session: TClaudeCodeSession
  ): Promise<TClaudeCodeSessionStateRecord> =>
    fs
      .readFile(getClaudeSessionPath(session.scope.storageKey), 'utf8')
      .then((value) => JSON.parse(value) as TClaudeCodeSessionStateRecord)
      .catch(() => ({}));

  private writeSessionStatePatch = async (
    session: TClaudeCodeSession,
    patch: TClaudeCodeSessionStateRecord
  ) => {
    const sessionPath = getClaudeSessionPath(session.scope.storageKey);
    const existing = await this.readSessionState(session);

    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(
      sessionPath,
      JSON.stringify({ ...existing, ...patch }, null, 2)
    );
  };

  private readChatSessions = async (
    storageKey: string
  ): Promise<TClaudeCodeChatSessionRecord[]> => {
    try {
      const records = JSON.parse(
        await fs.readFile(getClaudeChatSessionsPath(storageKey), 'utf8')
      ) as TClaudeCodeChatSessionRecord[];

      if (!Array.isArray(records)) return [];

      return records.filter(
        (record) =>
          typeof record.id === 'string' &&
          typeof record.claudeSessionId === 'string' &&
          typeof record.createdAt === 'number' &&
          typeof record.updatedAt === 'number'
      );
    } catch {
      return [];
    }
  };

  private writeChatSessions = async (
    storageKey: string,
    records: TClaudeCodeChatSessionRecord[]
  ) => {
    const sessionsPath = getClaudeChatSessionsPath(storageKey);

    await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
    await fs.writeFile(sessionsPath, JSON.stringify(records, null, 2));
  };

  private upsertChatSession = async (
    storageKey: string,
    record: TClaudeCodeChatSessionRecord
  ) => {
    const records = await this.readChatSessions(storageKey);
    const index = records.findIndex((item) => item.id === record.id);

    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }

    await this.writeChatSessions(storageKey, records);
  };

  private markChatSessionReady = async (
    storageKey: string,
    chatSessionId: string,
    claudeSessionId?: string
  ) => {
    const records = await this.readChatSessions(storageKey);
    const record = records.find((item) => item.id === chatSessionId);

    if (!record?.readyAt) {
      await this.upsertChatSession(storageKey, {
        ...(record ?? {
          id: chatSessionId,
          claudeSessionId: claudeSessionId ?? randomUUID(),
          createdAt: Date.now()
        }),
        updatedAt: Date.now(),
        readyAt: Date.now()
      });
    }
  };

  private hasChatSessionSnapshot = async (
    storageKey: string,
    chatSessionId: string
  ) =>
    Boolean(
      await fs
        .stat(getClaudeChatSessionMessagesPath(storageKey, chatSessionId))
        .catch(() => undefined)
    );

  private buildChatSessionRecord = (): TClaudeCodeChatSessionRecord => {
    const now = Date.now();

    return {
      id: randomUUID(),
      claudeSessionId: randomUUID(),
      createdAt: now,
      updatedAt: now
    };
  };

  private createChatSessionRecord = async (storageKey: string) => {
    const record = this.buildChatSessionRecord();

    await this.upsertChatSession(storageKey, record);

    return record;
  };

  private setCurrentChatSession = async (
    session: TClaudeCodeSession,
    record: TClaudeCodeChatSessionRecord,
    shouldResume: boolean
  ) => {
    const updatedRecord = {
      ...record,
      updatedAt: Date.now()
    };

    await this.upsertChatSession(session.scope.storageKey, updatedRecord);
    await this.writeSessionStatePatch(session, {
      chatSessionId: updatedRecord.id,
      claudeSessionId: updatedRecord.claudeSessionId,
      readyAt: updatedRecord.readyAt,
      updatedAt: updatedRecord.updatedAt
    });

    session.chatSessionId = updatedRecord.id;
    session.claudeSessionId = updatedRecord.claudeSessionId;
    session.shouldResumeClaudeSession = shouldResume;
  };

  private rebindClaudeSession = async (
    storageKey: string,
    chatSessionId?: string
  ) => {
    const records = await this.readChatSessions(storageKey);
    const now = Date.now();
    const existing = chatSessionId
      ? records.find((record) => record.id === chatSessionId)
      : undefined;
    const record: TClaudeCodeChatSessionRecord = existing
      ? (() => {
          const { readyAt, ...rest } = existing;

          void readyAt;

          return {
            ...rest,
            claudeSessionId: randomUUID(),
            updatedAt: now
          };
        })()
      : {
          id: randomUUID(),
          claudeSessionId: randomUUID(),
          createdAt: now,
          updatedAt: now
        };

    await this.upsertChatSession(storageKey, record);

    return record;
  };

  private getCurrentChatSessionId = async (
    storageKey: string,
    session?: TClaudeCodeSession
  ) =>
    session?.chatSessionId ??
    (await fs
      .readFile(getClaudeSessionPath(storageKey), 'utf8')
      .then(
        (value) =>
          (JSON.parse(value) as { chatSessionId?: string }).chatSessionId
      )
      .catch(() => undefined));

  private snapshotChatSessionMessages = async (
    storageKey: string,
    channelId: number,
    chatSessionId?: string
  ) => {
    if (!chatSessionId) return;

    const messageRows = await db
      .select()
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .orderBy(asc(messages.createdAt));
    const messageIds = messageRows.map((message) => message.id);
    const fileRows =
      messageIds.length > 0
        ? await db
            .select()
            .from(messageFiles)
            .where(inArray(messageFiles.messageId, messageIds))
        : [];
    const snapshot: TClaudeCodeMessageSnapshot = {
      messages: messageRows,
      messageFiles: fileRows
    };
    const snapshotPath = getClaudeChatSessionMessagesPath(
      storageKey,
      chatSessionId
    );

    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

    const records = await this.readChatSessions(storageKey);
    const record = records.find((item) => item.id === chatSessionId);

    if (record) {
      await this.upsertChatSession(storageKey, {
        ...record,
        updatedAt: Date.now()
      });
    }
  };

  private clearChannelMessages = async (channelId: number) => {
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .all();

    if (rows.length === 0) return;

    await db.delete(messages).where(eq(messages.channelId, channelId));

    for (const row of rows) {
      await publishMessage(row.id, channelId, 'delete');
    }
  };

  private restoreChatSessionMessages = async (
    storageKey: string,
    channelId: number,
    chatSessionId: string
  ) => {
    const snapshot = await fs
      .readFile(
        getClaudeChatSessionMessagesPath(storageKey, chatSessionId),
        'utf8'
      )
      .then((value) => JSON.parse(value) as TClaudeCodeMessageSnapshot)
      .catch(() => undefined);

    if (!snapshot?.messages?.length) return;

    await db.insert(messages).values(
      snapshot.messages.map((message) => ({
        ...message,
        messageId:
          message.messageId && message.messageId.length <= 18
            ? message.messageId
            : createMessageBusinessId()
      }))
    );

    if (snapshot.messageFiles?.length) {
      await db.insert(messageFiles).values(snapshot.messageFiles);
    }

    for (const message of snapshot.messages) {
      await publishMessage(message.id, channelId, 'create');
    }
  };

  private switchChatSessionMessages = async ({
    storageKey,
    channelId,
    fromChatSessionId,
    toChatSessionId,
    restore
  }: {
    storageKey: string;
    channelId: number;
    fromChatSessionId?: string;
    toChatSessionId: string;
    restore: boolean;
  }) => {
    if (fromChatSessionId === toChatSessionId) return;

    await this.snapshotChatSessionMessages(
      storageKey,
      channelId,
      fromChatSessionId
    );
    await this.clearChannelMessages(channelId);

    if (restore) {
      await this.restoreChatSessionMessages(
        storageKey,
        channelId,
        toChatSessionId
      );
    }
  };

  private waitForClaudeSessionBinding = async (session: TClaudeCodeSession) => {
    const deadline = Date.now() + 12_000;

    while (Date.now() < deadline) {
      if (session.pty && session.output.trim().length > 0) return;

      if (!session.pty && session.status.state === 'failed') {
        throw new Error(session.status.lastError ?? 'Claude Code TTY 启动失败');
      }

      if (!session.pty && !session.starting) {
        throw new Error('Claude Code TTY 未能建立');
      }

      await sleep(250);
    }

    throw new Error('Claude Code TTY 启动超时');
  };

  private getClaudeSession = async (session: TClaudeCodeSession) => {
    const { storageKey } = session.scope;

    if (session.chatSessionId && session.claudeSessionId) {
      if (
        session.shouldResumeClaudeSession &&
        !(await isClaudeSessionAvailable(session.claudeSessionId))
      ) {
        const record = await this.rebindClaudeSession(
          storageKey,
          session.chatSessionId
        );

        await this.setCurrentChatSession(session, record, false);

        return {
          sessionId: record.claudeSessionId,
          resume: false
        };
      }

      return {
        sessionId: session.claudeSessionId,
        resume: session.shouldResumeClaudeSession ?? true
      };
    }

    const sessionPath = getClaudeSessionPath(storageKey);

    try {
      const record = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as {
        chatSessionId?: string;
        claudeSessionId?: string;
        sessionId?: string;
        createdAt?: number;
        updatedAt?: number;
        lastInjectedMessageDbId?: number;
      };

      session.lastInjectedMessageDbId = record.lastInjectedMessageDbId;

      if (record.chatSessionId && record.claudeSessionId) {
        const records = await this.readChatSessions(storageKey);
        let chatSession = records.find(
          (item) => item.id === record.chatSessionId
        ) ?? {
          id: record.chatSessionId,
          claudeSessionId: record.claudeSessionId,
          createdAt: record.createdAt ?? Date.now(),
          updatedAt: record.updatedAt ?? Date.now()
        };

        if (
          !chatSession.readyAt &&
          !(await this.hasChatSessionSnapshot(storageKey, chatSession.id)) &&
          !(await isClaudeSessionAvailable(chatSession.claudeSessionId))
        ) {
          chatSession = await this.rebindClaudeSession(
            storageKey,
            chatSession.id
          );
          await this.setCurrentChatSession(session, chatSession, false);

          return { sessionId: chatSession.claudeSessionId, resume: false };
        }

        await this.setCurrentChatSession(session, chatSession, true);

        return { sessionId: chatSession.claudeSessionId, resume: true };
      }

      if (record.sessionId) {
        const available = await isClaudeSessionAvailable(record.sessionId);
        const chatSession = await this.createChatSessionRecord(storageKey);
        const migratedRecord = {
          ...chatSession,
          claudeSessionId: available
            ? record.sessionId
            : chatSession.claudeSessionId
        };

        await this.setCurrentChatSession(session, migratedRecord, available);

        return {
          sessionId: migratedRecord.claudeSessionId,
          resume: available
        };
      }
    } catch {
      // Missing or invalid session records are recreated below.
    }

    const chatSession = await this.createChatSessionRecord(storageKey);

    await this.setCurrentChatSession(session, chatSession, false);

    return { sessionId: chatSession.claudeSessionId, resume: false };
  };

  private resetClaudeSession = async (session: TClaudeCodeSession) => {
    const record = await this.rebindClaudeSession(
      session.scope.storageKey,
      session.chatSessionId
    );

    await this.setCurrentChatSession(session, record, false);

    return record.claudeSessionId;
  };

  public listClaudeSessionsForUser = async (userId: number) => {
    await this.ensureAgentUser();

    const scope = createDmScope(userId);
    const currentSession = this.sessions.get(scope.key);
    const currentRecord = await fs
      .readFile(getClaudeSessionPath(scope.storageKey), 'utf8')
      .then((value) => JSON.parse(value) as TClaudeCodeSessionStateRecord)
      .catch(() => undefined);
    let currentChatSessionId =
      currentSession?.chatSessionId ?? currentRecord?.chatSessionId;
    let chatSessions = await this.readChatSessions(scope.storageKey);

    if (
      currentRecord?.chatSessionId &&
      currentRecord.claudeSessionId &&
      !chatSessions.some((record) => record.id === currentRecord.chatSessionId)
    ) {
      const migratedRecord = {
        id: currentRecord.chatSessionId,
        claudeSessionId: currentRecord.claudeSessionId,
        createdAt: currentRecord.createdAt ?? Date.now(),
        updatedAt: currentRecord.updatedAt ?? Date.now(),
        readyAt: currentRecord.readyAt
      };

      await this.upsertChatSession(scope.storageKey, migratedRecord);
      await fs.writeFile(
        getClaudeSessionPath(scope.storageKey),
        JSON.stringify(
          {
            chatSessionId: migratedRecord.id,
            claudeSessionId: migratedRecord.claudeSessionId,
            updatedAt: migratedRecord.updatedAt
          },
          null,
          2
        )
      );
      chatSessions = [...chatSessions, migratedRecord];
      currentChatSessionId = migratedRecord.id;
    }

    if (!currentChatSessionId && currentRecord?.sessionId) {
      const migratedRecord = {
        id: randomUUID(),
        claudeSessionId: currentRecord.sessionId,
        createdAt: currentRecord.createdAt ?? Date.now(),
        updatedAt: currentRecord.updatedAt ?? Date.now()
      };

      await this.upsertChatSession(scope.storageKey, migratedRecord);
      chatSessions = [...chatSessions, migratedRecord];
    }

    const sessions = await Promise.all(
      chatSessions.map(async (record) => {
        const current = record.id === currentChatSessionId;

        return {
          id: record.id,
          claudeSessionId: record.claudeSessionId,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          current,
          available:
            current ||
            Boolean(record.readyAt) ||
            (await this.hasChatSessionSnapshot(scope.storageKey, record.id)) ||
            (await isClaudeSessionAvailable(record.claudeSessionId))
        };
      })
    );

    return sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  };

  public startNewClaudeSessionForUser = async (userId: number) => {
    const scope = createDmScope(userId);
    const session = this.getSession(userId);
    const { channelId } = await this.openDirectMessage(userId);
    const previousChatSessionId = await this.getCurrentChatSessionId(
      scope.storageKey,
      session
    );
    const previousState = {
      chatSessionId: session.chatSessionId,
      claudeSessionId: session.claudeSessionId,
      shouldResumeClaudeSession: session.shouldResumeClaudeSession,
      output: session.output,
      channelId: session.channelId,
      messageId: session.messageId,
      runId: session.runId,
      status: session.status
    };
    const hadRunningPty = Boolean(session.pty);
    const chatSession = this.buildChatSessionRecord();

    await this.cancelPendingAskUserQuestions(
      session,
      'ClaudeCode switched to a new chat session before the question was answered.'
    );

    if (session.pty) {
      session.stopping = true;
      session.pty.kill();
      session.pty = undefined;
    }

    session.chatSessionId = chatSession.id;
    session.claudeSessionId = chatSession.claudeSessionId;
    session.shouldResumeClaudeSession = false;
    session.output = '';
    session.channelId = channelId;
    session.messageId = undefined;
    session.runId = undefined;

    try {
      await this.ensureSession(userId);
      await this.waitForClaudeSessionBinding(session);
    } catch (error) {
      const failedPty = session.pty as TPty | undefined;

      if (failedPty) {
        session.stopping = true;
        failedPty.kill();
        session.pty = undefined;
      }

      session.chatSessionId = previousState.chatSessionId;
      session.claudeSessionId = previousState.claudeSessionId;
      session.shouldResumeClaudeSession =
        previousState.shouldResumeClaudeSession;
      session.output = previousState.output;
      session.channelId = previousState.channelId;
      session.messageId = previousState.messageId;
      session.runId = previousState.runId;
      session.status = {
        ...previousState.status,
        lastError: getErrorMessage(error),
        updatedAt: Date.now()
      };
      this.publishStatus(session);

      if (hadRunningPty && previousState.claudeSessionId) {
        void this.ensureSession(userId).catch(() => undefined);
      }

      throw error;
    }

    const readyChatSession = {
      ...chatSession,
      readyAt: Date.now()
    };

    await this.switchChatSessionMessages({
      storageKey: scope.storageKey,
      channelId,
      fromChatSessionId: previousChatSessionId,
      toChatSessionId: readyChatSession.id,
      restore: false
    });
    await this.setCurrentChatSession(session, readyChatSession, true);

    session.output = '';
    session.channelId = channelId;
    session.messageId = undefined;
    session.runId = undefined;
    session.status = {
      ...session.status,
      state: 'idle',
      lastError: undefined,
      channelId,
      messageId: undefined,
      runId: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    return {
      chatSessionId: readyChatSession.id,
      claudeSessionId: readyChatSession.claudeSessionId
    };
  };

  public resumeClaudeSessionForUser = async (
    userId: number,
    chatSessionId: string
  ) => {
    const scope = createDmScope(userId);
    const records = await this.readChatSessions(scope.storageKey);
    let chatSession = records.find((record) => record.id === chatSessionId);

    if (!chatSession) {
      throw new Error('ClaudeCode 聊天室历史会话不存在');
    }

    const session = this.getSession(userId);
    const { channelId } = await this.openDirectMessage(userId);
    const previousChatSessionId = await this.getCurrentChatSessionId(
      scope.storageKey,
      session
    );
    let rebound = false;

    if (
      !chatSession.readyAt &&
      !(await this.hasChatSessionSnapshot(scope.storageKey, chatSession.id)) &&
      !(await isClaudeSessionAvailable(chatSession.claudeSessionId))
    ) {
      chatSession = await this.rebindClaudeSession(
        scope.storageKey,
        chatSession.id
      );
      rebound = true;
    }

    await this.switchChatSessionMessages({
      storageKey: scope.storageKey,
      channelId,
      fromChatSessionId: previousChatSessionId,
      toChatSessionId: chatSession.id,
      restore: true
    });
    await this.setCurrentChatSession(session, chatSession, !rebound);

    await this.cancelPendingAskUserQuestions(
      session,
      'ClaudeCode switched chat sessions before the question was answered.'
    );

    if (session.pty) {
      session.stopping = true;
      session.pty.kill();
      session.pty = undefined;
    }

    session.output = '';
    session.channelId = channelId;
    session.messageId = undefined;
    session.runId = undefined;
    session.status = {
      ...session.status,
      state: 'idle',
      lastError: undefined,
      channelId,
      messageId: undefined,
      runId: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    if (session.clients.size > 0) {
      await this.ensureSession(userId);
    }

    return {
      chatSessionId: chatSession.id,
      claudeSessionId: chatSession.claudeSessionId,
      rebound
    };
  };

  public deleteClaudeSessionForUser = async (
    userId: number,
    chatSessionId: string
  ) => {
    const scope = createDmScope(userId);
    const session = this.sessions.get(scope.key);
    const currentChatSessionId = await this.getCurrentChatSessionId(
      scope.storageKey,
      session
    );

    if (chatSessionId === currentChatSessionId) {
      throw new Error('无法删除正在使用的 ClaudeCode 会话，请先切换到其他会话');
    }

    const records = await this.readChatSessions(scope.storageKey);
    const target = records.find((record) => record.id === chatSessionId);

    if (!target) {
      throw new Error('ClaudeCode 聊天室历史会话不存在');
    }

    await this.writeChatSessions(
      scope.storageKey,
      records.filter((record) => record.id !== chatSessionId)
    );
    await fs.rm(
      getClaudeChatSessionMessagesPath(scope.storageKey, chatSessionId),
      {
        force: true
      }
    );
    await deleteClaudeSessionFile(target.claudeSessionId);

    return { deleted: true };
  };

  private recoverMissingClaudeSession = async (session: TClaudeCodeSession) => {
    if (session.recoveringMissingClaudeSession) return;

    session.recoveringMissingClaudeSession = true;

    try {
      await this.resetClaudeSession(session);

      const currentPty = session.pty;

      if (currentPty) {
        session.stopping = true;
        currentPty.kill();
        session.pty = undefined;
      }

      await this.startSession(session);
    } finally {
      session.recoveringMissingClaudeSession = false;
    }
  };

  private startSession = async (session: TClaudeCodeSession) => {
    if (session.pty) return;

    session.status = {
      ...session.status,
      state: 'starting',
      lastError: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(session);
    session.output = '';

    await fs.mkdir(path.dirname(session.settingsPath), { recursive: true });
    await fs.writeFile(
      session.settingsPath,
      JSON.stringify(this.buildSettings(session), null, 2)
    );

    const claudeSession = await this.getClaudeSession(session);
    const claudeArgs = [
      '--dangerously-skip-permissions',
      '--settings',
      session.settingsPath,
      '--append-system-prompt',
      this.getSystemPrompt(session),
      ...(claudeSession.resume
        ? ['--resume', claudeSession.sessionId]
        : ['--session-id', claudeSession.sessionId])
    ];
    const env = {
      ...process.env,
      PATH: getClaudePath(),
      CLAUDE_CODE_NO_FLICKER: '1'
    };
    session.stopping = false;
    session.pty = createNodePtyHelper(CLAUDE_CODE_COMMAND, claudeArgs, {
      cwd: WORKSPACE_ROOT,
      env,
      cols: 100,
      rows: 30
    });
    const launchedPty = session.pty;

    session.shouldResumeClaudeSession = true;

    launchedPty.onData((data) => {
      if (
        data.trim() &&
        session.chatSessionId &&
        session.claudeSessionId &&
        session.readyMarkedChatSessionId !== session.chatSessionId
      ) {
        session.readyMarkedChatSessionId = session.chatSessionId;
        void this.markChatSessionReady(
          session.scope.storageKey,
          session.chatSessionId,
          session.claudeSessionId
        );
      }

      if (data.includes('\x1b[?2004h')) {
        session.bracketedPasteMode = true;
      }

      if (data.includes('\x1b[?2004l')) {
        session.bracketedPasteMode = false;
      }

      session.output = `${session.output}${data}`.slice(-MAX_OUTPUT_BUFFER);

      for (const client of session.clients) {
        sendJson(client, { type: 'output', data });
      }

      if (data.includes('No conversation found with session ID')) {
        void this.recoverMissingClaudeSession(session);
      }
    });

    launchedPty.onExit((event) => {
      const isCurrentPty = session.pty === launchedPty;
      const wasStopping = session.stopping;

      if (isCurrentPty) {
        session.pty = undefined;
      }

      if (!isCurrentPty) {
        if (wasStopping) {
          session.stopping = false;
        }

        return;
      }

      session.stopping = false;

      if (wasStopping) {
        session.status = {
          ...session.status,
          state: 'idle',
          connected: session.clients.size > 0,
          lastError: undefined,
          updatedAt: Date.now()
        };
        this.publishStatus(session);

        return;
      }

      const wasRunning =
        session.status.state === 'running' ||
        session.status.state === 'waiting_for_user';
      const exitMessage = `Claude Code exited (${event.exitCode}${event.signal ? `, ${event.signal}` : ''})`;

      if (event.exitCode !== 0 || wasRunning) {
        const output = `\r\n[ClaudeCode] ${exitMessage}\r\n`;

        session.output = `${session.output}${output}`.slice(-MAX_OUTPUT_BUFFER);

        for (const client of session.clients) {
          sendJson(client, { type: 'output', data: output });
        }
      }

      session.status = {
        ...session.status,
        state: wasRunning || event.exitCode !== 0 ? 'failed' : 'idle',
        lastError: wasRunning || event.exitCode !== 0 ? exitMessage : undefined,
        updatedAt: Date.now()
      };
      this.publishStatus(session);
    });

    session.status = {
      ...session.status,
      state: 'idle',
      lastError: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(session);
  };

  private ensureSessionForScope = async (scope: TClaudeCodeSessionScope) => {
    const session = this.getSessionForScope(scope);

    if (session.pty) return session;

    if (!session.starting) {
      session.starting = this.startSession(session).finally(() => {
        session.starting = undefined;
      });
    }

    await session.starting;

    return session;
  };

  private ensureSession = async (userId: number) =>
    this.ensureSessionForScope(createDmScope(userId));

  public stopSessionForUser = async (userId: number) => {
    const session = this.sessions.get(createDmScope(userId).key);

    if (!session) {
      return { stopped: false };
    }

    const wasRunning =
      session.status.state === 'running' ||
      session.status.state === 'waiting_for_user';

    if (wasRunning && session.channelId && session.messageId) {
      const runId = session.runId ?? randomUUIDv7();

      await this.cancelPendingAskUserQuestions(
        session,
        'ClaudeCode session was stopped before the question was answered.'
      );
      const metadata = await this.getMessageMetadata(session.messageId);

      await db
        .update(messages)
        .set({
          content: toMessageHtml('已离开 ClaudeCode 私聊，任务已停止。'),
          metadata: this.withClaudeCodeTaskMetadata(metadata, runId, 'failed'),
          updatedAt: Date.now()
        })
        .where(eq(messages.id, session.messageId));

      await publishMessage(session.messageId, session.channelId, 'update');
      session.messageId = undefined;
      session.runId = undefined;
    }

    if (session.pty) {
      session.stopping = true;
      session.pty.kill();
      session.pty = undefined;
    } else {
      session.stopping = false;
    }

    session.status = {
      ...session.status,
      state: 'idle',
      connected: session.clients.size > 0,
      lastError: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    return { stopped: true };
  };

  public clearConversationForUser = async (userId: number) => {
    const scope = createDmScope(userId);
    const { channelId } = await this.getDirectMessageForUser(userId);

    if (!channelId) {
      return { cleared: false, deletedMessages: 0 };
    }

    const session = this.sessions.get(scope.key);

    if (session) {
      await this.cancelPendingAskUserQuestions(
        session,
        'ClaudeCode conversation was cleared before the question was answered.'
      );
    }

    if (session?.pty) {
      session.stopping = true;
      session.pty.kill();
      session.pty = undefined;
    }

    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.channelId, channelId))
      .all();

    await db.delete(messages).where(eq(messages.channelId, channelId));

    for (const row of rows) {
      await publishMessage(row.id, channelId, 'delete');
    }

    const sessionPath = getClaudeSessionPath(scope.storageKey);

    await fs.rm(sessionPath, { force: true });

    if (session) {
      session.output = '';
      session.runId = undefined;
      session.channelId = channelId;
      session.messageId = undefined;
      session.claudeSessionId = undefined;
      session.shouldResumeClaudeSession = false;
      session.status = {
        state: 'idle',
        connected: session.clients.size > 0,
        channelId,
        updatedAt: Date.now()
      };
      this.publishStatus(session);
    }

    return { cleared: true, deletedMessages: rows.length };
  };

  private isClaudeCodeDm = async (channelId: number, userId: number) => {
    const agentUserId = await this.ensureAgentUser();
    const participantIds =
      await getDirectMessageChannelParticipantIds(channelId);

    return (
      participantIds.includes(userId) && participantIds.includes(agentUserId)
    );
  };

  private createProcessingMessage = async (
    channelId: number,
    runId: string
  ) => {
    const agentUserId = await this.ensureAgentUser();

    const message = await db
      .insert(messages)
      .values({
        channelId,
        userId: agentUserId,
        content: '',
        editable: false,
        metadata: [
          {
            kind: 'claude_code_task',
            runId,
            status: 'running'
          }
        ],
        createdAt: Date.now()
      })
      .returning()
      .get();

    await publishMessage(message.id, channelId, 'create');

    return message.id;
  };

  private hasClaudeCodeGroupTrigger = (
    message: TJoinedMessage,
    agentUserId: number
  ) => {
    if (hasMention(message.content, agentUserId)) {
      return true;
    }

    const text = getPlainTextFromHtml(message.content ?? '');

    return /(^|[\s([{<])@(?:claude|claudecode)\b/i.test(text);
  };

  private isInjectableChatMessage = (
    message: TJoinedMessage,
    agentUserId: number
  ) =>
    Boolean(
      message.userId && !message.pluginId && message.userId !== agentUserId
    );

  private getGroupLastInjectedMessageDbId = async (
    session: TClaudeCodeSession
  ) => {
    if (typeof session.lastInjectedMessageDbId === 'number') {
      return session.lastInjectedMessageDbId;
    }

    const record = await this.readSessionState(session);

    session.lastInjectedMessageDbId = record.lastInjectedMessageDbId;

    return session.lastInjectedMessageDbId;
  };

  private setGroupLastInjectedMessageDbId = async (
    session: TClaudeCodeSession,
    messageDbId: number
  ) => {
    session.lastInjectedMessageDbId = messageDbId;
    await this.writeSessionStatePatch(session, {
      lastInjectedMessageDbId: messageDbId,
      updatedAt: Date.now()
    });
  };

  private getGroupMessagesForInjection = async (
    channelId: number,
    throughMessageId: number,
    agentUserId: number,
    lastInjectedMessageDbId?: number
  ) => {
    const conditions = [
      eq(messages.channelId, channelId),
      lte(messages.id, throughMessageId)
    ];

    if (lastInjectedMessageDbId) {
      conditions.push(gt(messages.id, lastInjectedMessageDbId));
    }

    const rows = await db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(asc(messages.id));
    const joined = await joinMessagesWithRelations(rows);

    return joined.filter((message) =>
      this.isInjectableChatMessage(message, agentUserId)
    );
  };

  private buildPrompt = async (
    session: TClaudeCodeSession,
    batch: TJoinedMessage[]
  ) => {
    const userIds = [
      ...new Set(
        batch
          .map((message) => message.userId)
          .filter((userId): userId is number => typeof userId === 'number')
      )
    ];
    const parentMessageIds = [
      ...new Set(
        batch
          .map((message) => message.parentMessageId)
          .filter(
            (messageId): messageId is number => typeof messageId === 'number'
          )
      )
    ];
    const [userRows, parentRows] = await Promise.all([
      userIds.length > 0
        ? db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, userIds))
        : [],
      parentMessageIds.length > 0
        ? db
            .select({ id: messages.id, messageId: messages.messageId })
            .from(messages)
            .where(inArray(messages.id, parentMessageIds))
        : []
    ]);
    const usersById = new Map(userRows.map((user) => [user.id, user.name]));
    const parentMessageIdsByDbId = new Map(
      parentRows.map((message) => [message.id, message.messageId])
    );
    const payload = {
      scope:
        session.scope.kind === 'dm'
          ? { type: 'dm', user_id: session.scope.userId }
          : { type: 'channel', channel_id: session.scope.channelId },
      messages: batch.map((message) => ({
        user: usersById.get(message.userId ?? -1) ?? 'Unknown User',
        user_id: message.userId,
        message_id: message.messageId,
        time: formatClaudeMessageTime(message.createdAt),
        text: getPlainTextFromHtml(message.content ?? '').trim(),
        files: message.files.map((file) => path.join(PUBLIC_PATH, file.name)),
        ...(message.replyTo?.messageId
          ? { reply_to: message.replyTo.messageId }
          : {}),
        ...(message.parentMessageId
          ? {
              parent_message_id:
                parentMessageIdsByDbId.get(message.parentMessageId) ??
                String(message.parentMessageId)
            }
          : {})
      }))
    };
    const instruction =
      session.scope.kind === 'dm'
        ? '请根据以下私聊消息继续处理。最后一条消息是本次用户输入；只输出需要发到聊天里的最终回复。'
        : '请根据以下群聊消息继续处理。最后一条消息包含本次 @claude 触发请求；必须根据 user_id 区分不同用户的要求，只输出需要发到群聊里的最终回复。';

    return [
      instruction,
      '```json',
      JSON.stringify(payload, null, 2),
      '```'
    ].join('\n');
  };

  private writePrompt = async (session: TClaudeCodeSession, prompt: string) => {
    if (!session.pty) {
      throw new Error('Claude Code PTY is not running');
    }

    session.pty.write(CLEAR_CURRENT_TTY_INPUT);
    await sleep(30);
    session.pty.write(
      toPtyPastePayload(prompt, {
        bracketedPaste: session.bracketedPasteMode === true
      })
    );
    await sleep(60);
    session.pty.write(SUBMIT_CURRENT_TTY_INPUT);
    await sleep(80);
    session.pty.write(SUBMIT_CURRENT_TTY_INPUT);
  };

  private startDmRun = async (message: TJoinedMessage) => {
    if (!message.userId) return;

    const session = await this.ensureSession(message.userId);
    if (session.status.state === 'waiting_for_user') return;

    const hasRunningMessage =
      session.status.state === 'running' && session.messageId;
    const runId = hasRunningMessage ? session.runId! : randomUUIDv7();

    session.runId = runId;
    session.channelId = message.channelId;

    if (!hasRunningMessage) {
      session.messageId = await this.createProcessingMessage(
        message.channelId,
        runId
      );
    }

    session.status = {
      ...session.status,
      state: 'running',
      runId,
      channelId: message.channelId,
      messageId: session.messageId,
      lastError: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    await this.writePrompt(session, await this.buildPrompt(session, [message]));
  };

  private queueGroupTrigger = (
    session: TClaudeCodeSession,
    triggerMessageId: number
  ) => {
    session.pendingGroupTriggerMessageId = Math.max(
      session.pendingGroupTriggerMessageId ?? 0,
      triggerMessageId
    );
  };

  private startGroupRun = async (
    session: TClaudeCodeSession,
    triggerMessageId: number
  ) => {
    if (session.scope.kind !== 'channel') return;

    const agentUserId = await this.ensureAgentUser();
    const lastInjectedMessageDbId =
      await this.getGroupLastInjectedMessageDbId(session);
    const batch = await this.getGroupMessagesForInjection(
      session.scope.channelId,
      triggerMessageId,
      agentUserId,
      lastInjectedMessageDbId
    );

    if (batch.length === 0) return;

    const ensuredSession = await this.ensureSessionForScope(session.scope);
    const runId = randomUUIDv7();

    ensuredSession.runId = runId;
    ensuredSession.channelId = session.scope.channelId;
    ensuredSession.messageId = await this.createProcessingMessage(
      session.scope.channelId,
      runId
    );
    ensuredSession.status = {
      ...ensuredSession.status,
      state: 'running',
      runId,
      channelId: session.scope.channelId,
      messageId: ensuredSession.messageId,
      lastError: undefined,
      updatedAt: Date.now()
    };
    this.publishStatus(ensuredSession);

    await this.writePrompt(
      ensuredSession,
      await this.buildPrompt(ensuredSession, batch)
    );
    await this.setGroupLastInjectedMessageDbId(
      ensuredSession,
      triggerMessageId
    );
  };

  private scheduleQueuedGroupTrigger = (session: TClaudeCodeSession) => {
    if (session.scope.kind !== 'channel') return false;

    const triggerMessageId = session.pendingGroupTriggerMessageId;

    if (!triggerMessageId) return false;

    session.pendingGroupTriggerMessageId = undefined;

    setTimeout(() => {
      void this.startGroupRun(session, triggerMessageId).catch((error) => {
        logger.error(
          'ClaudeCode queued group trigger failed: %s',
          getErrorMessage(error)
        );
      });
    }, 250);

    return true;
  };

  private handleGroupCreatedMessage = async (message: TJoinedMessage) => {
    const agentUserId = await this.ensureAgentUser();

    if (!this.hasClaudeCodeGroupTrigger(message, agentUserId)) return;

    const scope = createChannelScope(message.channelId);
    const session = this.getSessionForScope(scope);
    const isBusy =
      session.status.state === 'running' ||
      session.status.state === 'waiting_for_user';

    if (isBusy) {
      this.queueGroupTrigger(session, message.id);
      return;
    }

    await this.startGroupRun(session, message.id);
  };

  public handleCreatedMessage = async (messageId: number) => {
    const message = await getMessage(messageId);

    if (!message?.userId || message.pluginId) return;

    const agentUserId = await this.ensureAgentUser();

    if (message.userId === agentUserId) return;

    if (await this.isClaudeCodeDm(message.channelId, message.userId)) {
      await this.startDmRun(message);
      return;
    }

    if (await isDirectMessageChannel(message.channelId)) return;

    await this.handleGroupCreatedMessage(message);
  };

  private completeAskUserQuestionRequest = async (
    session: TClaudeCodeSession,
    requestId: string,
    status: 'answered' | 'cancelled' | 'expired',
    answers: TClaudeCodeAskUserQuestionAnswers | undefined,
    reason: string
  ) => {
    const pending = session.askUserQuestionRequests.get(requestId);

    if (!pending) return false;

    session.askUserQuestionRequests.delete(requestId);
    clearTimeout(pending.timeout);

    try {
      await this.updateAskUserQuestionMetadata(pending, status, answers);
    } catch (error) {
      logger.error(
        'Failed to update ClaudeCode AskUserQuestion metadata: %s',
        getErrorMessage(error)
      );
    }

    session.status = {
      ...session.status,
      state: 'running',
      channelId: pending.channelId,
      messageId: pending.messageId,
      runId: pending.runId,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    if (status === 'answered' && answers) {
      pending.resolve(
        buildAskUserQuestionAllowResponse(pending.questions, answers)
      );
    } else {
      pending.resolve(buildAskUserQuestionDenyResponse(reason));
    }

    return true;
  };

  private cancelPendingAskUserQuestions = async (
    session: TClaudeCodeSession,
    reason: string
  ) => {
    const requestIds = Array.from(session.askUserQuestionRequests.keys());

    for (const requestId of requestIds) {
      await this.completeAskUserQuestionRequest(
        session,
        requestId,
        'cancelled',
        undefined,
        reason
      );
    }
  };

  public handleAskUserQuestionHook = async (
    token: string,
    input: TAskUserQuestionHookInput
  ): Promise<TAskUserQuestionHookResponse | undefined> => {
    const session = this.getSessionByHookToken(token);

    if (!session) return undefined;

    if (input.tool_name && input.tool_name !== 'AskUserQuestion') {
      return buildAskUserQuestionDenyResponse(
        `Unexpected ClaudeCode tool for AskUserQuestion hook: ${input.tool_name}`
      );
    }

    let questions: TClaudeCodeAskUserQuestion[];

    try {
      questions = normalizeAskUserQuestions(input);
    } catch (error) {
      return buildAskUserQuestionDenyResponse(getErrorMessage(error));
    }

    if (!session.channelId || !session.messageId) {
      return buildAskUserQuestionDenyResponse(
        'ClaudeCode asked a question before a chat task message was available.'
      );
    }

    const runId = session.runId ?? randomUUIDv7();
    const requestId = randomUUIDv7();
    const pendingBase = {
      requestId,
      scope: session.scope,
      runId,
      channelId: session.channelId,
      messageId: session.messageId,
      questions
    };
    let resolveRequest!: (response: TAskUserQuestionHookResponse) => void;
    const responsePromise = new Promise<TAskUserQuestionHookResponse>(
      (resolve) => {
        resolveRequest = resolve;
      }
    );
    const timeout = setTimeout(() => {
      void this.completeAskUserQuestionRequest(
        session,
        requestId,
        'expired',
        undefined,
        'ClaudeCode AskUserQuestion timed out before the chat UI received an answer.'
      );
    }, ASK_USER_QUESTION_TIMEOUT_MS);
    const pending: TPendingAskUserQuestionRequest = {
      ...pendingBase,
      timeout,
      resolve: resolveRequest
    };

    session.runId = runId;
    session.askUserQuestionRequests.set(requestId, pending);

    try {
      await this.addAskUserQuestionMetadata(pendingBase);
    } catch (error) {
      session.askUserQuestionRequests.delete(requestId);
      clearTimeout(timeout);

      return buildAskUserQuestionDenyResponse(
        `Failed to show ClaudeCode question in chat: ${getErrorMessage(error)}`
      );
    }

    session.status = {
      ...session.status,
      state: 'waiting_for_user',
      channelId: session.channelId,
      messageId: session.messageId,
      runId,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    return responsePromise;
  };

  private findAskUserQuestionRequest = (requestId: string) => {
    for (const session of this.sessions.values()) {
      const pending = session.askUserQuestionRequests.get(requestId);

      if (pending) {
        return { session, pending };
      }
    }

    return undefined;
  };

  private assertCanResolveAskUserQuestion = async (
    userId: number,
    pending: TPendingAskUserQuestionRequest
  ) => {
    if (pending.scope.kind === 'dm') {
      if (pending.scope.userId !== userId) {
        throw new Error('ClaudeCode 问题已失效或已被回答');
      }

      return;
    }

    const canSend = await channelUserCan(
      pending.channelId,
      userId,
      ChannelPermission.SEND_MESSAGES
    );

    if (!canSend) {
      throw new Error('你没有权限回答这个频道里的 ClaudeCode 问题');
    }
  };

  public answerAskUserQuestionForUser = async (
    userId: number,
    requestId: string,
    answers: TClaudeCodeAskUserQuestionAnswers
  ) => {
    const found = this.findAskUserQuestionRequest(requestId);

    if (!found) {
      throw new Error('ClaudeCode 问题已失效或已被回答');
    }

    const { pending, session } = found;

    await this.assertCanResolveAskUserQuestion(userId, pending);

    const missingQuestion = pending.questions.find(
      (question) => !(question.question in answers)
    );

    if (missingQuestion) {
      throw new Error(`ClaudeCode 问题缺少回答: ${missingQuestion.header}`);
    }

    const answered = await this.completeAskUserQuestionRequest(
      session,
      requestId,
      'answered',
      answers,
      'ClaudeCode AskUserQuestion was answered in chat.'
    );

    if (!answered) {
      throw new Error('ClaudeCode 问题已失效或已被回答');
    }

    return { answered: true };
  };

  public cancelAskUserQuestionForUser = async (
    userId: number,
    requestId: string
  ) => {
    const found = this.findAskUserQuestionRequest(requestId);

    if (!found) {
      throw new Error('ClaudeCode 问题已失效或已被回答');
    }

    const { pending, session } = found;

    await this.assertCanResolveAskUserQuestion(userId, pending);

    const cancelled = await this.completeAskUserQuestionRequest(
      session,
      requestId,
      'cancelled',
      undefined,
      'The user cancelled the ClaudeCode question in chat.'
    );

    if (!cancelled) {
      throw new Error('ClaudeCode 问题已失效或已被回答');
    }

    return { cancelled: true };
  };

  public getMessageDetailsForHook = async (
    token: string,
    messageId: string
  ) => {
    const session = this.getSessionByHookToken(token);

    if (!session) return undefined;

    const messageRow = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.messageId, messageId))
      .get();

    if (!messageRow) return undefined;

    const message = await getMessage(messageRow.id);

    if (!message?.userId) return undefined;
    const agentUserId = await this.ensureAgentUser();

    if (session.channelId && message.channelId !== session.channelId) {
      return undefined;
    }

    if (session.scope.kind === 'dm') {
      if (
        message.userId !== session.scope.userId &&
        message.userId !== agentUserId
      ) {
        return undefined;
      }

      if (
        !(await this.isClaudeCodeDm(message.channelId, session.scope.userId))
      ) {
        return undefined;
      }
    } else {
      if (message.channelId !== session.scope.channelId) {
        return undefined;
      }
    }

    return {
      id: message.messageId,
      userId: message.userId,
      sender: message.userId === agentUserId ? CLAUDE_CODE_AGENT_NAME : 'user',
      channelId: message.channelId,
      createdAt: message.createdAt,
      time: formatClaudeMessageTime(message.createdAt),
      text: getPlainTextFromHtml(message.content ?? '').trim(),
      replyToMessageId: message.replyTo?.messageId ?? null,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.messageId,
            userId: message.replyTo.userId,
            sender:
              message.replyTo.userId === agentUserId
                ? CLAUDE_CODE_AGENT_NAME
                : 'user',
            text: getPlainTextFromHtml(message.replyTo.content ?? '').trim()
          }
        : null,
      files: message.files.map((file) => ({
        id: file.id,
        originalName: file.originalName,
        path: path.join(PUBLIC_PATH, file.name),
        size: file.size,
        mimeType: file.mimeType
      }))
    };
  };

  private resolveOutputFile = async (rawPath: string) => {
    const trimmed = rawPath.trim().replace(/^['"`]|['"`]$/g, '');

    if (!trimmed) return undefined;

    const candidate = path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(WORKSPACE_ROOT, trimmed);
    const stat = await fs.stat(candidate).catch(() => undefined);

    if (!stat?.isFile()) return undefined;

    const [realCandidate, realWorkspace, realData] = await Promise.all([
      fs.realpath(candidate),
      fs.realpath(WORKSPACE_ROOT),
      fs.realpath(DATA_PATH)
    ]);

    if (
      !isPathInside(realWorkspace, realCandidate) &&
      !isPathInside(realData, realCandidate)
    ) {
      return undefined;
    }

    return realCandidate;
  };

  private saveOutputFile = async (filePath: string) => {
    const agentUserId = await this.ensureAgentUser();
    const originalName = path.basename(filePath);
    const stat = await fs.stat(filePath);
    const safePath = await fileManager.getSafeUploadPath(originalName);

    await fs.copyFile(filePath, safePath);

    const tempFile = await fileManager.addTemporaryFile({
      originalName,
      filePath: safePath,
      size: stat.size,
      userId: agentUserId
    });

    return fileManager.saveFile(
      tempFile.id,
      agentUserId,
      FileSaveType.MESSAGE,
      originalName
    );
  };

  private attachFiles = async (messageId: number, files: TFile[]) => {
    for (const file of files) {
      try {
        await db.insert(messageFiles).values({
          messageId,
          fileId: file.id,
          createdAt: Date.now()
        });
      } catch {
        // ignore duplicate attachment rows
      }
    }
  };

  private buildStopHookResponse = (messageId?: string): TStopHookResponse =>
    messageId
      ? {
          suppressOutput: true,
          systemMessage: `ClaudeCode reply synced to chat. id: ${messageId}`
        }
      : { suppressOutput: true };

  public handleStopHook = async (token: string, input: TStopHookInput) => {
    const session = this.getSessionByHookToken(token);

    if (!session) return false;

    const channelId = session.channelId;

    if (!channelId) return this.buildStopHookResponse();

    const runId = session.runId ?? randomUUIDv7();
    const rawMessage = input.last_assistant_message?.trim() || '已完成。';
    const { summary, files } = splitFilesMarker(rawMessage);
    const savedFiles: TFile[] = [];

    for (const file of files) {
      const resolved = await this.resolveOutputFile(file);

      if (!resolved) {
        logger.warn('ClaudeCode output file was ignored: %s', file);
        continue;
      }

      savedFiles.push(await this.saveOutputFile(resolved));
    }

    let messageId = session.messageId;
    const content = toClaudeCodeMarkdownMessageHtml(summary);
    const metadata = this.withClaudeCodeTaskMetadata(
      messageId ? await this.getMessageMetadata(messageId) : [],
      runId,
      'completed'
    );

    if (messageId) {
      await db
        .update(messages)
        .set({
          content,
          metadata,
          updatedAt: Date.now()
        })
        .where(eq(messages.id, messageId));
    } else {
      const agentUserId = await this.ensureAgentUser();
      const inserted = await db
        .insert(messages)
        .values({
          channelId,
          userId: agentUserId,
          content,
          editable: false,
          metadata,
          createdAt: Date.now()
        })
        .returning()
        .get();

      messageId = inserted.id;
    }

    const syncedMessage = await getMessage(messageId);
    const syncedBusinessMessageId =
      syncedMessage?.messageId ?? createMessageBusinessId();

    await this.attachFiles(messageId, savedFiles);
    await publishMessage(
      messageId,
      channelId,
      session.messageId ? 'update' : 'create'
    );

    session.messageId = undefined;
    session.runId = undefined;
    session.status = {
      state: 'idle',
      connected: session.clients.size > 0,
      channelId,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    const hasQueuedGroupTrigger = this.scheduleQueuedGroupTrigger(session);

    if (session.clients.size === 0 && session.pty && !hasQueuedGroupTrigger) {
      session.stopping = true;
      session.pty.kill();
      session.pty = undefined;
    }

    return this.buildStopHookResponse(syncedBusinessMessageId);
  };

  public handleHookFailure = async (token: string, message: string) => {
    const session = this.getSessionByHookToken(token);

    if (!session?.channelId || !session.messageId) return false;

    const runId = session.runId ?? randomUUIDv7();
    await this.cancelPendingAskUserQuestions(
      session,
      'ClaudeCode hook failed before the question was answered.'
    );
    const metadata = await this.getMessageMetadata(session.messageId);

    await db
      .update(messages)
      .set({
        content: toMessageHtml(message),
        metadata: this.withClaudeCodeTaskMetadata(metadata, runId, 'failed'),
        updatedAt: Date.now()
      })
      .where(eq(messages.id, session.messageId));

    await publishMessage(session.messageId, session.channelId, 'update');

    session.status = {
      state: 'failed',
      connected: session.clients.size > 0,
      channelId: session.channelId,
      messageId: session.messageId,
      runId,
      lastError: message,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    return true;
  };

  public handlePtyConnection = async (
    ws: WebSocket,
    req: http.IncomingMessage
  ) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token') ?? undefined;
      const channelIdRaw = url.searchParams.get('channelId');
      const user = await getUserByToken(token);

      if (!user) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      await this.ensureAgentUser();

      let session: TClaudeCodeSession;

      if (channelIdRaw) {
        const channelId = Number(channelIdRaw);

        if (!Number.isInteger(channelId) || channelId <= 0) {
          ws.close(1008, 'Invalid channel');
          return;
        }

        if (await isDirectMessageChannel(channelId)) {
          ws.close(1008, 'Unsupported channel');
          return;
        }

        const canSend = await channelUserCan(
          channelId,
          user.id,
          ChannelPermission.SEND_MESSAGES
        );

        if (!canSend) {
          ws.close(1008, 'Forbidden');
          return;
        }

        session = await this.ensureSessionForScope(
          createChannelScope(channelId)
        );
        session.channelId = channelId;
      } else {
        session = await this.ensureSession(user.id);
      }

      session.clients.add(ws);
      sendJson(ws, { type: 'status', status: getStatus(session) });

      if (session.output) {
        sendJson(ws, { type: 'output', data: session.output });
      }

      this.publishStatus(session);

      ws.on('message', async (raw) => {
        try {
          const data = JSON.parse(raw.toString()) as
            | { type: 'input'; data: string }
            | { type: 'resize'; cols: number; rows: number };
          const targetSession =
            session.scope.kind === 'channel'
              ? await this.ensureSessionForScope(session.scope)
              : await this.ensureSession(user.id);

          if (data.type === 'input') {
            targetSession.pty?.write(data.data);
          } else if (data.type === 'resize') {
            targetSession.pty?.resize(data.cols, data.rows);
          }
        } catch (error) {
          logger.error(
            'ClaudeCode PTY message error: %s',
            getErrorMessage(error)
          );
        }
      });

      ws.on('close', () => {
        session.clients.delete(ws);
        this.publishStatus(session);
      });
    } catch (error) {
      logger.error(
        'ClaudeCode PTY connection error: %s',
        getErrorMessage(error)
      );
      sendJson(ws, {
        type: 'status',
        status: {
          state: 'failed',
          connected: false,
          lastError: getErrorMessage(error),
          updatedAt: Date.now()
        }
      });
      ws.close(1011, 'ClaudeCode failed');
    }
  };
}

const claudeCodeAgentManager = new ClaudeCodeAgentManager();

const createClaudeCodePtyWebSocketServer = () => {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    void claudeCodeAgentManager.handlePtyConnection(ws, req);
  });

  return wss;
};

export {
  CLAUDE_CODE_AGENT_IDENTITY,
  CLAUDE_CODE_AGENT_NAME,
  CLAUDE_CODE_ASK_USER_QUESTION_HOOK_PATH,
  CLAUDE_CODE_PTY_PATH,
  CLAUDE_CODE_STOP_HOOK_PATH,
  claudeCodeAgentManager,
  createClaudeCodePtyWebSocketServer
};
