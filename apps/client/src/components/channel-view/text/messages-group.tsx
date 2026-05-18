import { PluginAvatar } from '@/components/plugin-avatar';
import { RelativeTime } from '@/components/relative-time';
import { UserAvatar } from '@/components/user-avatar';
import { usePluginMetadata } from '@/features/server/plugins/hooks';
import { useIsOwnUser, useUserById } from '@/features/server/users/hooks';
import { cn } from '@/lib/utils';
import {
  DELETED_USER_IDENTITY_AND_NAME,
  type TJoinedMessage
} from '@mikotord/shared';
import { format } from 'date-fns';
import { memo } from 'react';
import { areGroupsEqual } from './helpers';
import { useMessageAuthorName } from './hooks/use-message-author-name';
import { Message } from './message';
import { MessageReplyPreviewWrapper } from './message-reply-preview-wrapper';

type TMessagesGroupProps = {
  group: TJoinedMessage[];
  disableActions?: boolean;
  disableFiles?: boolean;
  disableReactions?: boolean;
  compactMedia?: boolean;
  onReplyMessageSelect?: (message: TJoinedMessage) => void;
  onEditMessageSelect?: (message: TJoinedMessage) => void;
  replyTargetMessageId?: number;
  activeThreadMessageId?: number;
  claudeCodePanelMessageId?: number;
  allowClaudeCodePanelOpen?: boolean;
};

const MessagesGroup = memo(
  ({
    group,
    disableActions,
    disableFiles,
    disableReactions,
    compactMedia,
    onReplyMessageSelect,
    onEditMessageSelect,
    replyTargetMessageId,
    activeThreadMessageId,
    claudeCodePanelMessageId,
    allowClaudeCodePanelOpen
  }: TMessagesGroupProps) => {
    const firstMessage = group[0];
    const pluginMetadata = usePluginMetadata(firstMessage.pluginId);
    const user = useUserById(firstMessage.userId);
    const date = new Date(firstMessage.createdAt);
    const isOwnUser = useIsOwnUser(firstMessage.userId);
    const authorName = useMessageAuthorName(firstMessage);
    const isDeletedUser = user?.name === DELETED_USER_IDENTITY_AND_NAME;
    const isPluginMessage = !!firstMessage.pluginId;

    const isReplyToMessage =
      group.length === 1 && !!firstMessage.replyToMessageId;

    const renderMessage = (message: TJoinedMessage) => (
      <div
        key={message.id}
        id={`message-${message.id}`}
        className="flex w-full max-w-full rounded-md"
      >
        <Message
          message={message}
          disableActions={disableActions}
          disableFiles={disableFiles}
          disableReactions={disableReactions}
          compactMedia={compactMedia}
          onReplyMessageSelect={onReplyMessageSelect}
          onEditMessageSelect={onEditMessageSelect}
          isInlineReplyTarget={message.id === replyTargetMessageId}
          isActiveThread={message.id === activeThreadMessageId}
          showClaudeCodePanelHost={message.id === claudeCodePanelMessageId}
          allowClaudeCodePanelOpen={allowClaudeCodePanelOpen}
        />
      </div>
    );

    const renderFollowUpMessage = (message: TJoinedMessage) => {
      const messageDate = new Date(message.createdAt);

      return (
        <div
          key={message.id}
          className="group/followup flex min-w-0 items-start gap-3"
        >
          <div className="flex h-7 w-12 shrink-0 items-start justify-end pr-1 pt-1 select-none">
            <span
              className="text-primary/50 text-xs leading-5 opacity-0 transition-opacity group-hover/followup:opacity-100"
              title={format(messageDate, 'PPpp')}
            >
              {format(messageDate, 'HH:mm')}
            </span>
          </div>
          <div className="min-w-0 flex-1">{renderMessage(message)}</div>
        </div>
      );
    };

    const groupContent = (
      <div className="flex min-w-0 max-w-dvw flex-col gap-1.5 pl-2 pt-2 pr-2">
        <div className="flex min-w-0 items-start gap-3">
          {isPluginMessage ? (
            <PluginAvatar
              name={pluginMetadata?.name}
              avatarUrl={pluginMetadata?.avatarUrl}
              className="h-12 w-12"
            />
          ) : (
            <UserAvatar
              userId={user!.id}
              className="h-12 w-12"
              showUserPopover
            />
          )}
          <div className="flex min-w-0 w-full flex-col pt-0">
            <div className="flex min-h-6 items-start gap-2 pl-1 leading-none select-none">
              <span
                className={cn(
                  'leading-none',
                  isOwnUser && 'font-bold',
                  isDeletedUser && 'line-through text-muted-foreground',
                  isPluginMessage && 'text-primary/80'
                )}
              >
                {authorName}
              </span>
              {isPluginMessage && (
                <span className="inline-flex items-center rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary/60 uppercase tracking-wide">
                  bot
                </span>
              )}
              <RelativeTime date={date}>
                {(relativeTime) => (
                  <span
                    className="pt-0.5 text-primary/60 text-xs leading-none"
                    title={format(date, 'PPpp')}
                  >
                    {relativeTime}
                  </span>
                )}
              </RelativeTime>
            </div>
            <div className="flex min-w-0 flex-col items-start">
              {renderMessage(firstMessage)}
            </div>
          </div>
        </div>

        {group.length > 1 && (
          <div className="flex flex-col gap-1.5">
            {group.slice(1).map((message) => renderFollowUpMessage(message))}
          </div>
        )}
      </div>
    );

    if (isReplyToMessage) {
      return (
        <MessageReplyPreviewWrapper message={firstMessage}>
          {groupContent}
        </MessageReplyPreviewWrapper>
      );
    }

    return groupContent;
  },
  areGroupsEqual
);

export { MessagesGroup };
