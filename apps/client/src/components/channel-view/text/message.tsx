import { useRecentEmojis } from '@/components/emoji-picker/use-recent-emojis';
import { openThreadSidebar } from '@/features/app/actions';
import { useMessageJumpTarget } from '@/features/app/hooks';
import { useCan } from '@/features/server/hooks';
import { useIsOwnUser, useOwnUserId } from '@/features/server/users/hooks';
import { uploadFile } from '@/helpers/upload-file';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  getTrpcError,
  hasMention,
  Permission,
  TestId,
  type TFile,
  type TJoinedMessage
} from '@mikotord/shared';
import { MessageSquareText } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MessageActions } from './message-actions';
import {
  getMessageActionsReservedWidth,
  MAX_QUICK_EMOJIS
} from './message-actions-layout';
import { MessageRenderer } from './renderer';

type TMessageProps = {
  message: TJoinedMessage;
  disableActions?: boolean;
  disableFiles?: boolean;
  disableReactions?: boolean;
  compactMedia?: boolean;
  onReplyMessageSelect?: (message: TJoinedMessage) => void;
  onEditMessageSelect?: (message: TJoinedMessage) => void;
  isInlineReplyTarget?: boolean;
  isActiveThread?: boolean;
  showClaudeCodePanelHost?: boolean;
};

const Message = memo(
  ({
    message,
    disableActions,
    disableFiles,
    disableReactions,
    compactMedia,
    onReplyMessageSelect,
    onEditMessageSelect,
    isInlineReplyTarget,
    isActiveThread,
    showClaudeCodePanelHost
  }: TMessageProps) => {
    const { t } = useTranslation('common');
    const [actionsVisible, setActionsVisible] = useState(false);
    const messageRef = useRef<HTMLDivElement>(null);
    const isFromOwnUser = useIsOwnUser(message.userId);
    const can = useCan();
    const ownUserId = useOwnUserId();
    const { recentEmojis } = useRecentEmojis();
    const messageJumpTarget = useMessageJumpTarget();

    const canManage = useMemo(
      () => can(Permission.MANAGE_MESSAGES) || isFromOwnUser,
      [can, isFromOwnUser]
    );

    const isMentioned = useMemo(
      () => hasMention(message.content, ownUserId),
      [message.content, ownUserId]
    );

    const isThreadReply = !!message.parentMessageId;
    const replyCount = message.replyCount ?? 0;
    const canReact = can(Permission.REACT_TO_MESSAGES);
    const quickEmojiCount = Math.min(recentEmojis.length, MAX_QUICK_EMOJIS);
    const actionsReservedWidth = disableActions
      ? 0
      : getMessageActionsReservedWidth({
          canReply: !!onReplyMessageSelect,
          canThread: !isThreadReply,
          canManage,
          canReact,
          quickEmojiCount
        });
    const activeFileId =
      messageJumpTarget?.messageId === message.id
        ? messageJumpTarget.fileId
        : undefined;

    const onThreadClick = useCallback(() => {
      openThreadSidebar(message.id, message.channelId);
    }, [message.id, message.channelId]);

    const renameMessageFile = useCallback(
      async (fileToRename: TFile, name: string) => {
        if (!message.editable || !canManage) return;
        if (name === fileToRename.originalName) return;

        const trpc = getTRPCClient();

        try {
          await trpc.messages.edit.mutate({
            messageId: message.id,
            content: message.content ?? '',
            files: message.files.map((file) => ({
              type: 'existing' as const,
              id: file.id,
              name: file.id === fileToRename.id ? name : file.originalName
            }))
          });

          toast.success(t('messageEdited'));
        } catch (error) {
          toast.error(getTrpcError(error, t('failedEditMessage')));
        }
      },
      [
        canManage,
        message.content,
        message.editable,
        message.files,
        message.id,
        t
      ]
    );

    const replaceMessageFile = useCallback(
      async (fileToReplace: TFile, replacement: File) => {
        if (!message.editable || !canManage) return;

        const temporaryFile = await uploadFile(replacement);

        if (!temporaryFile) {
          throw new Error(t('failedSaveFile'));
        }

        const trpc = getTRPCClient();

        await trpc.files.replaceMessageFile.mutate({
          messageId: message.id,
          fileId: fileToReplace.id,
          temporaryFileId: temporaryFile.id,
          name: replacement.name || fileToReplace.originalName
        });
      },
      [canManage, message.editable, message.id, t]
    );

    const showActions = useCallback(() => {
      setActionsVisible(true);
    }, []);

    const hideActions = useCallback(() => {
      setActionsVisible(false);
    }, []);

    useEffect(() => {
      if (!actionsVisible) return;

      const onPointerMove = (event: PointerEvent) => {
        const messageElement = messageRef.current;

        if (!messageElement) {
          hideActions();
          return;
        }

        const messageRect = messageElement.getBoundingClientRect();
        const isWithinMessageHeight =
          event.clientY >= messageRect.top &&
          event.clientY <= messageRect.bottom;

        if (!isWithinMessageHeight) {
          hideActions();
        }
      };

      window.addEventListener('pointermove', onPointerMove);

      return () => window.removeEventListener('pointermove', onPointerMove);
    }, [actionsVisible, hideActions]);

    return (
      <div
        ref={messageRef}
        className={cn(
          'message-shell relative ml-1 inline-flex max-w-full flex-col rounded-md px-1 py-0.5 hover:bg-accent',
          'w-fit [&:has([data-attachment-expanded=true])]:w-full',
          isActiveThread && 'bg-primary/10',
          isMentioned && 'border-primary bg-primary/5',
          isInlineReplyTarget && 'ring-1 ring-primary/50 bg-primary/10'
        )}
        data-testid={TestId.MESSAGE_ITEM}
        data-message-id={message.id}
        style={
          actionsReservedWidth
            ? { maxWidth: `calc(100% - ${actionsReservedWidth}px)` }
            : undefined
        }
        onPointerEnter={showActions}
      >
        <MessageRenderer
          message={message}
          disableFiles={disableFiles}
          disableReactions={disableReactions}
          compactMedia={compactMedia}
          activeFileId={activeFileId}
          onRenameFile={
            message.editable && canManage ? renameMessageFile : undefined
          }
          onReplaceFile={
            message.editable && canManage ? replaceMessageFile : undefined
          }
          showClaudeCodePanelHost={showClaudeCodePanelHost}
        />
        {!isThreadReply && replyCount > 0 && (
          <button
            type="button"
            onClick={onThreadClick}
            className="flex items-center gap-1 text-xs text-primary/70 hover:text-primary hover:underline mt-1 transition-colors"
          >
            <MessageSquareText className="h-3 w-3" />
            <span>{t('reply', { count: replyCount })}</span>
          </button>
        )}
        {!disableActions && (
          <MessageActions
            onEdit={() => onEditMessageSelect?.(message)}
            canManage={canManage}
            messageId={message.id}
            channelId={message.channelId}
            editable={message.editable ?? false}
            isThreadReply={isThreadReply}
            onReply={
              onReplyMessageSelect
                ? () => onReplyMessageSelect(message)
                : undefined
            }
            canReact={canReact}
            visible={actionsVisible}
            onPointerEnter={showActions}
          />
        )}
      </div>
    );
  }
);

export { Message };
