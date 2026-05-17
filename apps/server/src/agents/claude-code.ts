import {
  ChannelType,
  FileSaveType,
  ServerEvents,
  getErrorMessage,
  getPlainTextFromHtml,
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
import { randomUUID } from 'crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from '../config';
import { db } from '../db';
import { publishChannelPermissions, publishMessage } from '../db/publishers';
import {
  getDirectMessageChannel,
  getDirectMessageChannelParticipantIds,
  normalizePair
} from '../db/queries/dms';
import { getMessage } from '../db/queries/messages';
import {
  getUserByIdentity,
  getUserByToken
} from '../db/queries/users';
import { channels, directMessages, messageFiles, messages, users } from '../db/schema';
import { DATA_PATH, PUBLIC_PATH } from '../helpers/paths';
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

type TClaudeCodeSession = {
  userId: number;
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

type TClaudeCodeMessageSnapshot = {
  messages: (typeof messages.$inferSelect)[];
  messageFiles: (typeof messageFiles.$inferSelect)[];
};

type TStopHookInput = {
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  transcript_path?: string;
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
  userId: number;
  runId: string;
  channelId: number;
  messageId: number;
  questions: TClaudeCodeAskUserQuestion[];
  timeout: ReturnType<typeof setTimeout>;
  resolve: (response: TAskUserQuestionHookResponse) => void;
};

const CLAUDE_CODE_AGENT_IDENTITY = 'agent:claude-code';
const CLAUDE_CODE_AGENT_NAME = 'ClaudeCode';
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
const getClaudeSessionPath = (userId: number) =>
  path.join(DATA_PATH, 'claude-code', `${userId}.session.json`);
const getClaudeChatSessionsPath = (userId: number) =>
  path.join(DATA_PATH, 'claude-code', `${userId}.chat-sessions.json`);
const getClaudeChatSessionMessagesPath = (userId: number, chatSessionId: string) =>
  path.join(DATA_PATH, 'claude-code', `${userId}.${chatSessionId}.messages.json`);
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

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
      throw new Error(`AskUserQuestion question ${questionIndex + 1} is invalid`);
    }

    const { question, header, options, multiSelect } = rawQuestion;

    if (typeof question !== 'string' || !question.trim()) {
      throw new Error(`AskUserQuestion question ${questionIndex + 1} has no text`);
    }

    if (typeof header !== 'string' || !header.trim()) {
      throw new Error(`AskUserQuestion question ${questionIndex + 1} has no header`);
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

const normalizePtyInputLineEndings = (value: string) =>
  value.replace(/\r\n?/g, '\n');

const normalizeClaudePromptLine = (value: string) =>
  normalizePtyInputLineEndings(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

const toPtySubmitPayload = (
  rawText: string,
  options: { bracketedPaste: boolean }
) => {
  const text = normalizePtyInputLineEndings(rawText);
  const isMultiline = text.includes('\n');

  if (isMultiline && options.bracketedPaste) {
    return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}\r`;
  }

  return `${text}\r`;
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
  const child = spawnChildProcess(CLAUDE_CODE_NODE_COMMAND, [PTY_HELPER_PATH, payload], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
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
  private sessions = new Map<number, TClaudeCodeSession>();
  private agentUserId: number | undefined;

  public getAgentIdentity = () => CLAUDE_CODE_AGENT_IDENTITY;

  public getAgentName = () => CLAUDE_CODE_AGENT_NAME;

  public getPtyPath = () => CLAUDE_CODE_PTY_PATH;

  public ensureAgentUser = async () => {
    if (this.agentUserId) return this.agentUserId;

    const existing = await getUserByIdentity(CLAUDE_CODE_AGENT_IDENTITY);

    if (existing) {
      this.agentUserId = existing.id;

      if (existing.name !== CLAUDE_CODE_AGENT_NAME || existing.banned) {
        await db
          .update(users)
          .set({
            name: CLAUDE_CODE_AGENT_NAME,
            banned: false,
            updatedAt: Date.now()
          })
          .where(eq(users.id, existing.id));
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

    this.agentUserId = user.id;

    return user.id;
  };

  public getStatusForUser = async (userId: number): Promise<TClaudeCodeStatus> => {
    const session = this.sessions.get(userId);

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

    pubsub.publishFor([userId, agentUserId], ServerEvents.CHANNEL_CREATE, channel);
    pubsub.publishFor([userId, agentUserId], ServerEvents.DM_CONVERSATION_OPEN, {
      channelId: channel.id
    });

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

    pubsub.publishFor(session.userId, ServerEvents.CLAUDE_CODE_STATUS, session.status);

    for (const client of session.clients) {
      sendJson(client, { type: 'status', status: session.status });
    }
  };

  private getSessionByHookToken = (token: string) =>
    Array.from(this.sessions.values()).find((item) => item.hookToken === token);

  private getSession = (userId: number) => {
    let session = this.sessions.get(userId);

    if (!session) {
      const hookToken = randomUUIDv7();
      const settingsPath = path.join(DATA_PATH, 'claude-code', `${userId}.settings.json`);

      session = {
        userId,
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

      this.sessions.set(userId, session);
    }

    return session;
  };

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

  private getSystemPrompt = (session: TClaudeCodeSession) =>
    [
      '你是聊天室内置的 ClaudeCode Agent。',
      `当前唯一聊天用户 ID: ${session.userId}。这是稳定上下文，不需要用户每条消息重复提供。`,
      'TTY stdin 注入内容只包含聊天气泡原文和 message_id；不要把系统字段当作用户正文。',
      `如需消息时间、附件路径、发送者等详细信息，使用本地接口查询: curl -s "http://127.0.0.1:${config.server.port}${CLAUDE_CODE_MESSAGE_LOOKUP_PATH}/<message_id>?token=${session.hookToken}"。`,
      '优先遵循项目 CLAUDE.md 中的 Agent 行为约束。',
      '完成后只输出简洁回复；如果有输出产物，在最终回复末尾追加 @files(path1,path2)，只列真实存在的文件路径。',
      '不要把长篇日志、过程推理或无关命令输出放进最终回复。'
    ].join('\n');

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

  private readChatSessions = async (
    userId: number
  ): Promise<TClaudeCodeChatSessionRecord[]> => {
    try {
      const records = JSON.parse(
        await fs.readFile(getClaudeChatSessionsPath(userId), 'utf8')
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
    userId: number,
    records: TClaudeCodeChatSessionRecord[]
  ) => {
    const sessionsPath = getClaudeChatSessionsPath(userId);

    await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
    await fs.writeFile(sessionsPath, JSON.stringify(records, null, 2));
  };

  private upsertChatSession = async (
    userId: number,
    record: TClaudeCodeChatSessionRecord
  ) => {
    const records = await this.readChatSessions(userId);
    const index = records.findIndex((item) => item.id === record.id);

    if (index >= 0) {
      records[index] = record;
    } else {
      records.push(record);
    }

    await this.writeChatSessions(userId, records);
  };

  private markChatSessionReady = async (
    userId: number,
    chatSessionId: string,
    claudeSessionId?: string
  ) => {
    const records = await this.readChatSessions(userId);
    const record = records.find((item) => item.id === chatSessionId);

    if (!record?.readyAt) {
      await this.upsertChatSession(userId, {
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

  private hasChatSessionSnapshot = async (userId: number, chatSessionId: string) =>
    Boolean(
      await fs
        .stat(getClaudeChatSessionMessagesPath(userId, chatSessionId))
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

  private createChatSessionRecord = async (userId: number) => {
    const record = this.buildChatSessionRecord();

    await this.upsertChatSession(userId, record);

    return record;
  };

  private setCurrentChatSession = async (
    session: TClaudeCodeSession,
    record: TClaudeCodeChatSessionRecord,
    shouldResume: boolean
  ) => {
    const sessionPath = getClaudeSessionPath(session.userId);
    const updatedRecord = {
      ...record,
      updatedAt: Date.now()
    };

    await this.upsertChatSession(session.userId, updatedRecord);
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(
      sessionPath,
      JSON.stringify(
        {
          chatSessionId: updatedRecord.id,
          claudeSessionId: updatedRecord.claudeSessionId,
          readyAt: updatedRecord.readyAt,
          updatedAt: updatedRecord.updatedAt
        },
        null,
        2
      )
    );

    session.chatSessionId = updatedRecord.id;
    session.claudeSessionId = updatedRecord.claudeSessionId;
    session.shouldResumeClaudeSession = shouldResume;
  };

  private rebindClaudeSession = async (userId: number, chatSessionId?: string) => {
    const records = await this.readChatSessions(userId);
    const now = Date.now();
    const existing = chatSessionId
      ? records.find((record) => record.id === chatSessionId)
      : undefined;
    const record: TClaudeCodeChatSessionRecord = existing
      ? (({ readyAt: _readyAt, ...rest }) => ({
          ...rest,
          claudeSessionId: randomUUID(),
          updatedAt: now
        }))(existing)
      : {
          id: randomUUID(),
          claudeSessionId: randomUUID(),
          createdAt: now,
          updatedAt: now
        };

    await this.upsertChatSession(userId, record);

    return record;
  };

  private getCurrentChatSessionId = async (
    userId: number,
    session?: TClaudeCodeSession
  ) =>
    session?.chatSessionId ??
    (await fs
      .readFile(getClaudeSessionPath(userId), 'utf8')
      .then(
        (value) => (JSON.parse(value) as { chatSessionId?: string }).chatSessionId
      )
      .catch(() => undefined));

  private snapshotChatSessionMessages = async (
    userId: number,
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
    const snapshotPath = getClaudeChatSessionMessagesPath(userId, chatSessionId);

    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));

    const records = await this.readChatSessions(userId);
    const record = records.find((item) => item.id === chatSessionId);

    if (record) {
      await this.upsertChatSession(userId, {
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
    userId: number,
    channelId: number,
    chatSessionId: string
  ) => {
    const snapshot = await fs
      .readFile(getClaudeChatSessionMessagesPath(userId, chatSessionId), 'utf8')
      .then((value) => JSON.parse(value) as TClaudeCodeMessageSnapshot)
      .catch(() => undefined);

    if (!snapshot?.messages?.length) return;

    await db.insert(messages).values(snapshot.messages);

    if (snapshot.messageFiles?.length) {
      await db.insert(messageFiles).values(snapshot.messageFiles);
    }

    for (const message of snapshot.messages) {
      await publishMessage(message.id, channelId, 'create');
    }
  };

  private switchChatSessionMessages = async ({
    userId,
    channelId,
    fromChatSessionId,
    toChatSessionId,
    restore
  }: {
    userId: number;
    channelId: number;
    fromChatSessionId?: string;
    toChatSessionId: string;
    restore: boolean;
  }) => {
    if (fromChatSessionId === toChatSessionId) return;

    await this.snapshotChatSessionMessages(userId, channelId, fromChatSessionId);
    await this.clearChannelMessages(channelId);

    if (restore) {
      await this.restoreChatSessionMessages(userId, channelId, toChatSessionId);
    }
  };

  private waitForClaudeSessionBinding = async (
    session: TClaudeCodeSession,
    _claudeSessionId: string
  ) => {
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
    if (session.chatSessionId && session.claudeSessionId) {
      if (
        session.shouldResumeClaudeSession &&
        !(await isClaudeSessionAvailable(session.claudeSessionId))
      ) {
        const record = await this.rebindClaudeSession(
          session.userId,
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

    const sessionPath = getClaudeSessionPath(session.userId);

    try {
      const record = JSON.parse(await fs.readFile(sessionPath, 'utf8')) as {
        chatSessionId?: string;
        claudeSessionId?: string;
        sessionId?: string;
        createdAt?: number;
        updatedAt?: number;
      };

      if (record.chatSessionId && record.claudeSessionId) {
        const records = await this.readChatSessions(session.userId);
        let chatSession =
          records.find((item) => item.id === record.chatSessionId) ?? {
            id: record.chatSessionId,
            claudeSessionId: record.claudeSessionId,
            createdAt: record.createdAt ?? Date.now(),
            updatedAt: record.updatedAt ?? Date.now()
          };

        if (
          !chatSession.readyAt &&
          !(await this.hasChatSessionSnapshot(session.userId, chatSession.id)) &&
          !(await isClaudeSessionAvailable(chatSession.claudeSessionId))
        ) {
          chatSession = await this.rebindClaudeSession(
            session.userId,
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
        const chatSession = await this.createChatSessionRecord(session.userId);
        const migratedRecord = {
          ...chatSession,
          claudeSessionId: available ? record.sessionId : chatSession.claudeSessionId
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

    const chatSession = await this.createChatSessionRecord(session.userId);

    await this.setCurrentChatSession(session, chatSession, false);

    return { sessionId: chatSession.claudeSessionId, resume: false };
  };

  private resetClaudeSession = async (session: TClaudeCodeSession) => {
    const record = await this.rebindClaudeSession(
      session.userId,
      session.chatSessionId
    );

    await this.setCurrentChatSession(session, record, false);

    return record.claudeSessionId;
  };

  public listClaudeSessionsForUser = async (userId: number) => {
    await this.ensureAgentUser();

    const currentSession = this.sessions.get(userId);
    const currentRecord = await fs
      .readFile(getClaudeSessionPath(userId), 'utf8')
      .then(
        (value) =>
          JSON.parse(value) as {
            chatSessionId?: string;
            claudeSessionId?: string;
            sessionId?: string;
            createdAt?: number;
            updatedAt?: number;
            readyAt?: number;
          }
      )
      .catch(() => undefined);
    let currentChatSessionId =
      currentSession?.chatSessionId ?? currentRecord?.chatSessionId;
    let chatSessions = await this.readChatSessions(userId);

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

      await this.upsertChatSession(userId, migratedRecord);
      await fs.writeFile(
        getClaudeSessionPath(userId),
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

      await this.upsertChatSession(userId, migratedRecord);
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
            (await this.hasChatSessionSnapshot(userId, record.id)) ||
            (await isClaudeSessionAvailable(record.claudeSessionId))
        };
      })
    );

    return sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30);
  };

  public startNewClaudeSessionForUser = async (userId: number) => {
    const session = this.getSession(userId);
    const { channelId } = await this.openDirectMessage(userId);
    const previousChatSessionId = await this.getCurrentChatSessionId(userId, session);
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
      await this.waitForClaudeSessionBinding(session, chatSession.claudeSessionId);
    } catch (error) {
      if (session.pty) {
        session.stopping = true;
        session.pty.kill();
        session.pty = undefined;
      }

      session.chatSessionId = previousState.chatSessionId;
      session.claudeSessionId = previousState.claudeSessionId;
      session.shouldResumeClaudeSession = previousState.shouldResumeClaudeSession;
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
      userId,
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
    const records = await this.readChatSessions(userId);
    let chatSession = records.find((record) => record.id === chatSessionId);

    if (!chatSession) {
      throw new Error('ClaudeCode 聊天室历史会话不存在');
    }

    const session = this.getSession(userId);
    const { channelId } = await this.openDirectMessage(userId);
    const previousChatSessionId = await this.getCurrentChatSessionId(userId, session);
    let rebound = false;

    if (
      !chatSession.readyAt &&
      !(await this.hasChatSessionSnapshot(userId, chatSession.id)) &&
      !(await isClaudeSessionAvailable(chatSession.claudeSessionId))
    ) {
      chatSession = await this.rebindClaudeSession(userId, chatSession.id);
      rebound = true;
    }

    await this.switchChatSessionMessages({
      userId,
      channelId,
      fromChatSessionId: previousChatSessionId,
      toChatSessionId: chatSession.id,
      restore: true
    });
    await this.setCurrentChatSession(session, chatSession, !rebound);

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
    const session = this.sessions.get(userId);
    const currentChatSessionId = await this.getCurrentChatSessionId(userId, session);

    if (chatSessionId === currentChatSessionId) {
      throw new Error('无法删除正在使用的 ClaudeCode 会话，请先切换到其他会话');
    }

    const records = await this.readChatSessions(userId);
    const target = records.find((record) => record.id === chatSessionId);

    if (!target) {
      throw new Error('ClaudeCode 聊天室历史会话不存在');
    }

    await this.writeChatSessions(
      userId,
      records.filter((record) => record.id !== chatSessionId)
    );
    await fs.rm(getClaudeChatSessionMessagesPath(userId, chatSessionId), {
      force: true
    });
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
          session.userId,
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

  private ensureSession = async (userId: number) => {
    const session = this.getSession(userId);

    if (session.pty) return session;

    if (!session.starting) {
      session.starting = this.startSession(session).finally(() => {
        session.starting = undefined;
      });
    }

    await session.starting;

    return session;
  };

  public stopSessionForUser = async (userId: number) => {
    const session = this.sessions.get(userId);

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
    const { channelId } = await this.getDirectMessageForUser(userId);

    if (!channelId) {
      return { cleared: false, deletedMessages: 0 };
    }

    const session = this.sessions.get(userId);

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

    const sessionPath = getClaudeSessionPath(userId);

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
    const participantIds = await getDirectMessageChannelParticipantIds(channelId);

    return participantIds.includes(userId) && participantIds.includes(agentUserId);
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

  private buildPrompt = async (message: TJoinedMessage) => {
    const text = normalizeClaudePromptLine(
      getPlainTextFromHtml(message.content ?? '').trim()
    );
    const filePaths = message.files.map((file) => path.join(PUBLIC_PATH, file.name));
    const metadata = [
      `message_id: ${message.id}`,
      filePaths.length > 0 ? `files: ${filePaths.join(', ')}` : undefined
    ]
      .filter(Boolean)
      .join(' | ');

    return [text, metadata]
      .filter(Boolean)
      .join(' | ');
  };

  private writePrompt = (session: TClaudeCodeSession, prompt: string) => {
    if (!session.pty) {
      throw new Error('Claude Code PTY is not running');
    }

    session.pty.write(
      `\x15${toPtySubmitPayload(prompt, {
        bracketedPaste: false
      })}`
    );
  };

  public handleCreatedMessage = async (messageId: number) => {
    const message = await getMessage(messageId);

    if (!message?.userId) return;

    const agentUserId = await this.ensureAgentUser();

    if (message.userId === agentUserId) return;
    if (!(await this.isClaudeCodeDm(message.channelId, message.userId))) return;

    const session = await this.ensureSession(message.userId);
    const hasRunningMessage = session.status.state === 'running' && session.messageId;
    const runId = hasRunningMessage ? session.runId! : randomUUIDv7();

    session.runId = runId;
    session.channelId = message.channelId;

    if (!hasRunningMessage) {
      session.messageId = await this.createProcessingMessage(message.channelId, runId);
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

    this.writePrompt(session, await this.buildPrompt(message));
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
      pending.resolve(buildAskUserQuestionAllowResponse(pending.questions, answers));
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
      userId: session.userId,
      runId,
      channelId: session.channelId,
      messageId: session.messageId,
      questions
    };
    let resolveRequest!: (response: TAskUserQuestionHookResponse) => void;
    const responsePromise = new Promise<TAskUserQuestionHookResponse>((resolve) => {
      resolveRequest = resolve;
    });
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

  public answerAskUserQuestionForUser = async (
    userId: number,
    requestId: string,
    answers: TClaudeCodeAskUserQuestionAnswers
  ) => {
    const session = this.sessions.get(userId);

    if (!session) {
      throw new Error('ClaudeCode 会话不存在');
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
    const session = this.sessions.get(userId);

    if (!session) {
      throw new Error('ClaudeCode 会话不存在');
    }

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

  public getMessageDetailsForHook = async (token: string, messageId: number) => {
    const session = this.getSessionByHookToken(token);

    if (!session) return undefined;

    const message = await getMessage(messageId);

    if (!message?.userId) return undefined;
    if (message.userId !== session.userId) return undefined;
    if (!(await this.isClaudeCodeDm(message.channelId, message.userId))) {
      return undefined;
    }

    return {
      id: message.id,
      userId: message.userId,
      channelId: message.channelId,
      createdAt: message.createdAt,
      time: formatClaudeMessageTime(message.createdAt),
      text: getPlainTextFromHtml(message.content ?? '').trim(),
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

    if (!isPathInside(realWorkspace, realCandidate) && !isPathInside(realData, realCandidate)) {
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

  public handleStopHook = async (token: string, input: TStopHookInput) => {
    const session = this.getSessionByHookToken(token);

    if (!session) return false;

    const channelId = session.channelId;

    if (!channelId) return true;

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
    const content = toMessageHtml(summary);
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

    await this.attachFiles(messageId, savedFiles);
    await publishMessage(messageId, channelId, session.messageId ? 'update' : 'create');

    session.messageId = undefined;
    session.runId = undefined;
    session.status = {
      state: 'idle',
      connected: session.clients.size > 0,
      channelId,
      updatedAt: Date.now()
    };
    this.publishStatus(session);

    if (session.clients.size === 0 && session.pty) {
      session.stopping = true;
      session.pty.kill();
      session.pty = undefined;
    }

    return true;
  };

  public handleHookFailure = async (token: string, message: string) => {
    const session = Array.from(this.sessions.values()).find(
      (item) => item.hookToken === token
    );

    if (!session?.channelId || !session.messageId) return false;

    const runId = session.runId ?? randomUUIDv7();

    await db
      .update(messages)
      .set({
        content: toMessageHtml(message),
        metadata: [
          {
            kind: 'claude_code_task',
            runId,
            status: 'failed'
          }
        ],
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

  public handlePtyConnection = async (ws: WebSocket, req: http.IncomingMessage) => {
    try {
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token') ?? undefined;
      const user = await getUserByToken(token);

      if (!user) {
        ws.close(1008, 'Unauthorized');
        return;
      }

      await this.ensureAgentUser();

      const session = await this.ensureSession(user.id);

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
          const targetSession = await this.ensureSession(user.id);

          if (data.type === 'input') {
            targetSession.pty?.write(data.data);
          } else if (data.type === 'resize') {
            targetSession.pty?.resize(data.cols, data.rows);
          }
        } catch (error) {
          logger.error('ClaudeCode PTY message error: %s', getErrorMessage(error));
        }
      });

      ws.on('close', () => {
        session.clients.delete(ws);
        this.publishStatus(session);
      });
    } catch (error) {
      logger.error('ClaudeCode PTY connection error: %s', getErrorMessage(error));
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
  CLAUDE_CODE_PTY_PATH,
  CLAUDE_CODE_STOP_HOOK_PATH,
  claudeCodeAgentManager,
  createClaudeCodePtyWebSocketServer
};
