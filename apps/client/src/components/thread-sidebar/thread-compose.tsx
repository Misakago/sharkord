import {
  MessageCompose,
  type TMessageComposeFile,
  type TMessageComposeHandle
} from '@/components/message-compose';
import { playSound } from '@/features/server/sounds/actions';
import { SoundType } from '@/features/server/types';
import type { LocalStorageKey } from '@/helpers/storage';
import { getTRPCClient } from '@/lib/trpc';
import type { TReplyTarget } from '@/types';
import type { TJoinedPublicUser, TTempFile } from '@mikotord/shared';
import {
  TYPING_MS,
  getTrpcError,
  prepareMessageHtml,
  type TJoinedMessage
} from '@mikotord/shared';
import { throttle } from 'lodash-es';
import { memo, useCallback, useMemo, useState, type Ref } from 'react';
import { toast } from 'sonner';

type TThreadComposeProps = {
  parentMessageId: number;
  channelId: number;
  typingUsers: TJoinedPublicUser[];
  replyingToMessage?: TJoinedMessage;
  editingMessage?: TJoinedMessage;
  onSaveEdit?: (
    message: TJoinedMessage,
    content: string,
    files: TMessageComposeFile[]
  ) => Promise<boolean>;
  onCancelEdit?: () => void;
  onCancelReply?: () => void;
  onArrowUp?: () => void;
  ref?: Ref<TMessageComposeHandle>;
  composeContainerRef?: React.RefObject<HTMLDivElement | null>;
  inputStorageKey?: LocalStorageKey;
  inputDefaultMaxHeightVh?: number;
  onResize?: () => void;
};

const ThreadCompose = memo(
  ({
    parentMessageId,
    channelId,
    typingUsers,
    replyingToMessage,
    editingMessage,
    onSaveEdit,
    onCancelEdit,
    onCancelReply,
    onArrowUp,
    ref,
    composeContainerRef,
    inputStorageKey,
    inputDefaultMaxHeightVh,
    onResize
  }: TThreadComposeProps) => {
    const [newMessage, setNewMessage] = useState('');

    const replyTarget = useMemo<TReplyTarget | undefined>(() => {
      if (!replyingToMessage) {
        return undefined;
      }

      if (replyingToMessage.pluginId) {
        return { userId: null, pluginId: replyingToMessage.pluginId };
      }

      return { userId: replyingToMessage.userId, pluginId: null };
    }, [replyingToMessage]);

    const sendTypingSignal = useMemo(
      () =>
        throttle(async () => {
          const trpc = getTRPCClient();

          try {
            await trpc.messages.signalTyping.mutate({
              channelId,
              parentMessageId
            });
          } catch {
            // ignore
          }
        }, TYPING_MS),
      [channelId, parentMessageId]
    );

    const onSend = useCallback(
      async (message: string, files: TTempFile[]) => {
        sendTypingSignal.cancel();

        const trpc = getTRPCClient();

        try {
          await trpc.messages.send.mutate({
            content: prepareMessageHtml(message),
            channelId,
            files: files.map((f) => ({ id: f.id, name: f.originalName })),
            parentMessageId,
            replyToMessageId: replyingToMessage?.id
          });

          playSound(SoundType.MESSAGE_SENT);
        } catch (error) {
          toast.error(getTrpcError(error, 'Failed to send reply'));
          return false;
        }

        setNewMessage('');
        onCancelReply?.();
        return true;
      },
      [
        channelId,
        sendTypingSignal,
        parentMessageId,
        replyingToMessage?.id,
        onCancelReply
      ]
    );

    const handleSaveEdit = useCallback(
      async (
        message: TJoinedMessage,
        content: string,
        files: TMessageComposeFile[]
      ) => {
        if (!onSaveEdit) return false;

        const success = await onSaveEdit(message, content, files);

        if (success) {
          setNewMessage('');
        }

        return success;
      },
      [onSaveEdit]
    );

    const handleCancelEdit = useCallback(() => {
      setNewMessage('');
      onCancelEdit?.();
    }, [onCancelEdit]);

    return (
      <MessageCompose
        ref={ref}
        channelId={channelId}
        message={newMessage}
        onMessageChange={setNewMessage}
        onSend={onSend}
        editingMessage={editingMessage}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onTyping={sendTypingSignal}
        typingUsers={typingUsers}
        replyTarget={replyTarget}
        onCancelReply={onCancelReply}
        onArrowUp={onArrowUp}
        composeContainerRef={composeContainerRef}
        inputStorageKey={inputStorageKey}
        inputDefaultMaxHeightVh={inputDefaultMaxHeightVh}
        onResize={onResize}
        isThread={true}
      />
    );
  }
);

export { ThreadCompose };
