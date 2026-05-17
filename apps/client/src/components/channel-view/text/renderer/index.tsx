import { RelativeTime } from '@/components/relative-time';
import { openClaudeCodePanel } from '@/features/app/actions';
import { useUserById } from '@/features/server/users/hooks';
import { getFileUrl } from '@/helpers/get-file-url';
import { getRenderedUsername } from '@/helpers/get-rendered-username';
import { cn } from '@/lib/utils';
import {
  type TClaudeCodeTaskMetadata,
  type TFile,
  type TJoinedMessage
} from '@mikotord/shared';
import { Tooltip } from '@mikotord/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageReactions } from '../message-reactions';
import { TextFileTabs } from '../text-file-tabs';
import { getIsEmojiOnly, getParsedMessageHtml } from './content-cache';
import { extractMessageOpenGraph } from './helpers';
import { Media } from './media';
import { extractMessageMedia } from './media-cache';
import { OpenGraph } from './open-graph';

type TMessageRendererProps = {
  message: TJoinedMessage;
  disableFiles?: boolean;
  disableReactions?: boolean;
  compactMedia?: boolean;
  activeFileId?: number;
  onRenameFile?: (file: TFile, name: string) => void;
};

const MessageRenderer = memo(
  ({
    message,
    disableFiles,
    disableReactions,
    compactMedia,
    activeFileId,
    onRenameFile
  }: TMessageRendererProps) => {
    const { t } = useTranslation();
    const editedByUser = useUserById(message.editedBy ?? -1);

    const emojiOnly = useMemo(() => getIsEmojiOnly(message), [message]);

    const messageHtml = useMemo(() => getParsedMessageHtml(message), [message]);
    const claudeCodeTask = useMemo(
      () =>
        (message.metadata ?? []).find(
          (metadata): metadata is TClaudeCodeTaskMetadata =>
            metadata?.kind === 'claude_code_task'
        ),
      [message.metadata]
    );
    const isClaudeCodeRunning = claudeCodeTask?.status === 'running';
    const hasMessageContent = useMemo(() => {
      const content = message.content ?? '';

      return (
        content
          .replace(/<br\s*\/?>/gi, '')
          .replace(/<\/?p[^>]*>/gi, '')
          .replace(/&nbsp;/gi, '')
          .trim().length > 0
      );
    }, [message.content]);

    const allMedia = useMemo(
      () =>
        extractMessageMedia(message).filter(
          (item) => !item.key.startsWith('file:')
        ),
      [message]
    );
    const openGraphPreviews = useMemo(
      () => extractMessageOpenGraph(message, allMedia),
      [message, allMedia]
    );

    return (
      <div className="message-renderer flex w-fit max-w-full flex-col gap-1 [&:has([data-attachment-expanded=true])]:w-full">
        {(hasMessageContent || message.editedAt) && (
          <div
            className={cn(
              'prose max-w-full wrap-break-word msg-content',
              emojiOnly && 'emoji-only',
              message.editedAt && 'msg-edited'
            )}
          >
            {messageHtml}
            {message.editedAt && (
              <Tooltip
                content={
                  <div className="flex flex-col gap-1">
                    <RelativeTime date={new Date(message.editedAt)}>
                      {(relativeTime) => (
                        <span className="text-secondary text-xs">
                          {editedByUser
                            ? getRenderedUsername(editedByUser)
                            : t('unknownUser')}{' '}
                          {relativeTime}
                        </span>
                      )}
                    </RelativeTime>
                  </div>
                }
              >
                <span className="msg-edit ml-1 text-xs text-muted-foreground">
                  {t('edited')}
                </span>
              </Tooltip>
            )}
          </div>
        )}

        {isClaudeCodeRunning && (
          <button
            type="button"
            className="flex w-fit items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-left text-sm text-emerald-100 hover:bg-emerald-500/15"
            onClick={openClaudeCodePanel}
          >
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="font-medium">正在处理...</span>
            <span className="text-emerald-200/70 underline">展开</span>
          </button>
        )}

        <Media media={allMedia} compact={compactMedia} />
        <OpenGraph previews={openGraphPreviews} />

        {!disableReactions && (
          <MessageReactions
            reactions={message.reactions}
            messageId={message.id}
          />
        )}

        {message.files.length > 0 && !disableFiles && (
          <div className="message-attachments flex w-fit max-w-full flex-wrap items-start gap-2 [&:has([data-attachment-expanded=true])]:w-full">
            <TextFileTabs
              files={message.files.map((file) => ({
                id: file.id,
                key: `message-file-${file.id}`,
                originalName: file.originalName,
                size: file.size,
                extension: file.extension,
                mimeType: file.mimeType,
                href: getFileUrl(file),
                onRename: onRenameFile
                  ? (name) => onRenameFile(file, name)
                  : undefined
              }))}
              activeFileId={activeFileId}
              disableInlinePreview={compactMedia}
            />
          </div>
        )}
      </div>
    );
  }
);

export { MessageRenderer };
