import { useOwnUserId, useUsernames } from '@/features/server/users/hooks';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { getTrpcError, type TJoinedMessageReaction } from '@mikotord/shared';
import { Button, Tooltip } from '@mikotord/ui';
import { gitHubEmojis } from '@tiptap/extension-emoji';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const MAX_REACTORS_PREVIEW = 4;

type TTooltipPreviewProps = {
  emojiName: string;
  emojiSlot: React.ReactNode;
  reacters: string;
};

const TooltipPreview = memo(
  ({ emojiName, emojiSlot, reacters }: TTooltipPreviewProps) => {
    const { t } = useTranslation('common');

    return (
      <div className="flex items-center gap-2 max-w-xs wrap-break-word whitespace-pre-wrap text-sm">
        <div className="flex items-center flex-col">
          {emojiSlot}
          <span className="text-[8px]">:{emojiName}:</span>
        </div>
        <span className="text-xs">{t('wasReactedBy', { reacters })}</span>
      </div>
    );
  }
);

type TEmojiProps = {
  emoji: string;
  nativeEmojiClassName?: string;
};

const Emoji = memo(({ emoji, nativeEmojiClassName }: TEmojiProps) => {
  const gitHubEmoji = useMemo(
    () =>
      gitHubEmojis.find(
        (e) => e.name === emoji || e.shortcodes.includes(emoji)
      ),
    [emoji]
  );

  if (gitHubEmoji?.emoji) {
    return (
      <span className={cn('text-sm', nativeEmojiClassName)}>
        {gitHubEmoji.emoji}
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">:{emoji}:</span>;
});

type TReactionProps = {
  emoji: string;
  count: number;
  isUserReacted: boolean;
  onClick: () => void;
  userIds: number[];
};

const Reaction = memo(
  ({ emoji, count, isUserReacted, onClick, userIds }: TReactionProps) => {
    const { t } = useTranslation('common');
    const usernames = useUsernames();
    const tooltipContent = useMemo(() => {
      const names = userIds
        .slice(0, MAX_REACTORS_PREVIEW)
        .map((userId) => usernames[userId] || 'Unknown');

      if (userIds.length > MAX_REACTORS_PREVIEW) {
        names.push(
          t('andMore', { count: userIds.length - MAX_REACTORS_PREVIEW })
        );
      }

      return names.join(', ');
    }, [userIds, usernames, t]);

    return (
      <Tooltip
        content={
          <TooltipPreview
            emojiName={emoji}
            reacters={tooltipContent}
            emojiSlot={
              <Emoji emoji={emoji} nativeEmojiClassName="text-[28px]" />
            }
          />
        }
      >
        <Button
          size="sm"
          variant="outline"
          onClick={onClick}
          className={cn(
            'flex items-center gap-1 h-9',
            isUserReacted ? 'border-border' : 'border-none'
          )}
        >
          <Emoji emoji={emoji} />
          <span className="font-medium">{count}</span>
        </Button>
      </Tooltip>
    );
  }
);

type TMessageReactionsProps = {
  messageId: number;
  reactions: TJoinedMessageReaction[];
};

type TAggregatedReaction = {
  emoji: string;
  count: number;
  userIds: number[];
  isUserReacted: boolean;
  createdAt: number;
};

const MessageReactions = memo(
  ({ messageId, reactions }: TMessageReactionsProps) => {
    const { t } = useTranslation();
    const ownUserId = useOwnUserId();

    const handleReactionClick = useCallback(
      async (emoji: string) => {
        if (!ownUserId) return;

        const trpc = getTRPCClient();

        try {
          await trpc.messages.toggleReaction.mutate({
            messageId,
            emoji
          });
        } catch (error) {
          toast.error(getTrpcError(error, t('failedToggleReaction')));
        }
      },
      [messageId, ownUserId, t]
    );

    const aggregatedReactions = useMemo((): TAggregatedReaction[] => {
      const reactionMap = new Map<string, TAggregatedReaction>();

      reactions.forEach((reaction) => {
        if (!reactionMap.has(reaction.emoji)) {
          reactionMap.set(reaction.emoji, {
            emoji: reaction.emoji,
            count: 0,
            userIds: [],
            isUserReacted: false,
            createdAt: reaction.createdAt
          });
        }

        const aggregated = reactionMap.get(reaction.emoji)!;

        aggregated.count++;
        aggregated.userIds.push(reaction.userId);

        if (ownUserId && reaction.userId === ownUserId) {
          aggregated.isUserReacted = true;
        }
      });

      // sort by first reaction createdAt desc
      return Array.from(reactionMap.values()).sort(
        (a, b) => b.createdAt + a.createdAt
      );
    }, [reactions, ownUserId]);

    if (!aggregatedReactions.length) return null;

    return (
      <div className="mt-1 flex flex-wrap gap-1">
        {aggregatedReactions.map((reaction) => (
          <Reaction
            key={reaction.emoji}
            emoji={reaction.emoji}
            count={reaction.count}
            userIds={reaction.userIds}
            isUserReacted={reaction.isUserReacted}
            onClick={() => handleReactionClick(reaction.emoji)}
          />
        ))}
      </div>
    );
  }
);

export { MessageReactions };
