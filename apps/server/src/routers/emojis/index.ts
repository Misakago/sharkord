import { ServerEvents } from '@mikotord/shared';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, t } from '../../utils/trpc';

const customEmojiDisabledError = () =>
  new TRPCError({
    code: 'FORBIDDEN',
    message: 'Custom emoji and GIF sticker packs are disabled.'
  });

const disabledMutation = protectedProcedure.mutation(() => {
  throw customEmojiDisabledError();
});

export const emojisRouter = t.router({
  add: disabledMutation,
  update: disabledMutation,
  delete: disabledMutation,
  getAll: protectedProcedure.query(() => []),
  onCreate: protectedProcedure.subscription(async ({ ctx }) =>
    ctx.pubsub.subscribe(ServerEvents.EMOJI_CREATE)
  ),
  onDelete: protectedProcedure.subscription(async ({ ctx }) =>
    ctx.pubsub.subscribe(ServerEvents.EMOJI_DELETE)
  ),
  onUpdate: protectedProcedure.subscription(async ({ ctx }) =>
    ctx.pubsub.subscribe(ServerEvents.EMOJI_UPDATE)
  )
});
