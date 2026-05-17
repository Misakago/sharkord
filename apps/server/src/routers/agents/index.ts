import { ServerEvents } from '@mikotord/shared';
import { z } from 'zod';
import { claudeCodeAgentManager } from '../../agents/claude-code';
import { getSettings } from '../../db/queries/server';
import { invariant } from '../../utils/invariant';
import { protectedProcedure, t } from '../../utils/trpc';

const openClaudeCodeDmRoute = protectedProcedure
  .input(z.void())
  .mutation(async ({ ctx }) => {
    const settings = await getSettings();

    invariant(settings.directMessagesEnabled, {
      code: 'FORBIDDEN',
      message: 'Direct messages are disabled on this server'
    });

    return claudeCodeAgentManager.openDirectMessage(ctx.userId);
  });

const getClaudeCodeStatusRoute = protectedProcedure
  .input(z.void())
  .query(async ({ ctx }) => claudeCodeAgentManager.getStatusForUser(ctx.userId));

const getClaudeCodeDmRoute = protectedProcedure
  .input(z.void())
  .query(async ({ ctx }) => claudeCodeAgentManager.getDirectMessageForUser(ctx.userId));

const stopClaudeCodeSessionRoute = protectedProcedure
  .input(z.void())
  .mutation(async ({ ctx }) => claudeCodeAgentManager.stopSessionForUser(ctx.userId));

const listClaudeCodeSessionsRoute = protectedProcedure
  .input(z.void())
  .query(async ({ ctx }) =>
    claudeCodeAgentManager.listClaudeSessionsForUser(ctx.userId)
  );

const startNewClaudeCodeSessionRoute = protectedProcedure
  .input(z.void())
  .mutation(async ({ ctx }) =>
    claudeCodeAgentManager.startNewClaudeSessionForUser(ctx.userId)
  );

const resumeClaudeCodeSessionRoute = protectedProcedure
  .input(z.object({ chatSessionId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) =>
    claudeCodeAgentManager.resumeClaudeSessionForUser(
      ctx.userId,
      input.chatSessionId
    )
  );

const deleteClaudeCodeSessionRoute = protectedProcedure
  .input(z.object({ chatSessionId: z.string().uuid() }))
  .mutation(async ({ ctx, input }) =>
    claudeCodeAgentManager.deleteClaudeSessionForUser(
      ctx.userId,
      input.chatSessionId
    )
  );

const onClaudeCodeStatusRoute = protectedProcedure.subscription(
  async ({ ctx }) =>
    ctx.pubsub.subscribeFor(ctx.userId, ServerEvents.CLAUDE_CODE_STATUS)
);

const agentsRouter = t.router({
  openClaudeCodeDm: openClaudeCodeDmRoute,
  getClaudeCodeDm: getClaudeCodeDmRoute,
  getClaudeCodeStatus: getClaudeCodeStatusRoute,
  stopClaudeCodeSession: stopClaudeCodeSessionRoute,
  listClaudeCodeSessions: listClaudeCodeSessionsRoute,
  startNewClaudeCodeSession: startNewClaudeCodeSessionRoute,
  resumeClaudeCodeSession: resumeClaudeCodeSessionRoute,
  deleteClaudeCodeSession: deleteClaudeCodeSessionRoute,
  onClaudeCodeStatus: onClaudeCodeStatusRoute
});

export { agentsRouter };
