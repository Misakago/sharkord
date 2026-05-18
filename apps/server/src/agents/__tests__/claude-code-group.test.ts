import { ChannelType } from '@mikotord/shared';
import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { tdb } from '../../__tests__/setup';
import { channels, files, messages, users } from '../../db/schema';
import { DATA_PATH } from '../../helpers/paths';
import { claudeCodeAgentManager } from '../claude-code';

type TPromptCaptureManager = {
  sessions: Map<string, any>;
  agentUserId?: number;
  ensureSessionForScope: (scope: any) => Promise<any>;
  getSessionForScope: (scope: any) => any;
  writePrompt: (session: any, prompt: string) => Promise<void>;
};

const manager = () =>
  claudeCodeAgentManager as unknown as TPromptCaptureManager;

const createFakePty = () => ({
  write: () => undefined,
  resize: () => undefined,
  onData: () => undefined,
  onExit: () => undefined,
  kill: () => undefined
});

const resetClaudeCodeManagerForTest = () => {
  const target = manager();

  target.sessions.clear();
  target.agentUserId = undefined;
};

const clearClaudeCodeStateForTest = async () => {
  resetClaudeCodeManagerForTest();
  await fs.rm(path.join(DATA_PATH, 'claude-code'), {
    recursive: true,
    force: true
  });
};

const withCapturedPrompts = async (
  fn: (prompts: string[]) => Promise<void>
) => {
  const target = manager();
  const originalEnsureSessionForScope = target.ensureSessionForScope;
  const originalWritePrompt = target.writePrompt;
  const prompts: string[] = [];

  await clearClaudeCodeStateForTest();

  target.ensureSessionForScope = async (scope: any) => {
    const session = target.getSessionForScope(scope);

    session.pty ??= createFakePty();

    return session;
  };
  target.writePrompt = async (_session: any, prompt: string) => {
    prompts.push(prompt);
  };

  try {
    await fn(prompts);
  } finally {
    target.ensureSessionForScope = originalEnsureSessionForScope;
    target.writePrompt = originalWritePrompt;
    await clearClaudeCodeStateForTest();
  }
};

const parsePromptPayload = (prompt: string) => {
  const match = /```json\n([\s\S]*)\n```/.exec(prompt);

  if (!match?.[1]) {
    throw new Error(`Prompt did not contain a JSON payload: ${prompt}`);
  }

  return JSON.parse(match[1]) as {
    scope: { type: string; channel_id?: number; user_id?: number };
    messages: Array<{
      user_id: number;
      message_id: string;
      text: string;
      files: string[];
    }>;
  };
};

const insertMessage = async (
  channelId: number,
  userId: number,
  content: string
) =>
  tdb
    .insert(messages)
    .values({
      channelId,
      userId,
      content,
      editable: true,
      createdAt: Date.now()
    })
    .returning()
    .get();

const createIsolatedTextChannel = async (name: string) =>
  tdb
    .insert(channels)
    .values({
      type: ChannelType.TEXT,
      name,
      topic: null,
      private: false,
      isDm: false,
      position: 10,
      categoryId: 1,
      createdAt: Date.now()
    })
    .returning()
    .get();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForPromptCount = async (prompts: string[], count: number) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (prompts.length >= count) return;

    await sleep(20);
  }

  throw new Error(`Timed out waiting for ${count} captured prompts`);
};

describe('ClaudeCode group chat injection', () => {
  test('ensures ClaudeCode agent user has the static mascot avatar', async () => {
    await clearClaudeCodeStateForTest();

    const agentUserId = await claudeCodeAgentManager.ensureAgentUser();
    const agentUser = await tdb
      .select()
      .from(users)
      .where(eq(users.id, agentUserId))
      .get();

    expect(typeof agentUser?.avatarId).toBe('number');

    const avatar = await tdb
      .select()
      .from(files)
      .where(eq(files.id, agentUser!.avatarId!))
      .get();

    expect(avatar?.originalName).toBe('claude-code-avatar.png');
    expect(avatar?.mimeType).toBe('image/png');
  });

  test('does not inject group messages without an @claude trigger', async () => {
    await withCapturedPrompts(async (prompts) => {
      const channel = await createIsolatedTextChannel('no-trigger');
      const message = await insertMessage(channel.id, 1, '<p>hello</p>');

      await claudeCodeAgentManager.handleCreatedMessage(message.id);

      expect(prompts).toHaveLength(0);
    });
  });

  test('injects from the beginning of the channel on first plain-text trigger', async () => {
    await withCapturedPrompts(async (prompts) => {
      const channel = await createIsolatedTextChannel('plain-trigger');

      await insertMessage(channel.id, 1, '<p>A hello</p>');
      await insertMessage(channel.id, 2, '<p>B hello</p>');
      await insertMessage(channel.id, 3, '<p>C 出方案</p>');
      const trigger = await insertMessage(
        channel.id,
        1,
        '<p>@claude 按照 C 的要求出方案</p>'
      );

      await claudeCodeAgentManager.handleCreatedMessage(trigger.id);

      expect(prompts).toHaveLength(1);

      const payload = parsePromptPayload(prompts[0]!);

      expect(payload.scope).toEqual({
        type: 'channel',
        channel_id: channel.id
      });
      expect(payload.messages.map((message) => message.user_id)).toEqual([
        1, 2, 3, 1
      ]);
      expect(payload.messages.map((message) => message.text)).toEqual([
        'A hello',
        'B hello',
        'C 出方案',
        '@claude 按照 C 的要求出方案'
      ]);
    });
  });

  test('supports mention-chip triggers', async () => {
    await withCapturedPrompts(async (prompts) => {
      const agentUserId = await claudeCodeAgentManager.ensureAgentUser();
      const channel = await createIsolatedTextChannel('mention-trigger');
      const trigger = await insertMessage(
        channel.id,
        2,
        `<p><span data-type="mention" data-user-id="${agentUserId}" class="mention">@ClaudeCode</span> 处理一下</p>`
      );

      await claudeCodeAgentManager.handleCreatedMessage(trigger.id);

      expect(prompts).toHaveLength(1);
      expect(parsePromptPayload(prompts[0]!).messages[0]?.user_id).toBe(2);
    });
  });

  test('only injects incremental human messages after the first group trigger', async () => {
    await withCapturedPrompts(async (prompts) => {
      const channel = await createIsolatedTextChannel('incremental');
      const firstTrigger = await insertMessage(
        channel.id,
        1,
        '<p>@claude 先处理</p>'
      );

      await claudeCodeAgentManager.handleCreatedMessage(firstTrigger.id);

      const session = manager().sessions.get(`channel:${channel.id}`);

      session.status = {
        state: 'idle',
        connected: false,
        channelId: channel.id,
        updatedAt: Date.now()
      };
      session.messageId = undefined;
      session.runId = undefined;

      await insertMessage(channel.id, 1, '<p>A ok</p>');
      await insertMessage(channel.id, 2, '<p>B no</p>');
      const secondTrigger = await insertMessage(
        channel.id,
        3,
        '<p>@claude 按照 B 的要求改下</p>'
      );

      await claudeCodeAgentManager.handleCreatedMessage(secondTrigger.id);

      expect(prompts).toHaveLength(2);

      const secondPayload = parsePromptPayload(prompts[1]!);

      expect(secondPayload.messages.map((message) => message.text)).toEqual([
        'A ok',
        'B no',
        '@claude 按照 B 的要求改下'
      ]);
    });
  });

  test('merges busy group triggers and injects the queued increment after stop', async () => {
    await withCapturedPrompts(async (prompts) => {
      const channel = await createIsolatedTextChannel('busy-queue');
      const firstTrigger = await insertMessage(
        channel.id,
        1,
        '<p>@claude 先处理</p>'
      );

      await claudeCodeAgentManager.handleCreatedMessage(firstTrigger.id);

      const session = manager().sessions.get(`channel:${channel.id}`);

      await insertMessage(channel.id, 1, '<p>A ok</p>');
      const queuedOne = await insertMessage(
        channel.id,
        2,
        '<p>@claude 第一条排队</p>'
      );
      const queuedTwo = await insertMessage(
        channel.id,
        3,
        '<p>@claude 第二条排队</p>'
      );

      await claudeCodeAgentManager.handleCreatedMessage(queuedOne.id);
      await claudeCodeAgentManager.handleCreatedMessage(queuedTwo.id);

      expect(prompts).toHaveLength(1);
      expect(session.pendingGroupTriggerMessageId).toBe(queuedTwo.id);

      await claudeCodeAgentManager.handleStopHook(session.hookToken, {
        last_assistant_message: 'done'
      });
      await waitForPromptCount(prompts, 2);

      const queuedPayload = parsePromptPayload(prompts[1]!);

      expect(queuedPayload.messages.map((message) => message.text)).toEqual([
        'A ok',
        '@claude 第一条排队',
        '@claude 第二条排队'
      ]);
    });
  });

  test('keeps ClaudeCode DM messages triggerable without @claude', async () => {
    await withCapturedPrompts(async (prompts) => {
      const { channelId } = await claudeCodeAgentManager.openDirectMessage(1);
      const message = await insertMessage(channelId, 1, '<p>直接处理</p>');

      await claudeCodeAgentManager.handleCreatedMessage(message.id);

      expect(prompts).toHaveLength(1);
      expect(parsePromptPayload(prompts[0]!).scope).toEqual({
        type: 'dm',
        user_id: 1
      });
    });
  });

  test('allows only users with channel send permission to answer group questions', async () => {
    await clearClaudeCodeStateForTest();

    const agentUserId = await claudeCodeAgentManager.ensureAgentUser();
    const taskMessage = await tdb
      .insert(messages)
      .values({
        channelId: 1,
        userId: agentUserId,
        content: '',
        editable: false,
        metadata: [],
        createdAt: Date.now()
      })
      .returning()
      .get();
    const session = {
      scope: {
        kind: 'channel',
        key: 'channel:1',
        storageKey: 'channel-1',
        channelId: 1
      },
      clients: new Set(),
      askUserQuestionRequests: new Map(),
      hookToken: crypto.randomUUID(),
      settingsPath: '',
      output: '',
      runId: crypto.randomUUID(),
      channelId: 1,
      messageId: taskMessage.id,
      status: {
        state: 'running',
        connected: false,
        updatedAt: Date.now()
      }
    };

    manager().sessions.set(session.scope.key, session);

    const responsePromise = claudeCodeAgentManager.handleAskUserQuestionHook(
      session.hookToken,
      {
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: [
            {
              question: '继续吗？',
              header: '确认',
              options: [{ label: '是' }, { label: '否' }]
            }
          ]
        }
      }
    );

    await sleep(20);
    await tdb.update(channels).set({ private: true }).where(eq(channels.id, 1));

    const requestId = [...session.askUserQuestionRequests.keys()][0]!;

    await expect(
      claudeCodeAgentManager.answerAskUserQuestionForUser(2, requestId, {
        '继续吗？': '是'
      })
    ).rejects.toThrow('权限');

    await claudeCodeAgentManager.answerAskUserQuestionForUser(1, requestId, {
      '继续吗？': '是'
    });

    const response = await responsePromise;

    expect(response?.hookSpecificOutput.permissionDecision).toBe('allow');

    await clearClaudeCodeStateForTest();
  });
});
