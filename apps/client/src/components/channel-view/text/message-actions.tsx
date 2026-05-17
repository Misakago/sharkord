import { EmojiPicker } from '@/components/emoji-picker';
import { useRecentEmojis } from '@/components/emoji-picker/use-recent-emojis';
import type { TEmojiItem } from '@/components/tiptap-input/helpers';
import { openThreadSidebar } from '@/features/app/actions';
import { useIsShiftHeld } from '@/features/app/hooks';
import { requestConfirmation } from '@/features/dialogs/actions';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { IconButton } from '@mikotord/ui';
import {
  MessageSquareText,
  Pencil,
  Reply,
  Smile,
  Trash,
  Trash2
} from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { MAX_QUICK_EMOJIS } from './message-actions-layout';

type TMessageActionsProps = {
  messageId: number;
  channelId: number;
  onEdit: () => void;
  onReply?: () => void;
  canManage: boolean;
  canReact: boolean;
  editable: boolean;
  isThreadReply?: boolean;
  visible: boolean;
  onPointerEnter: () => void;
};

const MessageActions = memo(
  ({
    onEdit,
    messageId,
    channelId,
    canManage,
    canReact,
    editable,
    isThreadReply,
    onReply,
    visible,
    onPointerEnter
  }: TMessageActionsProps) => {
    const { t } = useTranslation();
    const { recentEmojis } = useRecentEmojis();
    const recentEmojisToShow = useMemo(
      () => recentEmojis.slice(0, MAX_QUICK_EMOJIS),
      [recentEmojis]
    );

    const isShiftHeld = useIsShiftHeld();

    const onDeleteClick = useCallback(async () => {
      if (!isShiftHeld) {
        const choice = await requestConfirmation({
          title: t('deleteMessageTitle'),
          message: t('deleteMessageConfirm'),
          confirmLabel: t('deleteLabel'),
          cancelLabel: t('cancel')
        });

        if (!choice) return;
      }

      const trpc = getTRPCClient();
      try {
        await trpc.messages.delete.mutate({ messageId });
        toast.success(t('messageDeleted'));
      } catch {
        toast.error(t('failedDeleteMessage'));
      }
    }, [isShiftHeld, messageId, t]);

    const onEmojiSelect = useCallback(
      async (emoji: TEmojiItem) => {
        const trpc = getTRPCClient();

        try {
          await trpc.messages.toggleReaction.mutate({
            messageId,
            emoji: emoji.shortcodes[0]
          });
        } catch (error) {
          toast.error(t('failedAddReaction'));

          console.error('Error adding reaction:', error);
        }
      },
      [messageId, t]
    );

    const onReplyClick = useCallback(() => {
      openThreadSidebar(messageId, channelId);
    }, [messageId, channelId]);

    return (
      <div
        className={cn(
          'gap-1 absolute left-full bottom-0 z-10 translate-x-1 items-center rounded-lg shadow-lg border border-border p-2 bg-background [&:has([data-state=open])]:flex',
          visible ? 'flex' : 'hidden'
        )}
        onPointerEnter={onPointerEnter}
      >
        {onReply && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={Reply}
            className="h-6 w-6"
            onClick={onReply}
            title={t('replyToMessage')}
          />
        )}
        {!isThreadReply && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={MessageSquareText}
            className="h-6 w-6"
            onClick={onReplyClick}
            title={t('replyInThread')}
          />
        )}
        {canManage && (
          <>
            <IconButton
              size="sm"
              variant="ghost"
              icon={Pencil}
              className="h-6 w-6"
              onClick={onEdit}
              disabled={!editable}
              title={t('editMessage')}
            />

            <IconButton
              size="sm"
              variant="ghost"
              icon={isShiftHeld ? Trash2 : Trash}
              className={cn('h-6 w-6', isShiftHeld && 'text-destructive')}
              onClick={onDeleteClick}
              title={t('deleteMessageTitle')}
            />
          </>
        )}
        {canReact && (
          <div className="flex items-center gap-1 border-l pl-1">
            {recentEmojisToShow.map((emoji) => (
              <button
                key={emoji.name}
                type="button"
                onClick={() => onEmojiSelect(emoji)}
                className="w-6 h-6 flex items-center justify-center hover:bg-accent rounded-md transition-colors text-md"
                title={`:${emoji.shortcodes[0]}:`}
              >
                {emoji.emoji ? <span>{emoji.emoji}</span> : null}
              </button>
            ))}

            <EmojiPicker onEmojiSelect={onEmojiSelect}>
              <IconButton
                variant="ghost"
                icon={Smile}
                className="h-6 w-6"
                title={t('addReaction')}
              />
            </EmojiPicker>
          </div>
        )}
      </div>
    );
  }
);

export { MessageActions };
