import { describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { tdb } from '../../__tests__/setup';
import { messages } from '../../db/schema';
import { claudeCodeAgentManager } from '../claude-code';

type TTestSession = {
  userId: number;
  clients: Set<unknown>;
  askUserQuestionRequests: Map<string, unknown>;
  hookToken: string;
  settingsPath: string;
  output: string;
  runId: string;
  channelId: number;
  messageId: number;
  status: {
    state: 'running' | 'waiting_for_user';
    connected: boolean;
    updatedAt: number;
  };
};

const getManagerSessions = () =>
  (
    claudeCodeAgentManager as unknown as {
      sessions: Map<number, TTestSession>;
    }
  ).sessions;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (predicate: () => boolean) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;

    await sleep(10);
  }

  throw new Error('Timed out waiting for ClaudeCode AskUserQuestion test state');
};

const withTimeout = async <T>(promise: Promise<T>) =>
  Promise.race([
    promise,
    sleep(500).then(() => {
      throw new Error('Timed out waiting for ClaudeCode hook response');
    })
  ]);

const createTestSession = async () => {
  const userId = 90_001 + Math.floor(Math.random() * 10_000);
  const runId = crypto.randomUUID();
  const hookToken = crypto.randomUUID();
  const message = await tdb
    .insert(messages)
    .values({
      channelId: 1,
      userId: 1,
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
  const session: TTestSession = {
    userId,
    clients: new Set(),
    askUserQuestionRequests: new Map(),
    hookToken,
    settingsPath: '',
    output: '',
    runId,
    channelId: 1,
    messageId: message.id,
    status: {
      state: 'running',
      connected: false,
      updatedAt: Date.now()
    }
  };

  getManagerSessions().set(userId, session);

  return { session, userId, runId, hookToken, messageId: message.id };
};

const getMessageMetadata = async (messageId: number) => {
  const row = await tdb
    .select({ metadata: messages.metadata })
    .from(messages)
    .where(eq(messages.id, messageId))
    .get();

  return row?.metadata ?? [];
};

const waitForQuestionMetadataStatus = async (
  messageId: number,
  requestId: string,
  status: 'pending' | 'answered' | 'cancelled' | 'expired'
) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const metadata = await getMessageMetadata(messageId);

    if (
      metadata.some(
        (item) =>
          item?.kind === 'claude_code_ask_user_question' &&
          item.requestId === requestId &&
          item.status === status
      )
    ) {
      return metadata;
    }

    await sleep(10);
  }

  throw new Error(`Timed out waiting for question metadata status ${status}`);
};

const askUserQuestionInput = {
  tool_name: 'AskUserQuestion',
  tool_input: {
    questions: [
      {
        question: 'Deploy now?',
        header: 'Deploy',
        options: [
          {
            label: 'Yes',
            description: 'Ship it now.'
          },
          {
            label: 'No',
            description: 'Hold the release.'
          }
        ]
      }
    ]
  }
};

describe('ClaudeCode AskUserQuestion hook', () => {
  test('returns deny for invalid AskUserQuestion input', async () => {
    const { hookToken } = await createTestSession();
    const response = await claudeCodeAgentManager.handleAskUserQuestionHook(
      hookToken,
      {
        tool_name: 'AskUserQuestion',
        tool_input: {
          questions: []
        }
      }
    );

    expect(response?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(response?.hookSpecificOutput.permissionDecisionReason).toContain(
      'questions'
    );
  });

  test('stores a pending question and resolves with updatedInput answers', async () => {
    const { session, userId, hookToken, messageId } = await createTestSession();
    const responsePromise =
      claudeCodeAgentManager.handleAskUserQuestionHook(
        hookToken,
        askUserQuestionInput
      );

    await waitFor(() => session.askUserQuestionRequests.size === 1);

    const requestId = session.askUserQuestionRequests.keys().next().value!;
    const pendingMetadata = await waitForQuestionMetadataStatus(
      messageId,
      requestId,
      'pending'
    );

    expect(
      pendingMetadata.some(
        (metadata) =>
          metadata?.kind === 'claude_code_ask_user_question' &&
          metadata.requestId === requestId &&
          metadata.status === 'pending'
      )
    ).toBe(true);

    await claudeCodeAgentManager.answerAskUserQuestionForUser(userId, requestId, {
      'Deploy now?': 'Yes'
    });

    const response = await withTimeout(responsePromise);
    const answeredMetadata = await getMessageMetadata(messageId);

    expect(response?.hookSpecificOutput.permissionDecision).toBe('allow');
    expect(response?.hookSpecificOutput.updatedInput?.answers).toEqual({
      'Deploy now?': 'Yes'
    });
    expect(
      answeredMetadata.some(
        (metadata) =>
          metadata?.kind === 'claude_code_ask_user_question' &&
          metadata.requestId === requestId &&
          metadata.status === 'answered' &&
          metadata.answers?.['Deploy now?'] === 'Yes'
      )
    ).toBe(true);
  });

  test('cancels a pending question and resolves with deny', async () => {
    const { session, userId, hookToken, messageId } = await createTestSession();
    const responsePromise =
      claudeCodeAgentManager.handleAskUserQuestionHook(
        hookToken,
        askUserQuestionInput
      );

    await waitFor(() => session.askUserQuestionRequests.size === 1);

    const requestId = session.askUserQuestionRequests.keys().next().value!;

    await waitForQuestionMetadataStatus(messageId, requestId, 'pending');
    await claudeCodeAgentManager.cancelAskUserQuestionForUser(userId, requestId);

    const response = await withTimeout(responsePromise);
    const metadata = await waitForQuestionMetadataStatus(
      messageId,
      requestId,
      'cancelled'
    );

    expect(response?.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      metadata.some(
        (item) =>
          item?.kind === 'claude_code_ask_user_question' &&
          item.requestId === requestId &&
          item.status === 'cancelled'
      )
    ).toBe(true);
  });

  test('preserves answered question metadata when Stop hook completes the task', async () => {
    const { runId, hookToken, messageId } = await createTestSession();

    await tdb
      .update(messages)
      .set({
        metadata: [
          {
            kind: 'claude_code_ask_user_question',
            requestId: crypto.randomUUID(),
            runId,
            status: 'answered',
            questions: askUserQuestionInput.tool_input.questions,
            answers: {
              'Deploy now?': 'Yes'
            },
            createdAt: Date.now(),
            answeredAt: Date.now()
          },
          {
            kind: 'claude_code_task',
            runId,
            status: 'running'
          }
        ]
      })
      .where(eq(messages.id, messageId));

    await claudeCodeAgentManager.handleStopHook(hookToken, {
      last_assistant_message: 'Done'
    });

    const metadata = await getMessageMetadata(messageId);

    expect(
      metadata.some(
        (item) =>
          item?.kind === 'claude_code_ask_user_question' &&
          item.status === 'answered'
      )
    ).toBe(true);
    expect(
      metadata.some(
        (item) =>
          item?.kind === 'claude_code_task' && item.status === 'completed'
      )
    ).toBe(true);
  });
});
