import { t } from '../utils/trpc';
import { agentsRouter } from './agents';
import { categoriesRouter } from './categories';
import { channelsRouter } from './channels';
import { dmsRouter } from './dms';
import { emojisRouter } from './emojis';
import { filesRouter } from './files';
import { invitesRouter } from './invites';
import { messagesRouter } from './messages';
import { othersRouter } from './others';
import { pluginsRouter } from './plugins';
import { rolesRouter } from './roles';
import { usersRouter } from './users';

const appRouter = t.router({
  others: othersRouter,
  messages: messagesRouter,
  users: usersRouter,
  channels: channelsRouter,
  dms: dmsRouter,
  files: filesRouter,
  emojis: emojisRouter,
  roles: rolesRouter,
  invites: invitesRouter,
  categories: categoriesRouter,
  plugins: pluginsRouter,
  agents: agentsRouter
});

type AppRouter = typeof appRouter;

export { appRouter };
export type { AppRouter };
