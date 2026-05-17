import { ResizableSidebar } from '@/components/resizable-sidebar';
import { setDmsOpen } from '@/features/server/actions';
import { useDirectMessagesUnreadCount } from '@/features/server/channels/hooks';
import { useDmsOpen, usePublicServerSettings } from '@/features/server/hooks';
import { LocalStorageKey } from '@/helpers/storage';
import { cn } from '@/lib/utils';
import { TestId } from '@mikotord/shared';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Categories } from './categories';
import { DirectMessages } from './direct-messages';
import { PluginButtons } from './plugin-buttons';
import { SearchPanel } from './search-panel';
import { UserControl } from './user-control';

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 288; // w-72 = 288px

type TLeftSidebarProps = {
  className?: string;
};

type TSidebarTabsProps = {
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
};

const SidebarTabs = memo(({ searchOpen, setSearchOpen }: TSidebarTabsProps) => {
  const { t } = useTranslation('sidebar');
  const dmsOpen = useDmsOpen();
  const publicSettings = usePublicServerSettings();
  const directMessagesUnreadCount = useDirectMessagesUnreadCount();
  const searchEnabled = !!publicSettings?.enableSearch;

  const openSearchPanel = useCallback(() => {
    setSearchOpen(true);
  }, [setSearchOpen]);

  useEffect(() => {
    if (!searchEnabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openSearchPanel();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSearchPanel, searchEnabled]);

  return (
    <div className="flex h-12 items-center justify-center border-b border-border px-3">
      <div
        className={cn(
          'grid w-full items-center',
          searchEnabled
            ? 'grid-cols-[1fr_auto_1fr_auto_1fr]'
            : 'grid-cols-[1fr_auto_1fr]'
        )}
      >
        <button
          type="button"
          className={cn(
            'flex h-9 items-center justify-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
            !dmsOpen && !searchOpen && 'text-foreground'
          )}
          onClick={() => {
            setSearchOpen(false);
            setDmsOpen(false);
          }}
        >
          {t('groups')}
        </button>
        <div className="h-5 w-px bg-border" />
        <button
          type="button"
          className={cn(
            'flex h-9 items-center justify-center gap-1 px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
            dmsOpen && !searchOpen && 'text-foreground'
          )}
          onClick={() => {
            setSearchOpen(false);
            setDmsOpen(true);
          }}
        >
          <span>{t('directMessages')}</span>
          {directMessagesUnreadCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
              {directMessagesUnreadCount > 99
                ? '99+'
                : directMessagesUnreadCount}
            </span>
          )}
        </button>
        {searchEnabled && (
          <>
            <div className="h-5 w-px bg-border" />
            <button
              type="button"
              className={cn(
                'flex h-9 items-center justify-center px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                searchOpen && 'text-foreground'
              )}
              onClick={openSearchPanel}
            >
              {t('search')}
            </button>
          </>
        )}
      </div>
    </div>
  );
});

const LeftSidebar = memo(({ className }: TLeftSidebarProps) => {
  const dmsOpen = useDmsOpen();
  const publicSettings = usePublicServerSettings();
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <ResizableSidebar
      storageKey={LocalStorageKey.LEFT_SIDEBAR_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      defaultWidth={DEFAULT_WIDTH}
      edge="right"
      className={cn('h-full', className)}
      data-testid={TestId.LEFT_SIDEBAR}
    >
      {(publicSettings?.directMessagesEnabled ||
        publicSettings?.enableSearch) && (
        <SidebarTabs searchOpen={searchOpen} setSearchOpen={setSearchOpen} />
      )}
      <PluginButtons />
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className={cn('h-full', !searchOpen && !dmsOpen ? '' : 'hidden')}>
          <Categories />
        </div>

        {publicSettings?.directMessagesEnabled && (
          <div className={cn('h-full', !searchOpen && dmsOpen ? '' : 'hidden')}>
            <DirectMessages />
          </div>
        )}

        {publicSettings?.enableSearch && (
          <div className={cn('h-full', searchOpen ? '' : 'hidden')}>
            <SearchPanel
              active={searchOpen}
              onOpenResult={() => setSearchOpen(false)}
            />
          </div>
        )}
      </div>
      <UserControl />
    </ResizableSidebar>
  );
});

export { LeftSidebar };
