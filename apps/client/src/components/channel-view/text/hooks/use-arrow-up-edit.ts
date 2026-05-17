import type { TMessageComposeHandle } from '@/components/message-compose';
import { useOwnUserId } from '@/features/server/users/hooks';
import type { TJoinedMessage } from '@mikotord/shared';
import { useCallback, useRef } from 'react';

export const useArrowUpEdit = (messages: TJoinedMessage[]) => {
  const ownUserId = useOwnUserId();
  const composeRef = useRef<TMessageComposeHandle>(null);

  const getLastEditableOwnMessage = useCallback(() => {
    return [...messages]
      .reverse()
      .find((m) => m.userId === ownUserId && m.editable !== false);
  }, [messages, ownUserId]);

  const handleEditComplete = useCallback(() => {
    composeRef.current?.focus();
  }, []);

  return {
    composeRef,
    getLastEditableOwnMessage,
    handleEditComplete
  };
};
