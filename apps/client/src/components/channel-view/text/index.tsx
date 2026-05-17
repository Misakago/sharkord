import {
  MessageCompose,
  type TMessageComposeFile
} from '@/components/message-compose';
import {
  useMessageJumpTarget,
  useThreadSidebar
} from '@/features/app/hooks';
import {
  useChannelCan,
  useTypingUsersByChannelId
} from '@/features/server/hooks';
import { useMessages } from '@/features/server/messages/hooks';
import { playSound } from '@/features/server/sounds/actions';
import { SoundType } from '@/features/server/types';
import { LocalStorageKey } from '@/helpers/storage';
import { getTRPCClient } from '@/lib/trpc';
import type { TReplyTarget } from '@/types';
import {
  ChannelPermission,
  TYPING_MS,
  getTrpcError,
  prepareMessageHtml,
  type TJoinedMessage,
  type TTempFile
} from '@mikotord/shared';
import { throttle } from 'lodash-es';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChatInputDivider } from './chat-input-divider';
import { DEFAULT_MAX_HEIGHT_VH } from './helpers';
import { useArrowUpEdit } from './hooks/use-arrow-up-edit';
import { useScrollController } from './hooks/use-scroll-controller';
import { useScrollToJumpTarget } from './hooks/use-scroll-to-jump-target';
import { MessagesGroup } from './messages-group';
import { TextTopbar } from './text-top-bar';
import {
  getChannelDraftKey,
  getDraftMessage,
  setDraftMessage
} from './use-draft-messages';

type TChannelProps = {
  channelId: number;
  onClose?: () => void;
  onToggleMembers?: () => void;
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

const TextChannel = memo(
  ({ channelId, onClose, onToggleMembers }: TChannelProps) => {
    const { t } = useTranslation();
    const {
      messages,
      hasMore,
      loadMore,
      fetching,
      groupedMessages,
      scrollToMessage
    } = useMessages(channelId);
    const messageJumpTarget = useMessageJumpTarget();
    const isJumpingToChannel = messageJumpTarget?.channelId === channelId;
    const hasPendingClaudeCodeQuestion = useMemo(
      () =>
        messages.some((message) =>
          (message.metadata ?? []).some(
            (metadata) =>
              metadata?.kind === 'claude_code_ask_user_question' &&
              metadata.status === 'pending'
          )
        ),
      [messages]
    );

    useScrollToJumpTarget(channelId, scrollToMessage);

    const draftChannelKey = getChannelDraftKey(channelId);

    const [newMessage, setNewMessage] = useState(
      getDraftMessage(draftChannelKey)
    );
    const [replyingToMessage, setReplyingToMessage] = useState<
      TJoinedMessage | undefined
    >();
    const [editingMessage, setEditingMessage] = useState<
      TJoinedMessage | undefined
    >();
    const draftBeforeEditRef = useRef<string | undefined>(undefined);
    const typingUsers = useTypingUsersByChannelId(channelId);
    const composeContainerRef = useRef<HTMLDivElement>(null);
    const { activeThreadMessageId } = useThreadSidebar();
    const { composeRef, getLastEditableOwnMessage, handleEditComplete } =
      useArrowUpEdit(messages);

    const replyTarget = useMemo<TReplyTarget | undefined>(() => {
      if (!replyingToMessage) {
        return undefined;
      }

      if (replyingToMessage.pluginId) {
        return { userId: null, pluginId: replyingToMessage.pluginId };
      }

      return { userId: replyingToMessage.userId, pluginId: null };
    }, [replyingToMessage]);

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
      hasTypingUsers: typingUsers.length > 0,
      disableInitialScroll: isJumpingToChannel
    });

    const onComposeResize = useCallback(() => {
      if (isAtBottom()) {
        scrollToBottom();
      }
    }, [isAtBottom, scrollToBottom]);

    const channelCan = useChannelCan(channelId);

    const sendTypingSignal = useMemo(
      () =>
        throttle(async () => {
          const trpc = getTRPCClient();

          try {
            await trpc.messages.signalTyping.mutate({ channelId });
          } catch {
            // ignore
          }
        }, TYPING_MS),
      [channelId]
    );

    const setNewMessageHandler = useCallback(
      (value: string) => {
        setNewMessage(value);
        setDraftMessage(draftChannelKey, value);
      },
      [setNewMessage, draftChannelKey]
    );

    const restoreDraftAfterEdit = useCallback(() => {
      setEditingMessage(undefined);
      setNewMessageHandler(draftBeforeEditRef.current ?? '');
      draftBeforeEditRef.current = undefined;
      handleEditComplete();
    }, [handleEditComplete, setNewMessageHandler]);

    const startEditingMessage = useCallback(
      (message: TJoinedMessage) => {
        if (!editingMessage) {
          draftBeforeEditRef.current = newMessage;
        }

        composeRef.current?.discardFiles();
        setReplyingToMessage(undefined);
        setEditingMessage(message);
        setNewMessageHandler(message.content ?? '');
        window.setTimeout(() => composeRef.current?.focus(), 0);
      },
      [composeRef, editingMessage, newMessage, setNewMessageHandler]
    );

    const handleArrowUpEdit = useCallback(() => {
      const lastEditableMessage = getLastEditableOwnMessage();

      if (lastEditableMessage) {
        startEditingMessage(lastEditableMessage);
      }
    }, [getLastEditableOwnMessage, startEditingMessage]);

    const onSend = useCallback(
      async (message: string, files: TTempFile[]) => {
        sendTypingSignal.cancel();

        const trpc = getTRPCClient();

        try {
          await trpc.messages.send.mutate({
            content: prepareMessageHtml(message),
            channelId,
            files: files.map((f) => ({ id: f.id, name: f.originalName })),
            replyToMessageId: replyingToMessage?.id
          });

          playSound(SoundType.MESSAGE_SENT);
        } catch (error) {
          toast.error(getTrpcError(error, t('failedSendMessage')));
          return false;
        }

        setNewMessageHandler('');
        setReplyingToMessage(undefined);

        return true;
      },
      [
        channelId,
        sendTypingSignal,
        setNewMessageHandler,
        t,
        replyingToMessage?.id
      ]
    );

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

    const onReplyMessageSelect = useCallback(
      (message: TJoinedMessage) => {
        if (editingMessage) {
          restoreDraftAfterEdit();
        }

        setReplyingToMessage(message);
      },
      [editingMessage, restoreDraftAfterEdit]
    );

    if (!channelCan(ChannelPermission.VIEW_CHANNEL)) {
      return null;
    }

    return (
      <>
        <TextTopbar
          channelId={channelId}
          onClose={onClose}
          onToggleMembers={onToggleMembers}
        />

        <div
          ref={containerRef}
          onScroll={onScroll}
          onLoadCapture={onAsyncContentLoaded}
          data-messages-container
          data-channel-id={channelId}
          className="flex-1 overflow-y-auto overflow-x-hidden px-2 pt-2 pb-7"
        >
          <div className="space-y-4">
            {groupedMessages.map((group) => (
              <MessagesGroup
                key={group.key}
                group={group.messages}
                onReplyMessageSelect={onReplyMessageSelect}
                onEditMessageSelect={startEditingMessage}
                replyTargetMessageId={replyingToMessage?.id}
                activeThreadMessageId={activeThreadMessageId}
              />
            ))}
          </div>
        </div>

        <ChatInputDivider
          composeContainerRef={composeContainerRef}
          scrollToBottom={scrollToBottom}
          isAtBottom={isAtBottom}
          storageKey={LocalStorageKey.CHAT_INPUT_HEIGHT_VH}
          defaultMaxHeightVh={DEFAULT_MAX_HEIGHT_VH}
        />

        <MessageCompose
          ref={composeRef}
          composeContainerRef={composeContainerRef}
          channelId={channelId}
          message={newMessage}
          onMessageChange={setNewMessageHandler}
          onSend={onSend}
          editingMessage={editingMessage}
          onSaveEdit={onSaveEdit}
          onCancelEdit={restoreDraftAfterEdit}
          onTyping={sendTypingSignal}
          typingUsers={typingUsers}
          showPluginSlot
          onCancelReply={() => setReplyingToMessage(undefined)}
          replyTarget={replyTarget}
          onArrowUp={handleArrowUpEdit}
          onResize={onComposeResize}
          disabled={hasPendingClaudeCodeQuestion}
          disabledPlaceholder="请先回答上方问题"
        />
      </>
    );
  }
);

export { TextChannel };
