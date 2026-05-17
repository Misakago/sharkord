import { PluginAvatar } from '@/components/plugin-avatar';
import { RelativeTime } from '@/components/relative-time';
import { useThreadSidebar } from '@/features/app/hooks';
import { useCan } from '@/features/server/hooks';
import { useParentMessage } from '@/features/server/messages/hooks';
import { usePluginMetadata } from '@/features/server/plugins/hooks';
import { useIsOwnUser, useUserById } from '@/features/server/users/hooks';
import { uploadFile } from '@/helpers/upload-file';
import { getTRPCClient } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  DELETED_USER_IDENTITY_AND_NAME,
  getTrpcError,
  Permission,
  type TFile,
  type TJoinedMessage
} from '@mikotord/shared';
import { Spinner } from '@mikotord/ui';
import { format } from 'date-fns';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMessageAuthorName } from '../channel-view/text/hooks/use-message-author-name';
import { MessageRenderer } from '../channel-view/text/renderer';
import { UserAvatar } from '../user-avatar';

type TParentMessageContentProps = {
  parentMessage: TJoinedMessage;
};

const ParentMessageContent = memo(
  ({ parentMessage }: TParentMessageContentProps) => {
    const { t } = useTranslation('common');
    const pluginMetadata = usePluginMetadata(parentMessage.pluginId);
    const isPluginMessage = !!parentMessage.pluginId;
    const user = useUserById(parentMessage.userId);
    const isOwnUser = useIsOwnUser(parentMessage.userId);
    const can = useCan();
    const isDeletedUser = user?.name === DELETED_USER_IDENTITY_AND_NAME;
    const authorName = useMessageAuthorName(parentMessage);
    const date = new Date(parentMessage.createdAt);
    const canManage = useMemo(
      () => can(Permission.MANAGE_MESSAGES) || isOwnUser,
      [can, isOwnUser]
    );
    const renameMessageFile = useCallback(
      async (fileToRename: TFile, name: string) => {
        if (!parentMessage.editable || !canManage) return;
        if (name === fileToRename.originalName) return;

        const trpc = getTRPCClient();

        try {
          await trpc.messages.edit.mutate({
            messageId: parentMessage.id,
            content: parentMessage.content ?? '',
            files: parentMessage.files.map((file) => ({
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
        parentMessage.content,
        parentMessage.editable,
        parentMessage.files,
        parentMessage.id,
        t
      ]
    );
    const replaceMessageFile = useCallback(
      async (fileToReplace: TFile, replacement: File) => {
        if (!parentMessage.editable || !canManage) return;

        const temporaryFile = await uploadFile(replacement);

        if (!temporaryFile) {
          throw new Error(t('failedSaveFile'));
        }

        const trpc = getTRPCClient();

        await trpc.files.replaceMessageFile.mutate({
          messageId: parentMessage.id,
          fileId: fileToReplace.id,
          temporaryFileId: temporaryFile.id,
          name: replacement.name || fileToReplace.originalName
        });
      },
      [canManage, parentMessage.editable, parentMessage.id, t]
    );

    return (
      <div className="overflow-x-hidden border-b border-border px-2 py-2">
        <div className="flex min-w-0 max-w-dvw items-start gap-3 pl-2 pt-2 pr-2">
          {isPluginMessage ? (
            <PluginAvatar
              name={pluginMetadata?.name}
              avatarUrl={pluginMetadata?.avatarUrl}
              className="h-12 w-12"
            />
          ) : (
            <UserAvatar
              userId={user?.id ?? parentMessage.userId}
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
              <div className="flex w-full max-w-full rounded-md">
                <div className="relative ml-1 inline-flex w-fit max-w-full flex-col rounded-md px-1 py-0.5 hover:bg-accent">
                  <MessageRenderer
                    message={parentMessage}
                    compactMedia
                    onRenameFile={
                      parentMessage.editable && canManage
                        ? renameMessageFile
                        : undefined
                    }
                    onReplaceFile={
                      parentMessage.editable && canManage
                        ? replaceMessageFile
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

type TParentMessagePreviewProps = {
  messageId: number;
};

const ParentMessagePreview = memo(
  ({ messageId }: TParentMessagePreviewProps) => {
    const { channelId } = useThreadSidebar();
    const parentMessage = useParentMessage(messageId, channelId);

    if (!parentMessage) {
      return (
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Spinner size="xs" />
          <span className="text-sm text-muted-foreground">
            Loading message...
          </span>
        </div>
      );
    }

    return <ParentMessageContent parentMessage={parentMessage} />;
  }
);

export { ParentMessagePreview };
