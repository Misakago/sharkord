import { RelativeTime } from '@/components/relative-time';
import { getFileUrl } from '@/helpers/get-file-url';
import type { TMessageJumpToTarget } from '@/types';
import { AtSign, Hash } from 'lucide-react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { memo, useCallback } from 'react';
import type { TSearchResultFile } from './types';

type TSearchResultFileCardProps = {
  result: TSearchResultFile;
  onOpen: (target: TMessageJumpToTarget) => void;
  onJump: (target: TMessageJumpToTarget) => void;
};

const SearchResultFileCard = memo(
  ({ result, onOpen, onJump }: TSearchResultFileCardProps) => {
    const getTarget = useCallback(
      (): TMessageJumpToTarget => ({
        channelId: result.channelId,
        messageId: result.messageId,
        isDm: result.channelIsDm,
        threadParentMessageId: result.parentMessageId,
        fileId: result.file.id
      }),
      [
        result.channelId,
        result.channelIsDm,
        result.file.id,
        result.messageId,
        result.parentMessageId
      ]
    );

    const handleJump = useCallback(() => {
      onJump(getTarget());
    }, [getTarget, onJump]);

    const handleOpen = useCallback(() => {
      onOpen(getTarget());
    }, [getTarget, onOpen]);

    const handleCardKeyDown = useCallback(
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      },
      [handleOpen]
    );

    const stopJump = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
      event.stopPropagation();
    }, []);

    return (
      <div
        className="overflow-hidden rounded-lg border border-border bg-accent px-3 py-2 hover:bg-accent/80 cursor-pointer"
        onClick={handleJump}
        onDoubleClick={handleOpen}
        onKeyDown={handleCardKeyDown}
        role="button"
        tabIndex={0}
      >
        <div className="flex min-w-0 items-center gap-2">
          <a
            href={getFileUrl(result.file)}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
            onClick={stopJump}
          >
            {result.file.originalName}
          </a>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1">
            {result.channelIsDm ? (
              <AtSign className="h-3 w-3" />
            ) : (
              <Hash className="h-3 w-3" />
            )}
            <span className="truncate wrap-anywhere">{result.channelName}</span>
          </span>
          <RelativeTime date={new Date(result.messageCreatedAt)}>
            {(relativeTime) => <span>{relativeTime}</span>}
          </RelativeTime>
        </div>
      </div>
    );
  }
);

export { SearchResultFileCard };
