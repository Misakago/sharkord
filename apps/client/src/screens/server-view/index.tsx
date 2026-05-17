import { LeftSidebar } from '@/components/left-sidebar';
import { ClaudeCodeFloatingPanel } from '@/components/claude-code-floating-panel';
import { ModViewSheet } from '@/components/mod-view-sheet';
import { Protect } from '@/components/protect';
import { RightSidebar } from '@/components/right-sidebar';
import { ThreadSidebar } from '@/components/thread-sidebar';
import { closeThreadSidebar } from '@/features/app/actions';
import { useSelectedDmChannelId, useThreadSidebar } from '@/features/app/hooks';
import { setDmsOpen } from '@/features/server/actions';
import { setSelectedChannelId } from '@/features/server/channels/actions';
import { useSelectedChannelId } from '@/features/server/channels/hooks';
import { useDmsOpen, usePublicServerSettings } from '@/features/server/hooks';
import { useSwipeGestures } from '@/hooks/use-swipe-gestures';
import { cn } from '@/lib/utils';
import { Permission, TestId } from '@mikotord/shared';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ContentWrapper } from './content-wrapper';

const ServerView = memo(() => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileUsersOpen, setIsMobileUsersOpen] = useState(false);
  const [isMembersPanelOpen, setIsMembersPanelOpen] = useState(false);
  const dmsOpen = useDmsOpen();
  const selectedChannelId = useSelectedChannelId();
  const selectedDmChannelId = useSelectedDmChannelId();
  const publicSettings = usePublicServerSettings();
  const previousServerChannelIdRef = useRef<number | undefined>(undefined);
  const {
    isOpen: isThreadSidebarOpen,
    channelId: threadChannelId
  } = useThreadSidebar();
  const activeConversationChannelId = dmsOpen
    ? selectedDmChannelId
    : selectedChannelId;

  const handleSwipeRight = useCallback(() => {
    if (isMobileMenuOpen || isMobileUsersOpen) {
      setIsMobileMenuOpen(false);
      setIsMobileUsersOpen(false);
      setIsMembersPanelOpen(false);
      return;
    }

    setIsMobileMenuOpen(true);
  }, [isMobileMenuOpen, isMobileUsersOpen]);

  const handleSwipeLeft = useCallback(() => {
    if (isMobileMenuOpen || isMobileUsersOpen) {
      setIsMobileMenuOpen(false);
      setIsMobileUsersOpen(false);
      setIsMembersPanelOpen(false);

      return;
    }

    setIsMobileUsersOpen(true);
    setIsMembersPanelOpen(true);
  }, [isMobileMenuOpen, isMobileUsersOpen]);

  const swipeHandlers = useSwipeGestures({
    onSwipeRight: handleSwipeRight,
    onSwipeLeft: handleSwipeLeft
  });

  useEffect(() => {
    if (publicSettings?.directMessagesEnabled === false && dmsOpen) {
      setDmsOpen(false);

      if (previousServerChannelIdRef.current) {
        setSelectedChannelId(previousServerChannelIdRef.current);
      }
    }
  }, [publicSettings?.directMessagesEnabled, dmsOpen]);

  useEffect(() => {
    if (
      isThreadSidebarOpen &&
      activeConversationChannelId &&
      threadChannelId !== activeConversationChannelId
    ) {
      closeThreadSidebar();
    }
  }, [activeConversationChannelId, isThreadSidebarOpen, threadChannelId]);

  return (
    <div
      data-testid={TestId.SERVER_VIEW}
      className="flex h-dvh flex-col bg-background text-foreground dark"
      {...swipeHandlers}
    >
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {isMobileMenuOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}

        {isMobileUsersOpen && (
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setIsMobileUsersOpen(false)}
          />
        )}

        <LeftSidebar
          className={cn(
            'md:relative md:flex fixed inset-0 left-0 h-full z-40 md:z-0',
            isMobileMenuOpen
              ? 'translate-x-0'
              : '-translate-x-full md:translate-x-0'
          )}
        />

        <ContentWrapper
          isDmMode={dmsOpen}
          selectedDmChannelId={selectedDmChannelId}
          onToggleMembers={() => setIsMembersPanelOpen((isOpen) => !isOpen)}
        />

        <ThreadSidebar isOpen={isThreadSidebarOpen} />

        {(isMembersPanelOpen || isMobileUsersOpen) && (
          <RightSidebar
            className={cn(
              'fixed top-0 bottom-0 right-0 h-full z-40 shadow-xl',
              'lg:relative lg:z-0 lg:shadow-none',
              isMobileUsersOpen || isMembersPanelOpen
                ? 'translate-x-0'
                : 'translate-x-full lg:translate-x-0'
            )}
            onClose={() => {
              setIsMembersPanelOpen(false);
              setIsMobileUsersOpen(false);
            }}
          />
        )}

        <Protect permission={Permission.MANAGE_USERS}>
          <ModViewSheet />
        </Protect>
        <ClaudeCodeFloatingPanel />
      </div>
    </div>
  );
});

export { ServerView };
