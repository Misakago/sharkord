import { RelativeTime } from '@/components/relative-time';
import { openClaudeCodePanel } from '@/features/app/actions';
import { useUserById } from '@/features/server/users/hooks';
import { getFileUrl } from '@/helpers/get-file-url';
import { getRenderedUsername } from '@/helpers/get-rendered-username';
import { cn } from '@/lib/utils';
import {
  type TClaudeCodeAskUserQuestionMetadata,
  type TClaudeCodeTaskMetadata,
  type TFile,
  type TJoinedMessage
} from '@mikotord/shared';
import { Tooltip } from '@mikotord/ui';
import MDEditor from '@uiw/react-md-editor';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageReactions } from '../message-reactions';
import { TextFileTabs } from '../text-file-tabs';
import { ClaudeCodeAskUserQuestion } from './claude-code-ask-user-question';
import {
  getIsEmojiOnly,
  getMessageMarkdownSource,
  getParsedMessageHtml
} from './content-cache';
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
  showClaudeCodePanelHost?: boolean;
};

const MessageRenderer = memo(
  ({
    message,
    disableFiles,
    disableReactions,
    compactMedia,
    activeFileId,
    onRenameFile,
    showClaudeCodePanelHost
  }: TMessageRendererProps) => {
    const { t } = useTranslation();
    const editedByUser = useUserById(message.editedBy ?? -1);

    const emojiOnly = useMemo(() => getIsEmojiOnly(message), [message]);

    const messageHtml = useMemo(() => getParsedMessageHtml(message), [message]);
    const messageMarkdownSource = useMemo(
      () => getMessageMarkdownSource(message.content),
      [message.content]
    );
    const claudeCodeTask = useMemo(
      () =>
        (message.metadata ?? []).find(
          (metadata): metadata is TClaudeCodeTaskMetadata =>
            metadata?.kind === 'claude_code_task'
        ),
      [message.metadata]
    );
    const claudeCodeQuestions = useMemo(
      () =>
        (message.metadata ?? []).filter(
          (metadata): metadata is TClaudeCodeAskUserQuestionMetadata =>
            metadata?.kind === 'claude_code_ask_user_question'
        ),
      [message.metadata]
    );
    const isClaudeCodeActive =
      claudeCodeTask?.status === 'running' ||
      claudeCodeTask?.status === 'waiting_for_user';
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
    const shouldUseContentFilePreview =
      (hasMessageContent || !!message.editedAt) &&
      message.files.length > 0 &&
      !disableFiles;
    const editedIndicator = message.editedAt ? (
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
    ) : null;
    const messageContent = messageMarkdownSource !== undefined ? (
      <div data-color-mode="dark" className="max-w-full">
        <MDEditor.Markdown
          source={messageMarkdownSource}
          className="!bg-transparent text-sm"
        />
        {editedIndicator}
      </div>
    ) : hasMessageContent || message.editedAt ? (
      <div
        className={cn(
          'prose max-w-full wrap-break-word msg-content',
          emojiOnly && 'emoji-only',
          message.editedAt && 'msg-edited'
        )}
      >
        {messageHtml}
        {editedIndicator}
      </div>
    ) : null;

    return (
      <div className="message-renderer flex w-fit max-w-full flex-col gap-1 [&:has([data-attachment-expanded=true])]:w-full">
        {!shouldUseContentFilePreview && messageContent}

        {claudeCodeQuestions.map((claudeCodeQuestion) => (
          <ClaudeCodeAskUserQuestion
            key={claudeCodeQuestion.requestId}
            question={claudeCodeQuestion}
          />
        ))}

        {isClaudeCodeActive && (
          <button
            type="button"
            className="flex w-fit items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-left text-sm text-emerald-100 hover:bg-emerald-500/15"
            onClick={openClaudeCodePanel}
          >
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="font-medium">
              {claudeCodeTask?.status === 'waiting_for_user'
                ? '等待回答...'
                : '正在处理...'}
            </span>
            <span className="text-emerald-200/70 underline">展开</span>
          </button>
        )}

        {showClaudeCodePanelHost && (
          <div
            data-claude-code-active-panel-host="true"
            className="mt-2"
          />
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
              contentTab={
                shouldUseContentFilePreview && messageContent
                  ? {
                      label: '回复',
                      content: messageContent
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>
    );
  }
);

export { MessageRenderer };
