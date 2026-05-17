import { UnreadCount } from '@/components/unread-count';
import { UserAvatar } from '@/components/user-avatar';
import { setSelectedDmChannelId } from '@/features/app/actions';
import { useSelectedDmChannelId } from '@/features/app/hooks';
import { useChannels } from '@/features/server/channels/hooks';
import { useUnreadMessagesCount } from '@/features/server/hooks';
import {
  useOwnUserId,
  useUserById,
  useUsers
} from '@/features/server/users/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  DELETED_USER_IDENTITY_AND_NAME,
  type TDirectMessageConversation
} from '@mikotord/shared';
import { IconButton, Input } from '@mikotord/ui';
import { Search, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { SearchUserDropdown } from './search-user-dropdown';

type TDirectMessageItemProps = {
  dm: TDirectMessageConversation;
  selected: boolean;
  onSelect: () => void;
};

const DirectMessageItem = memo(
  ({ dm, selected, onSelect }: TDirectMessageItemProps) => {
    const user = useUserById(dm.userId);
    const unreadCount = useUnreadMessagesCount(dm.channelId);

    if (!user) {
      return null;
    }

    return (
      <button
        type="button"
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          selected && 'bg-accent text-accent-foreground'
        )}
        onClick={onSelect}
      >
        <UserAvatar userId={user.id} className="h-8 w-8" showUserPopover />
        <span className="truncate flex-1 text-left">{user.name}</span>
        <UnreadCount count={unreadCount} />
      </button>
    );
  }
);

const DirectMessages = memo(() => {
  const { t } = useTranslation('sidebar');
  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<
    TDirectMessageConversation[]
  >([]);
  const [query, setQuery] = useState('');
  const [startDmQuery, setStartDmQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const users = useUsers();
  const channels = useChannels();
  const ownUserId = useOwnUserId();
  const selectedDmChannelId = useSelectedDmChannelId();

  const fetchConversations = useCallback(async () => {
    const trpc = getTRPCClient();

    setLoading(true);

    try {
      const items = await trpc.dms.get.query();

      setConversations(items);
    } catch {
      toast.error(t('failedLoadDMs'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchConversations();
  }, [channels.length, fetchConversations]);

  // subscribe to new conversations being opened, when a new conversation is opened we refetch the list of conversations
  useEffect(() => {
    const trpc = getTRPCClient();

    const sub = trpc.dms.onConversationOpen.subscribe(undefined, {
      onData: () => fetchConversations()
    });

    return () => sub.unsubscribe();
  }, [fetchConversations]);

  const usersToStartDm = useMemo(() => {
    const directMessageUserIds = new Set(conversations.map((dm) => dm.userId));
    const normalizedQuery = startDmQuery.trim().toLowerCase();

    return users.filter(
      (user) =>
        user.id !== ownUserId &&
        !user.banned &&
        user.name !== DELETED_USER_IDENTITY_AND_NAME &&
        !directMessageUserIds.has(user.id) &&
        user.name.toLowerCase().includes(normalizedQuery)
    );
  }, [conversations, ownUserId, startDmQuery, users]);

  const usersMatchingSearch = useMemo(() => {
    const directMessageUserIds = new Set(conversations.map((dm) => dm.userId));
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return [];

    return users.filter(
      (user) =>
        user.id !== ownUserId &&
        !user.banned &&
        user.name !== DELETED_USER_IDENTITY_AND_NAME &&
        !directMessageUserIds.has(user.id) &&
        user.name.toLowerCase().includes(normalizedQuery)
    );
  }, [conversations, ownUserId, query, users]);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!searchOpen || !normalizedQuery) return conversations;

    return conversations.filter((dm) => {
      const user = users.find((item) => item.id === dm.userId);

      return user?.name.toLowerCase().includes(normalizedQuery);
    });
  }, [conversations, query, searchOpen, users]);

  const onStartDm = useCallback(
    async (userId: number) => {
      const trpc = getTRPCClient();

      try {
        const result = await trpc.dms.open.mutate({ userId });

        setSelectedDmChannelId(result.channelId);
        await fetchConversations();
      } catch {
        toast.error(t('couldNotOpenDM'));
      }
    },
    [fetchConversations, t]
  );

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
  }, []);

  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="mb-1 flex items-center justify-between px-2 py-1">
        <IconButton
          variant="ghost"
          size="sm"
          icon={searchOpen ? X : Search}
          title={searchOpen ? t('close') : t('searchDirectMessages')}
          onClick={() => {
            if (searchOpen) {
              closeSearch();
            } else {
              setSearchOpen(true);
            }
          }}
        />
        <SearchUserDropdown
          query={startDmQuery}
          setQuery={setStartDmQuery}
          usersToStartDm={usersToStartDm}
          onStartDm={onStartDm}
        />
      </div>

      {searchOpen && (
        <div className="mb-2 px-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchDirectMessages')}
            autoFocus
          />
        </div>
      )}

      <div className="space-y-0.5">
        {filteredConversations.map((dm) => (
          <DirectMessageItem
            key={dm.channelId}
            dm={dm}
            selected={selectedDmChannelId === dm.channelId}
            onSelect={() => {
              setSelectedDmChannelId(dm.channelId);
              closeSearch();
            }}
          />
        ))}
        {searchOpen &&
          query.trim().length > 0 &&
          usersMatchingSearch.map((user) => (
            <button
              type="button"
              key={user.id}
              className="flex h-10 w-full items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                void onStartDm(user.id);
                closeSearch();
              }}
            >
              <UserAvatar userId={user.id} className="h-8 w-8" showUserPopover />
              <span className="truncate flex-1 text-left">{user.name}</span>
            </button>
          ))}
        {conversations.length === 0 && !loading && !searchOpen && (
          <div className="px-2 py-4 text-xs text-muted-foreground">
            {t('noDMsYet')}
          </div>
        )}
        {searchOpen &&
          query.trim().length > 0 &&
          filteredConversations.length === 0 &&
          usersMatchingSearch.length === 0 && (
            <div className="px-2 py-4 text-xs text-muted-foreground">
              {t('noUsersAvailable')}
            </div>
          )}
      </div>
    </div>
  );
});

export { DirectMessages };
