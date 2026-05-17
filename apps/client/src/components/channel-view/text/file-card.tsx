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
  Download,
  File,
  FileImage,
  FileText,
  Loader2,
  Maximize2,
  Trash,
  X
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextFilePreview } from './text-file-preview';
import {
  MAX_TEXT_PREVIEW_BYTES,
  isTextPreviewableFile
} from './text-file-preview-helpers';

type TFileIconProps = {
  extension: string;
};

const categoryMap: Record<FileCategory, React.ElementType> = {
  [FileCategory.IMAGE]: FileImage,
  [FileCategory.DOCUMENT]: FileText,
  [FileCategory.OTHER]: File
};

const FileIcon = memo(({ extension }: TFileIconProps) => {
  const category = useMemo(() => getFileCategory(extension), [extension]);
  const className = 'h-5 w-5 text-muted-foreground';

  const Icon = categoryMap[category] || File;

  return <Icon className={className} />;
});

type TFileCardProps = {
  name: string;
  size: number;
  extension: string;
  mimeType?: string;
  href?: string;
  onRemove?: () => void;
  disableInlinePreview?: boolean;
};

type TPreviewStatus = 'idle' | 'loading' | 'ready' | 'error' | 'too-large';

const FileCard = ({
  name,
  size,
  extension,
  mimeType,
  href,
  onRemove,
  disableInlinePreview
}: TFileCardProps) => {
  const { t } = useTranslation('common');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<TPreviewStatus>('idle');
  const [previewContent, setPreviewContent] = useState('');
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const previewAbortControllerRef = useRef<AbortController | null>(null);
  const canPreviewText = useMemo(
    () =>
      !!href &&
      isTextPreviewableFile({
        name,
        extension,
        mimeType
      }),
    [extension, href, mimeType, name]
  );
  const previewTooLarge = size > MAX_TEXT_PREVIEW_BYTES;

  useEffect(() => {
    previewAbortControllerRef.current?.abort();
    previewAbortControllerRef.current = null;
    setPreviewOpen(false);
    setFullscreenOpen(false);
    setPreviewContent('');
    setPreviewStatus('idle');

    return () => previewAbortControllerRef.current?.abort();
  }, [href, size]);

  const onRemoveClick = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove]
  );
  const downloadFile = useCallback(async () => {
    if (!href || downloading) return;

    setDownloading(true);

    try {
      const response = await fetch(href);

      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');

      link.href = url;
      link.download = name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      // The public file endpoint already reports download failures.
    } finally {
      setDownloading(false);
    }
  }, [downloading, href, name]);
  const togglePreview = useCallback(async () => {
    if (disableInlinePreview) return;
    if (!canPreviewText || !href || previewStatus === 'loading') return;

    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }

    if (previewTooLarge) {
      setPreviewStatus('too-large');
      setPreviewOpen(true);
      return;
    }

    if (previewStatus === 'ready') {
      setPreviewOpen(true);
      return;
    }

    previewAbortControllerRef.current?.abort();

    const controller = new AbortController();

    previewAbortControllerRef.current = controller;
    setPreviewStatus('loading');

    try {
      const response = await fetch(href, { signal: controller.signal });

      if (!response.ok) {
        throw new Error('Failed to fetch file preview');
      }

      setPreviewContent(await response.text());
      setPreviewStatus('ready');
      setPreviewOpen(true);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setPreviewStatus('error');
        setPreviewOpen(true);
      }
    } finally {
      if (previewAbortControllerRef.current === controller) {
        previewAbortControllerRef.current = null;
      }
    }
  }, [
    canPreviewText,
    disableInlinePreview,
    href,
    previewOpen,
    previewStatus,
    previewTooLarge
  ]);
  const onDownloadClick = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      await downloadFile();
    },
    [downloadFile]
  );
  const openFullscreenPreview = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();

      if (!canPreviewText || !href || previewStatus === 'loading') return;

      if (previewTooLarge) {
        setPreviewStatus('too-large');
        if (!disableInlinePreview) {
          setPreviewOpen(true);
        }
        return;
      }

      if (previewStatus === 'ready') {
        setFullscreenOpen(true);
        return;
      }

      previewAbortControllerRef.current?.abort();

      const controller = new AbortController();

      previewAbortControllerRef.current = controller;
      setPreviewStatus('loading');

      try {
        const response = await fetch(href, { signal: controller.signal });

        if (!response.ok) {
          throw new Error('Failed to fetch file preview');
        }

        setPreviewContent(await response.text());
        setPreviewStatus('ready');
        setFullscreenOpen(true);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setPreviewStatus('error');
          if (!disableInlinePreview) {
            setPreviewOpen(true);
          }
        }
      } finally {
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
      }
    },
    [canPreviewText, disableInlinePreview, href, previewStatus, previewTooLarge]
  );

  return (
    <>
      <div
        className={cn(
          'flex max-w-full flex-col gap-2',
          previewOpen ? 'w-full' : 'w-fit'
        )}
      >
        <div
          className={cn(
            'group/file-card flex w-fit max-w-full items-center gap-3 rounded-md border border-border bg-background p-3 select-none transition-all duration-200 hover:border-primary/50 hover:bg-accent hover:shadow-md focus-within:border-primary/50 focus-within:bg-accent focus-within:shadow-md',
            canPreviewText && !disableInlinePreview && 'cursor-pointer'
          )}
          role={canPreviewText && !disableInlinePreview ? 'button' : undefined}
          tabIndex={canPreviewText && !disableInlinePreview ? 0 : undefined}
          title={
            canPreviewText && !disableInlinePreview
              ? t('previewFile')
              : undefined
          }
          onClick={togglePreview}
          onKeyDown={(event) => {
            if (
              canPreviewText &&
              (event.key === 'Enter' || event.key === ' ')
            ) {
              event.preventDefault();
              togglePreview();
            }
          }}
        >
          <div className="flex shrink-0 items-center justify-center rounded-md bg-muted p-2 transition-colors duration-200">
            <FileIcon extension={extension} />
          </div>
          <div className="flex min-w-0 max-w-[30ch] flex-none flex-col overflow-hidden">
            <span
              className={cn(
                'truncate text-sm font-medium text-foreground transition-colors duration-200'
              )}
              title={name}
            >
              {name}
            </span>
            <span className="text-xs text-muted-foreground">
              {filesize(size)}
            </span>
          </div>
          {!onRemove && href && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 opacity-0 transition-opacity duration-150 group-hover/file-card:opacity-100 group-focus-within/file-card:opacity-100"
              title={t('downloadFile')}
              disabled={downloading}
              onClick={onDownloadClick}
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
          {canPreviewText && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 opacity-0 transition-opacity duration-150 group-hover/file-card:opacity-100 group-focus-within/file-card:opacity-100"
              title={t('fullscreenFilePreview')}
              disabled={previewStatus === 'loading'}
              onClick={openFullscreenPreview}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          {onRemove && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 transition-opacity duration-200"
              onClick={onRemoveClick}
              title={t('deleteFileTitle')}
            >
              <Trash className="h-4 w-4" />
            </Button>
          )}
          {previewStatus === 'loading' && (
            <Loader2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </div>

        {previewOpen && previewStatus === 'ready' && (
          <TextFilePreview
            content={previewContent}
            name={name}
            extension={extension}
            mimeType={mimeType}
          />
        )}

        {previewOpen && previewStatus === 'too-large' && (
          <div className="w-full rounded-md border border-border bg-[#262626] px-3 py-2 text-xs text-muted-foreground">
            {t('filePreviewTooLarge')}
          </div>
        )}

        {previewOpen && previewStatus === 'error' && (
          <div className="w-full rounded-md border border-border bg-[#262626] px-3 py-2 text-xs text-muted-foreground">
            {t('failedPreviewFile')}
          </div>
        )}
      </div>

      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-[calc(100dvw-2rem)] flex-col gap-0 overflow-hidden bg-[#262626] p-0 sm:max-w-[calc(100dvw-2rem)]">
          <DialogHeader className="sr-only">
            <DialogTitle>{name}</DialogTitle>
          </DialogHeader>
          <div className="absolute top-0 right-3 z-10 flex items-center gap-2 rounded-md bg-[#262626]/95 p-1 shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent"
              title={t('downloadFile')}
              disabled={downloading}
              onClick={downloadFile}
            >
              <Download className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent"
              title={t('close')}
              onClick={() => setFullscreenOpen(false)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <TextFilePreview
            content={previewContent}
            name={name}
            extension={extension}
            mimeType={mimeType}
            fullHeight
          />
        </DialogContent>
      </Dialog>
    </>
  );
};

export { FileCard };
