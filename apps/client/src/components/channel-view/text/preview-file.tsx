import { FullScreenImage } from '@/components/fullscreen-image/content';
import {
  getFileNameWithLockedExtension,
  splitFileNameForLockedExtension
} from '@/helpers/file-name';
import type { TDisplayItem } from '@/hooks/use-upload-files';
import { cn } from '@/lib/utils';
import { FileCategory, getFileCategory } from '@mikotord/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@mikotord/ui';
import { filesize } from 'filesize';
import {
  File,
  FileImage,
  FileText,
  Loader2,
  Maximize2,
  TextCursorInput,
  X
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextFilePreview } from './text-file-preview';
import {
  MAX_TEXT_PREVIEW_BYTES,
  isTextPreviewableFile
} from './text-file-preview-helpers';

const categoryIconMap: Record<FileCategory, React.ElementType> = {
  [FileCategory.IMAGE]: FileImage,
  [FileCategory.DOCUMENT]: FileText,
  [FileCategory.OTHER]: File
};

type TUploadProgressBarProps = {
  progress: number;
};

const UploadProgressBar = memo(({ progress }: TUploadProgressBarProps) => (
  <div className="absolute bottom-0 left-0 right-0 h-1 bg-muted">
    <div
      className="h-full bg-primary transition-all duration-200"
      style={{ width: `${progress}%` }}
    />
  </div>
));

type TPreviewFileProps = {
  item: TDisplayItem;
  onRemove?: () => void;
  onRename?: (name: string) => void;
};

const PreviewFile = memo(({ item, onRemove, onRename }: TPreviewFileProps) => {
  const { name, size, extension, mimeType, previewUrl, progress, sourceFile } =
    item;
  const { t } = useTranslation('common');
  const nameParts = useMemo(
    () => splitFileNameForLockedExtension(name, extension),
    [extension, name]
  );
  const [draftBaseName, setDraftBaseName] = useState(nameParts.baseName);
  const [isRenaming, setIsRenaming] = useState(false);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [textPreviewContent, setTextPreviewContent] = useState('');
  const [textPreviewStatus, setTextPreviewStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error' | 'too-large'
  >('idle');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameCommitRef = useRef(false);
  const editableBaseNameWidthCh = useMemo(() => {
    const extensionLength = nameParts.extension.length;
    const availableLength = Math.max(1, 30 - extensionLength);

    return Math.min(Math.max(draftBaseName.length + 1, 8), availableLength);
  }, [draftBaseName.length, nameParts.extension.length]);

  const category = useMemo(() => getFileCategory(extension), [extension]);
  const isImage = category === FileCategory.IMAGE;
  const isUploading = progress !== undefined && progress < 100;

  const onRemoveClick = useCallback(
    (e: React.MouseEvent) => {
      if (onRemove) {
        e.preventDefault();
        e.stopPropagation();
        onRemove();
      }
    },
    [onRemove]
  );

  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    setDraftBaseName(nameParts.baseName);
    setIsRenaming(false);
  }, [nameParts.baseName]);

  useEffect(() => {
    if (!isRenaming) return;

    const input = renameInputRef.current;

    input?.focus();
    input?.select();
  }, [isRenaming]);

  const onPreviewError = useCallback(() => {
    setPreviewError(true);
  }, []);

  const hasPreview = !!previewUrl && !previewError && isImage;
  const canPreviewText = useMemo(
    () =>
      (!!previewUrl || !!sourceFile) &&
      isTextPreviewableFile({
        name,
        extension,
        mimeType
      }),
    [extension, mimeType, name, previewUrl, sourceFile]
  );
  const canFullscreenPreview = (!!previewUrl && isImage) || canPreviewText;
  const Icon = categoryIconMap[category] || File;
  const canRename = !!onRename && !isUploading;

  const startRenaming = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      skipRenameCommitRef.current = false;
      setDraftBaseName(nameParts.baseName);
      setIsRenaming(true);
    },
    [nameParts.baseName]
  );

  const cancelRenaming = useCallback(() => {
    skipRenameCommitRef.current = true;
    setDraftBaseName(nameParts.baseName);
    setIsRenaming(false);
  }, [nameParts.baseName]);

  const commitRenaming = useCallback(() => {
    if (!draftBaseName.trim()) {
      cancelRenaming();
      return;
    }

    const nextName = getFileNameWithLockedExtension(
      name,
      extension,
      draftBaseName
    );

    if (nextName) {
      onRename?.(nextName);
    } else {
      setDraftBaseName(nameParts.baseName);
    }

    setIsRenaming(false);
  }, [
    cancelRenaming,
    draftBaseName,
    extension,
    name,
    nameParts.baseName,
    onRename
  ]);

  const onRenameInputBlur = useCallback(() => {
    if (skipRenameCommitRef.current) {
      skipRenameCommitRef.current = false;
      return;
    }

    commitRenaming();
  }, [commitRenaming]);

  useEffect(() => {
    setFullscreenOpen(false);
    setTextPreviewContent('');
    setTextPreviewStatus('idle');
  }, [previewUrl]);

  const openFullscreenPreview = useCallback(
    async (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!canFullscreenPreview) return;

      if (isImage) {
        if (!previewUrl) return;

        setFullscreenOpen(true);
        return;
      }

      if (size > MAX_TEXT_PREVIEW_BYTES) {
        setTextPreviewStatus('too-large');
        setFullscreenOpen(true);
        return;
      }

      if (textPreviewStatus === 'ready') {
        setFullscreenOpen(true);
        return;
      }

      setTextPreviewStatus('loading');
      setFullscreenOpen(true);

      try {
        if (sourceFile) {
          setTextPreviewContent(await sourceFile.text());
          setTextPreviewStatus('ready');
          return;
        }

        if (!previewUrl) {
          throw new Error('Missing preview URL');
        }

        const response = await fetch(previewUrl);

        if (!response.ok) {
          throw new Error('Failed to fetch file preview');
        }

        setTextPreviewContent(await response.text());
        setTextPreviewStatus('ready');
      } catch {
        setTextPreviewStatus('error');
      }
    },
    [
      canFullscreenPreview,
      isImage,
      previewUrl,
      size,
      sourceFile,
      textPreviewStatus
    ]
  );

  return (
    <>
      <div className="relative flex w-fit max-w-full items-center gap-3 overflow-hidden rounded-md border border-border bg-background p-3 select-none transition-all duration-200 hover:border-primary/50 hover:bg-accent hover:shadow-md">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted transition-colors duration-200">
          {hasPreview && isImage ? (
            <FullScreenImage
              src={previewUrl}
              alt={name}
              className="h-full w-full object-cover"
              onError={onPreviewError}
            />
          ) : (
            <div
              className={cn(
                'flex h-full w-full items-center justify-center bg-muted/50',
                isUploading && 'opacity-60'
              )}
            >
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
          )}

          {isUploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <span
                className="text-[10px] font-medium text-white"
                title={`${progress}%`}
              >
                {progress}%
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 max-w-[30ch] flex-none flex-col overflow-hidden">
          {canRename && isRenaming ? (
            <div className="flex min-w-0 max-w-full items-center">
              <span className="flex max-w-full overflow-hidden rounded border border-transparent hover:border-border focus-within:border-ring">
                <input
                  ref={renameInputRef}
                  value={draftBaseName}
                  title={name}
                  className="max-w-full bg-transparent px-0 text-sm font-medium text-foreground outline-none"
                  style={{ width: `${editableBaseNameWidthCh}ch` }}
                  onChange={(event) => setDraftBaseName(event.target.value)}
                  onBlur={onRenameInputBlur}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }

                    if (event.key === 'Escape') {
                      cancelRenaming();
                      event.currentTarget.blur();
                    }
                  }}
                />
              </span>
              {nameParts.extension && (
                <span
                  className="shrink-0 text-sm font-medium text-muted-foreground"
                  title={nameParts.extension}
                >
                  {nameParts.extension}
                </span>
              )}
            </div>
          ) : (
            <span
              className="truncate text-sm font-medium text-foreground"
              title={name}
            >
              {name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {filesize(size)}
          </span>
        </div>

        {canRename && !isRenaming && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 transition-opacity duration-200"
            onClick={startRenaming}
            title={t('renameFile')}
          >
            <TextCursorInput className="h-4 w-4" />
          </Button>
        )}

        {canFullscreenPreview && !isRenaming && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 transition-opacity duration-200"
            onClick={openFullscreenPreview}
            title={t('fullscreenFilePreview')}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        )}

        {onRemove && !isRenaming && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 transition-opacity duration-200"
            onClick={onRemoveClick}
          >
            <X className="h-4 w-4" />
          </Button>
        )}

        {isUploading && <UploadProgressBar progress={progress} />}
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-[calc(100dvw-2rem)] flex-col gap-0 overflow-hidden bg-[#262626] p-0 sm:max-w-[calc(100dvw-2rem)]">
          <DialogHeader className="sr-only">
            <DialogTitle>{name}</DialogTitle>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-0 right-3 z-10 h-9 w-9 rounded-md bg-[#262626]/95 shadow-sm hover:bg-[#262626]/95 focus-visible:bg-[#262626]/95 active:bg-[#262626]/95 data-[state=open]:bg-[#262626]/95"
            title={t('close')}
            onClick={() => setFullscreenOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>

          {isImage && previewUrl && (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4">
              <img
                src={previewUrl}
                alt={name}
                className="max-h-full max-w-full rounded-md object-contain"
              />
            </div>
          )}

          {!isImage && textPreviewStatus === 'loading' && (
            <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4" />
              {t('loadingFilePreview')}
            </div>
          )}

          {!isImage && textPreviewStatus === 'ready' && (
            <TextFilePreview
              content={textPreviewContent}
              name={name}
              extension={extension}
              mimeType={mimeType}
              fullHeight
            />
          )}

          {!isImage && textPreviewStatus === 'too-large' && (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
              {t('filePreviewTooLarge')}
            </div>
          )}

          {!isImage && textPreviewStatus === 'error' && (
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
              {t('failedPreviewFile')}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
});

export { PreviewFile, UploadProgressBar };
