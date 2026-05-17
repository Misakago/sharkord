import type { TSettings } from '@mikotord/shared';
import { hasUserJoinedBefore } from '../db/queries/logins';

const shouldAskServerPassword = async (
  userId: number,
  settings: Pick<TSettings, 'password' | 'onlyAskForPasswordOnFirstJoin'>
): Promise<boolean> => {
  if (!settings.password) {
    return false;
  }

  if (!settings.onlyAskForPasswordOnFirstJoin) {
    return true;
  }

  return !(await hasUserJoinedBefore(userId));
};

export { shouldAskServerPassword };
