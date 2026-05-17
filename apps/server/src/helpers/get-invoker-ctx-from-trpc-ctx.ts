import type { TInvokerContext } from '@mikotord/shared';
import type { Context } from '../utils/trpc';

const getInvokerCtxFromTrpcCtx = (ctx: Context): TInvokerContext => {
  return {
    userId: ctx.user.id
  };
};

export { getInvokerCtxFromTrpcCtx };
