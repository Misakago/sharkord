import type { TMessageComposeFile } from '@/components/message-compose';
import { setMessageJumpTarget } from '@/features/app/actions';
import { useMessageJumpTarget, useThreadSidebar } from '@/features/app/hooks';
import { useTypingUsersByThreadId } from '@/features/server/hooks';
import { useThreadMessages } from '@/features/server/messages/hooks';
import { highlightMessageElement } from '@/features/server/messages/helpers';
import { LocalStorageKey } from '@/helpers/storage';
import { getTRPCClient } from '@/lib/trpc';
import {
  getTrpcError,
  prepareMessageHtml,
  type TJoinedMessage
} from '@mikotord/shared';
import { MessageSquareText } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChatInputDivider } from '../channel-view/text/chat-input-divider';
import { DEFAULT_MAX_HEIGHT_VH } from '../channel-view/text/helpers';
import { useArrowUpEdit } from '../channel-view/text/hooks/use-arrow-up-edit';
import { useScrollController } from '../channel-view/text/hooks/use-scroll-controller';
import { MessagesGroup } from '../channel-view/text/messages-group';
import { ParentMessagePreview } from './parent-message-preview';
import { ThreadCompose } from './thread-compose';
import { ThreadHeader } from './thread-header';

type TThreadContentProps = {
  parentMessageId: number;
  channelId: number;
};

const hasEditedMessageChanges = (
  messageToEdit: TJoinedMessage,
  content: string,
  files: TMessageComposeFile[]
) => {
  const nextContent = prepareMessageHtml(content);

  if (nextContent !== (messageToEdit.content ?? '')) {
    return true;
  }

  if (files.length !== messageToEdit.files.length) {
    return true;
  }

  return files.some((file, index) => {
    const originalFile = messageToEdit.files[index];

    if (!originalFile || file.type !== 'existing') {
      return true;
    }

    return file.id !== originalFile.id || file.name !== originalFile.originalName;
  });
};

const ThreadContent = memo(
  ({ parentMessageId, channelId }: TThreadContentProps) => {
    const { t } = useTranslation('common');
    const {
      messages,
      hasMore,
      loadMore,
      loading,
      fetching,
      groupedMessages,
      scrollToMessage
    } = useThreadMessages(parentMessageId);
    const [replyingToMessage, setReplyingToMessage] = useState<
      TJoinedMessage | undefined
    >();
    const [editingMessage, setEditingMessage] = useState<
      TJoinedMessage | undefined
    >();
    const { activeThreadMessageId } = useThreadSidebar();
    const messageJumpTarget = useMessageJumpTarget();
    const { composeRef, getLastEditableOwnMessage, handleEditComplete } =
      useArrowUpEdit(messages);

    const typingUsers = useTypingUsersByThreadId(parentMessageId);
    const composeContainerRef = useRef<HTMLDivElement>(null);

    const {
      containerRef,
      onScroll,
      onAsyncContentLoaded,
      scrollToBottom,
      isAtBottom
    } = useScrollController({
      messages,
      fetching,
      hasMore,
      loadMore,
      hasTypingUsers: typingUsers.length > 0
    });

    const onComposeResize = useCallback(() => {
      if (isAtBottom()) {
        scrollToBottom();
      }
    }, [isAtBottom, scrollToBottom]);

    useEffect(() => {
      if (
        !messageJumpTarget?.threadParentMessageId ||
        messageJumpTarget.threadParentMessageId !== parentMessageId ||
        messageJumpTarget.channelId !== channelId
      ) {
        return;
      }

      const targetMessageId = messageJumpTarget.messageId;
      const hasTargetMessage = messages.some(
        (message) => message.id === targetMessageId
      );

      if (!hasTargetMessage) {
        void scrollToMessage(
          targetMessageId,
          messageJumpTarget.highlightTime ?? 8000
        ).then(() => setMessageJumpTarget(undefined));

        return;
      }

      const element = containerRef.current?.querySelector(
        `[data-message-id="${targetMessageId}"]`
      );

      if (!element) return;

      void highlightMessageElement(
        element,
        messageJumpTarget.highlightTime ?? 8000
      ).then(() => setMessageJumpTarget(undefined));
    }, [
      channelId,
      containerRef,
      fetching,
      hasMore,
      loadMore,
      messageJumpTarget,
      messages,
      parentMessageId,
      scrollToMessage
    ]);

    const restoreDraftAfterEdit = useCallback(() => {
      setEditingMessage(undefined);
      handleEditComplete();
    }, [handleEditComplete]);

    const onReplyMessageSelect = useCallback(
      (message: TJoinedMessage) => {
        if (editingMessage) {
          restoreDraftAfterEdit();
        }

        setReplyingToMessage(message);
      },
      [editingMessage, restoreDraftAfterEdit]
    );

    const startEditingMessage = useCallback(
      (message: TJoinedMessage) => {
        composeRef.current?.discardFiles();
        setReplyingToMessage(undefined);
        setEditingMessage(message);
        window.setTimeout(() => composeRef.current?.focus(), 0);
      },
      [composeRef]
    );

    const handleArrowUpEdit = useCallback(() => {
      const lastEditableMessage = getLastEditableOwnMessage();

      if (lastEditableMessage) {
        startEditingMessage(lastEditableMessage);
      }
    }, [getLastEditableOwnMessage, startEditingMessage]);

    const onSaveEdit = useCallback(
      async (
        messageToEdit: TJoinedMessage,
        content: string,
        files: TMessageComposeFile[]
      ) => {
        const nextContent = prepareMessageHtml(content);

        if (!hasEditedMessageChanges(messageToEdit, content, files)) {
          restoreDraftAfterEdit();
          return true;
        }

        const trpc = getTRPCClient();

        try {
          await trpc.messages.edit.mutate({
            messageId: messageToEdit.id,
            content: nextContent,
            files
          });

          toast.success(t('messageEdited'));
        } catch (error) {
          toast.error(getTrpcError(error, t('failedEditMessage')));
          return false;
        }

        restoreDraftAfterEdit();

        return true;
      },
      [restoreDraftAfterEdit, t]
    );

    return (
      <div className="flex flex-col h-full w-full">
        <ThreadHeader />
        <ParentMessagePreview messageId={parentMessageId} />

        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div
            ref={containerRef}
            onScroll={onScroll}
            onLoadCapture={onAsyncContentLoaded}
            className="flex-1 overflow-y-auto overflow-x-hidden p-2"
          >
            {messages.length === 0 && !loading && !fetching ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground text-sm">
                <MessageSquareText className="h-8 w-8 mb-2 opacity-50" />
                <p>{t('noRepliesYet')}</p>
                <p className="text-xs">{t('beFirstToReply')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedMessages.map((group) => (
                  <MessagesGroup
                    key={group.key}
                    group={group.messages}
                    compactMedia
                    onReplyMessageSelect={onReplyMessageSelect}
                    onEditMessageSelect={startEditingMessage}
                    replyTargetMessageId={replyingToMessage?.id}
                    activeThreadMessageId={activeThreadMessageId}
                  />
                ))}
              </div>
            )}
          </div>

          <ChatInputDivider
            composeContainerRef={composeContainerRef}
            scrollToBottom={scrollToBottom}
            isAtBottom={isAtBottom}
            storageKey={LocalStorageKey.THREAD_INPUT_HEIGHT_VH}
            defaultMaxHeightVh={DEFAULT_MAX_HEIGHT_VH}
          />

          <ThreadCompose
            ref={composeRef}
            parentMessageId={parentMessageId}
            channelId={channelId}
            typingUsers={typingUsers}
            replyingToMessage={replyingToMessage}
            editingMessage={editingMessage}
            onSaveEdit={onSaveEdit}
            onCancelEdit={restoreDraftAfterEdit}
            onCancelReply={() => setReplyingToMessage(undefined)}
            onArrowUp={handleArrowUpEdit}
            composeContainerRef={composeContainerRef}
            inputStorageKey={LocalStorageKey.THREAD_INPUT_HEIGHT_VH}
            inputDefaultMaxHeightVh={DEFAULT_MAX_HEIGHT_VH}
            onResize={onComposeResize}
          />
        </div>
      </div>
    );
  }
);

export { ThreadContent };
