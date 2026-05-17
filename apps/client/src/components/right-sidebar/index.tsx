import { ResizableSidebar } from '@/components/resizable-sidebar';
import { UserAvatar } from '@/components/user-avatar';
import { useUsers } from '@/features/server/users/hooks';
import { LocalStorageKey } from '@/helpers/storage';
import { cn } from '@/lib/utils';
import { DELETED_USER_IDENTITY_AND_NAME } from '@mikotord/shared';
import { IconButton, Tooltip } from '@mikotord/ui';
import { X } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPopover } from '../user-popover';

const MAX_USERS_TO_SHOW = 100;
const MIN_WIDTH = 180;
const MAX_WIDTH = 360;
const DEFAULT_WIDTH = 240; // w-60 = 240px

type TUserProps = {
  userId: number;
  name: string;
  banned: boolean;
};

const User = memo(({ userId, name, banned }: TUserProps) => {
  return (
    <UserPopover userId={userId}>
      <div className="flex h-10 min-w-0 select-none items-center gap-3 rounded-lg px-2 hover:bg-accent">
        <UserAvatar userId={userId} className="h-8 w-8 shrink-0" />
        <span
          className={cn(
            'text-sm text-foreground truncate',
            banned && 'line-through text-muted-foreground'
          )}
        >
          {name}
        </span>
      </div>
    </UserPopover>
  );
});

type TRightSidebarProps = {
  className?: string;
  onClose?: () => void;
};

const RightSidebar = memo(({ className, onClose }: TRightSidebarProps) => {
  const { t } = useTranslation('sidebar');
  const users = useUsers();

  const { usersToShow, usersCount } = useMemo(() => {
    const filtered = users.filter(
      (user) => user.name !== DELETED_USER_IDENTITY_AND_NAME
    );

    return {
      usersToShow: filtered.slice(0, MAX_USERS_TO_SHOW),
      usersCount: filtered.length
    };
  }, [users]);

  const hasHiddenUsers = users.length > MAX_USERS_TO_SHOW;

  return (
    <ResizableSidebar
      storageKey={LocalStorageKey.RIGHT_SIDEBAR_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      defaultWidth={DEFAULT_WIDTH}
      edge="left"
      className={cn('h-full', className)}
    >
      <div className="flex h-12 items-center justify-between gap-2 border-b border-border px-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t('membersHeader', { count: usersCount })}
        </h3>
        {onClose && (
          <Tooltip content={t('closeMembers')}>
            <IconButton
              aria-label={t('closeMembers')}
              icon={X}
              variant="ghost"
              size="sm"
              className="h-7 w-7 rounded"
              onClick={onClose}
            />
          </Tooltip>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {usersToShow.map((user) => (
            <User
              key={user.id}
              userId={user.id}
              name={user.name}
              banned={user.banned}
            />
          ))}
          {hasHiddenUsers && (
            <div className="text-sm text-muted-foreground px-2 py-1.5">
              +{users.length - MAX_USERS_TO_SHOW} more...
            </div>
          )}
        </div>
      </div>
    </ResizableSidebar>
  );
});

export { RightSidebar };
