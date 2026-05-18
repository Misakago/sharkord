import { openServerScreen } from '@/features/server-screens/actions';
import { disconnectFromServer } from '@/features/server/actions';
import { useOwnPublicUser } from '@/features/server/users/hooks';
import { Button } from '@mikotord/ui';
import { LogOut, Settings } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ServerScreen } from '../server-screens/screens';
import { UserAvatar } from '../user-avatar';
import { UserPopover } from '../user-popover';

const UserControl = memo(() => {
  const { t } = useTranslation('sidebar');
  const ownPublicUser = useOwnPublicUser();

  const handleSettingsClick = useCallback(() => {
    openServerScreen(ServerScreen.USER_SETTINGS);
  }, []);

  const handleLogoutClick = useCallback(() => {
    disconnectFromServer();
  }, []);

  if (!ownPublicUser) return null;

  return (
    <div className="flex items-center justify-between h-14 px-2 bg-card">
      <UserPopover userId={ownPublicUser.id}>
        <div className="flex h-10 min-w-0 flex-1 cursor-pointer items-center space-x-2 rounded-lg p-1 transition-colors hover:bg-accent">
          <UserAvatar
            userId={ownPublicUser.id}
            className="h-8 w-8 flex-shrink-0"
            showUserPopover={false}
          />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium text-foreground truncate">
              {ownPublicUser.name}
            </span>
            <div className="flex items-center space-x-1">
              <span className="text-xs text-muted-foreground capitalize">
                {ownPublicUser.status}
              </span>
            </div>
          </div>
        </div>
      </UserPopover>

      <div className="flex items-center space-x-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={handleLogoutClick}
          title={t('logout')}
        >
          <LogOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={handleSettingsClick}
          title={t('userSettings')}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});

export { UserControl };
