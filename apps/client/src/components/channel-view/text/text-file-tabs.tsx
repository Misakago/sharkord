import { usePublicServerSettings } from '@/features/server/hooks';
import {
  getFileNameWithLockedExtension,
  splitFileNameForLockedExtension
} from '@/helpers/file-name';
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
  ChevronDown,
  ChevronUp,
  Download,
  File,
  FileImage,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  TextCursorInput,
  X
} from 'lucide-react';
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';
import { isOfficePreviewableFile } from './office-document-helpers';
import { OfficeDocumentPreview } from './office-document-preview';
import { TextFilePreview } from './text-file-preview';
import {
  isTextPreviewableFile,
  MAX_TEXT_PREVIEW_BYTES
} from './text-file-preview-helpers';

type TTextFileTabsProps = {
  files: TAttachmentFile[];
  disableInlinePreview?: boolean;
  context?: 'message' | 'compose';
  activeFileId?: number;
  onLayoutChange?: () => void;
  contentTab?: {
    label: string;
    content: ReactNode;
  };
};

type TAttachmentFile = {
  id?: number;
  key: string;
  originalName: string;
  size: number;
  extension: string;
  mimeType?: string;
  href?: string;
  previewUrl?: string;
  sourceFile?: File;
  progress?: number;
  onRename?: (name: string) => void;
  onReplace?: (file: globalThis.File) => Promise<unknown>;
  onRemove?: () => void;
};

type TPreviewState =
  | { status: 'idle' | 'loading' | 'error' | 'too-large'; content?: undefined }
  | { status: 'ready'; content: string };

type TAttachmentKind = 'text' | 'image' | 'office' | 'other';

type TAttachmentTab =
  | {
      id: string;
      kind: 'content';
      label: string;
      content: ReactNode;
    }
  | {
      id: string;
      kind: 'text' | 'image';
      file: TAttachmentFile;
    }
  | {
      id: string;
      kind: 'office';
      file: TAttachmentFile;
    }
  | {
      id: string;
      kind: 'imageGallery';
      files: TAttachmentFile[];
    }
  | {
      id: string;
      kind: 'other';
      files: TAttachmentFile[];
    };

const idlePreviewState: TPreviewState = { status: 'idle' };

const getAttachmentKind = (
  file: TAttachmentFile,
  officeServerUrl?: string
): TAttachmentKind => {
  if (getFileCategory(file.extension) === FileCategory.IMAGE) {
    return 'image';
  }

  if (
    isTextPreviewableFile({
      name: file.originalName,
      extension: file.extension,
      mimeType: file.mimeType
    })
  ) {
    return 'text';
  }

  if (
    officeServerUrl &&
    isOfficePreviewableFile({
      extension: file.extension
    })
  ) {
    return 'office';
  }

  return 'other';
};

const getTabFile = (tab: TAttachmentTab | undefined) =>
  tab?.kind === 'other' ||
  tab?.kind === 'imageGallery' ||
  tab?.kind === 'content'
    ? null
    : (tab?.file ?? null);

const getAttachmentUrl = (file: TAttachmentFile) =>
  file.href ?? file.previewUrl ?? '';

const ImagePreview = memo(
  ({
    file,
    fullHeight,
    onLoad
  }: {
    file: TAttachmentFile;
    fullHeight?: boolean;
    onLoad?: () => void;
  }) => (
    <div
      className={cn(
        'flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[#262626] p-3',
        fullHeight ? 'h-full' : 'h-96 max-h-96'
      )}
    >
      <img
        src={getAttachmentUrl(file)}
        alt={file.originalName}
        onLoad={onLoad}
        className={cn(
          'block max-w-full rounded-md object-contain',
          fullHeight ? 'max-h-full' : 'max-h-80'
        )}
      />
    </div>
  )
);

const FileIcon = memo(
  ({
    file,
    officeServerUrl
  }: {
    file: TAttachmentFile;
    officeServerUrl?: string;
  }) => {
    const kind = getAttachmentKind(file, officeServerUrl);

    if (kind === 'image') return <FileImage className="h-5 w-5" />;
    if (kind === 'text' || kind === 'office')
      return <FileText className="h-5 w-5" />;

    return <File className="h-5 w-5" />;
  }
);

const TextFileTabs = memo(
  ({
    files,
    disableInlinePreview,
    context = 'message',
    activeFileId,
    onLayoutChange,
    contentTab
  }: TTextFileTabsProps) => {
    const { t } = useTranslation('common');
    const publicSettings = usePublicServerSettings();
    const officeServerUrl = publicSettings?.officeServerUrl?.trim() ?? '';
    const initialGalleryTabIndex = (() => {
      let textFileCount = 0;
      let hasImageFile = false;

      for (const file of files) {
        const kind = getAttachmentKind(file, officeServerUrl);

        if (kind === 'text') {
          textFileCount++;
        }

        if (kind === 'image') {
          hasImageFile = true;
        }
      }

      return hasImageFile ? textFileCount : null;
    })();
    const [activeIndex, setActiveIndex] = useState<number | null>(
      contentTab ? 0 : initialGalleryTabIndex
    );
    const [inlineCollapsed, setInlineCollapsed] = useState(
      contentTab ? false : initialGalleryTabIndex === null
    );
    const [fullscreenOpen, setFullscreenOpen] = useState(false);
    const [previews, setPreviews] = useState<Record<string, TPreviewState>>({});
    const [downloadingFileId, setDownloadingFileId] = useState<string | null>(
      null
    );
    const [renamingKey, setRenamingKey] = useState<string | null>(null);
    const [draftBaseName, setDraftBaseName] = useState('');
    const [galleryActiveIndex, setGalleryActiveIndex] = useState(0);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const skipRenameCommitRef = useRef(false);
    const previewsRef = useRef(previews);
    const autoOpenedContentTabRef = useRef(false);
    const autoOpenedGalleryRef = useRef(false);
    const galleryContainerRef = useRef<HTMLDivElement>(null);
    const [galleryWidth, setGalleryWidth] = useState(0);
    const [imageAspectRatios, setImageAspectRatios] = useState<
      Record<string, number>
    >({});
    const tabs = useMemo<TAttachmentTab[]>(() => {
      const textFiles: TAttachmentFile[] = [];
      const officeFiles: TAttachmentFile[] = [];
      const imageFiles: TAttachmentFile[] = [];
      const otherFiles: TAttachmentFile[] = [];

      for (const file of files) {
        const kind = getAttachmentKind(file, officeServerUrl);

        if (kind === 'text') {
          textFiles.push(file);
        } else if (kind === 'office') {
          officeFiles.push(file);
        } else if (kind === 'image') {
          imageFiles.push(file);
        } else {
          otherFiles.push(file);
        }
      }

      return [
        ...(contentTab
          ? [
              {
                id: 'message-content',
                kind: 'content' as const,
                label: contentTab.label,
                content: contentTab.content
              }
            ]
          : []),
        ...textFiles.map((file) => ({
          id: `text-${file.key}`,
          kind: 'text' as const,
          file
        })),
        ...officeFiles.map((file) => ({
          id: `office-${file.key}`,
          kind: 'office' as const,
          file
        })),
        ...(imageFiles.length
          ? [
              {
                id: 'image-gallery',
                kind: 'imageGallery' as const,
                files: imageFiles
              }
            ]
          : []),
        ...(otherFiles.length
          ? [
              {
                id: 'other-files',
                kind: 'other' as const,
                files: otherFiles
              }
            ]
          : [])
      ];
    }, [contentTab, files, officeServerUrl]);
    const activeTab = activeIndex === null ? undefined : tabs[activeIndex];
    const activeFile = getTabFile(activeTab);
    const activeImageGalleryTab =
      activeTab?.kind === 'imageGallery' ? activeTab : undefined;
    const inlinePreviewVisible =
      !!activeTab && !disableInlinePreview && !inlineCollapsed;
    const firstPreviewableTabIndex = useMemo(
      () => tabs.findIndex((tab) => tab.kind !== 'other'),
      [tabs]
    );
    const removableFiles = useMemo(
      () => files.filter((file) => !!file.onRemove),
      [files]
    );
    const renamingFile = useMemo(() => {
      if (!renamingKey) return null;

      for (const tab of tabs) {
        if (tab.kind === 'content') {
          continue;
        }

        if (tab.kind === 'other') {
          const foundFile = tab.files.find((file) => file.key === renamingKey);

          if (foundFile) return foundFile;

          continue;
        }

        if (tab.kind === 'imageGallery') {
          const foundFile = tab.files.find((file) => file.key === renamingKey);

          if (foundFile) return foundFile;

          continue;
        }

        if (tab.file.key === renamingKey) {
          return tab.file;
        }
      }

      return null;
    }, [renamingKey, tabs]);
    const renamingParts = useMemo(
      () =>
        renamingFile
          ? splitFileNameForLockedExtension(
              renamingFile.originalName,
              renamingFile.extension
            )
          : { baseName: '', extension: '' },
      [renamingFile]
    );
    const editableBaseNameWidthCh = useMemo(() => {
      const extensionLength = renamingParts.extension.length;
      const availableLength = Math.max(1, 30 - extensionLength);

      return Math.min(Math.max(draftBaseName.length + 1, 8), availableLength);
    }, [draftBaseName.length, renamingParts.extension.length]);

    useEffect(() => {
      previewsRef.current = previews;
    }, [previews]);

    useEffect(() => {
      if (activeIndex !== null && activeIndex >= tabs.length) {
        setActiveIndex(null);
        setInlineCollapsed(true);
      }
    }, [activeIndex, tabs.length]);

    useLayoutEffect(() => {
      if (!contentTab) {
        autoOpenedContentTabRef.current = false;
        return;
      }

      if (autoOpenedContentTabRef.current) return;

      autoOpenedContentTabRef.current = true;
      setActiveIndex(0);
      setInlineCollapsed(false);
    }, [contentTab]);

    useLayoutEffect(() => {
      const imageGalleryIndex = tabs.findIndex(
        (tab) => tab.kind === 'imageGallery'
      );

      if (imageGalleryIndex < 0) {
        autoOpenedGalleryRef.current = false;
        return;
      }

      if (contentTab) {
        autoOpenedGalleryRef.current = false;
        return;
      }

      if (autoOpenedGalleryRef.current) return;

      autoOpenedGalleryRef.current = true;
      setActiveIndex(imageGalleryIndex);
      setInlineCollapsed(false);
    }, [contentTab, tabs]);

    useEffect(() => {
      const imageGalleryTab = tabs.find((tab) => tab.kind === 'imageGallery');

      if (
        !imageGalleryTab ||
        galleryActiveIndex < imageGalleryTab.files.length
      ) {
        return;
      }

      setGalleryActiveIndex(0);
    }, [galleryActiveIndex, tabs]);

    useEffect(() => {
      if (!renamingKey || renamingFile) return;

      setRenamingKey(null);
      setDraftBaseName('');
    }, [renamingFile, renamingKey]);

    useEffect(() => {
      if (!renamingKey) return;

      const input = renameInputRef.current;

      input?.focus();
      input?.select();
    }, [renamingKey]);

    useLayoutEffect(() => {
      if (context !== 'compose') return;

      const frame = window.requestAnimationFrame(() => {
        onLayoutChange?.();
      });

      return () => window.cancelAnimationFrame(frame);
    }, [activeIndex, context, inlinePreviewVisible, onLayoutChange]);

    useLayoutEffect(() => {
      const el = galleryContainerRef.current;

      if (!el || !activeImageGalleryTab || !inlinePreviewVisible) return;

      const updateWidth = () => setGalleryWidth(el.clientWidth);
      const observer = new ResizeObserver(updateWidth);

      updateWidth();
      observer.observe(el);

      return () => observer.disconnect();
    }, [activeImageGalleryTab, inlinePreviewVisible]);

    const galleryRowHeight = useMemo(() => {
      if (!activeImageGalleryTab || activeImageGalleryTab.files.length <= 1) {
        return undefined;
      }

      const availableWidth = galleryWidth || 0;

      if (!availableWidth) return 224;

      const gap = 8;
      const totalAspectRatio = activeImageGalleryTab.files.reduce(
        (sum, file) => sum + (imageAspectRatios[file.key] ?? 1),
        0
      );
      const availableImageWidth =
        availableWidth - gap * (activeImageGalleryTab.files.length - 1);
      const rowHeight = availableImageWidth / Math.max(totalAspectRatio, 1);

      return Math.min(Math.max(rowHeight, 192), 280);
    }, [activeImageGalleryTab, galleryWidth, imageAspectRatios]);
    const galleryFitsSingleRow = useMemo(() => {
      if (!activeImageGalleryTab || activeImageGalleryTab.files.length <= 1) {
        return true;
      }

      if (!galleryWidth || !galleryRowHeight) {
        return false;
      }

      const gap = 8;
      const totalWidth =
        activeImageGalleryTab.files.reduce(
          (sum, file) =>
            sum + (imageAspectRatios[file.key] ?? 1) * galleryRowHeight,
          0
        ) +
        gap * (activeImageGalleryTab.files.length - 1);

      return totalWidth <= galleryWidth + 1;
    }, [
      activeImageGalleryTab,
      galleryRowHeight,
      galleryWidth,
      imageAspectRatios
    ]);

    const loadPreview = useCallback(
      async (file: TAttachmentFile, signal?: AbortSignal) => {
        const cached = previewsRef.current[file.key];

        if (
          cached?.status === 'loading' ||
          cached?.status === 'ready' ||
          cached?.status === 'too-large'
        ) {
          return;
        }

        if (file.size > MAX_TEXT_PREVIEW_BYTES) {
          setPreviews((current) => ({
            ...current,
            [file.key]: { status: 'too-large' }
          }));
          return;
        }

        setPreviews((current) => ({
          ...current,
          [file.key]: { status: 'loading' }
        }));

        try {
          let content: string;

          if (file.sourceFile) {
            content = await file.sourceFile.text();
          } else {
            const href = getAttachmentUrl(file);

            if (!href) {
              throw new Error('Missing file preview URL');
            }

            const response = await fetch(href, { signal });

            if (!response.ok) {
              throw new Error('Failed to fetch file preview');
            }

            content = await response.text();
          }

          setPreviews((current) => ({
            ...current,
            [file.key]: { status: 'ready', content }
          }));
        } catch (error) {
          if ((error as Error).name === 'AbortError') return;

          setPreviews((current) => ({
            ...current,
            [file.key]: { status: 'error' }
          }));
        }
      },
      []
    );

    useEffect(() => {
      if (!activeFileId || disableInlinePreview) return;

      const index = tabs.findIndex((tab) =>
        tab.kind === 'imageGallery'
          ? tab.files.some((file) => file.id === activeFileId)
          : tab.kind !== 'other' &&
            tab.kind !== 'content' &&
            tab.file.id === activeFileId
      );

      if (index < 0) return;

      const tab = tabs[index];

      setActiveIndex(index);
      setInlineCollapsed(false);

      if (tab.kind === 'text') {
        void loadPreview(tab.file);
      }

      if (tab.kind === 'imageGallery') {
        const galleryIndex = tab.files.findIndex(
          (file) => file.id === activeFileId
        );

        setGalleryActiveIndex(Math.max(galleryIndex, 0));
      }
    }, [activeFileId, disableInlinePreview, loadPreview, tabs]);

    useEffect(() => {
      if (!activeTab || activeTab.kind !== 'text' || !inlinePreviewVisible) {
        return;
      }

      const controller = new AbortController();

      void loadPreview(activeTab.file, controller.signal);

      return () => controller.abort();
    }, [activeTab, inlinePreviewVisible, loadPreview]);

    useEffect(() => {
      if (!activeTab || activeTab.kind !== 'text' || !fullscreenOpen) {
        return;
      }

      void loadPreview(activeTab.file);
    }, [activeTab, fullscreenOpen, loadPreview]);

    const downloadFile = useCallback(async (file: TAttachmentFile) => {
      const href = getAttachmentUrl(file);

      if (!href) return;

      setDownloadingFileId(file.key);

      try {
        const response = await fetch(href);

        if (!response.ok) {
          throw new Error('Failed to download file');
        }

        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');

        link.href = url;
        link.download = file.originalName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch {
        // The public file endpoint already reports download failures.
      } finally {
        setDownloadingFileId(null);
      }
    }, []);

    const downloadActiveFile = useCallback(() => {
      if (!activeFile) return;

      void downloadFile(activeFile);
    }, [activeFile, downloadFile]);

    const openFullscreen = useCallback(() => {
      let targetTab = activeTab;
      let targetIndex = activeIndex;

      if (!targetTab || targetTab.kind === 'other') {
        if (firstPreviewableTabIndex < 0) return;

        targetIndex = firstPreviewableTabIndex;
        targetTab = tabs[firstPreviewableTabIndex];
      }

      if (!targetTab || targetTab.kind === 'other') return;

      setActiveIndex(targetIndex);

      if (targetTab.kind === 'text') {
        void loadPreview(targetTab.file);
      }

      setFullscreenOpen(true);
    }, [activeIndex, activeTab, firstPreviewableTabIndex, loadPreview, tabs]);

    const toggleInlinePreview = useCallback(() => {
      if (disableInlinePreview) {
        openFullscreen();
        return;
      }

      if (!inlineCollapsed) {
        setInlineCollapsed(true);
        setActiveIndex(null);

        return;
      }

      const nextIndex = activeIndex ?? 0;
      const nextTab = tabs[nextIndex];

      if (!nextTab) return;

      setActiveIndex(nextIndex);
      setInlineCollapsed(false);

      if (nextTab.kind === 'text') {
        void loadPreview(nextTab.file);
      }
    }, [
      activeIndex,
      disableInlinePreview,
      inlineCollapsed,
      loadPreview,
      openFullscreen,
      tabs
    ]);

    const removeActiveOrAllFiles = useCallback(() => {
      if (activeFile?.onRemove) {
        activeFile.onRemove();
        return;
      }

      if (removableFiles.length === 1) {
        removableFiles[0].onRemove?.();
        return;
      }

      for (const file of removableFiles) {
        file.onRemove?.();
      }
    }, [activeFile, removableFiles]);

    const removeTabFiles = useCallback((tab: TAttachmentTab) => {
      if (tab.kind === 'content') {
        return;
      }

      if (tab.kind === 'other' || tab.kind === 'imageGallery') {
        for (const file of tab.files) {
          file.onRemove?.();
        }

        return;
      }

      tab.file.onRemove?.();
    }, []);

    const startRenaming = useCallback((file: TAttachmentFile) => {
      skipRenameCommitRef.current = false;

      const parts = splitFileNameForLockedExtension(
        file.originalName,
        file.extension
      );

      setDraftBaseName(parts.baseName);
      setRenamingKey(file.key);
    }, []);

    const cancelRenaming = useCallback(() => {
      skipRenameCommitRef.current = true;
      setRenamingKey(null);
      setDraftBaseName('');
    }, []);

    const commitRenaming = useCallback(() => {
      if (!renamingFile) {
        setRenamingKey(null);
        setDraftBaseName('');
        return;
      }

      if (!draftBaseName.trim()) {
        cancelRenaming();
        return;
      }

      const nextName = getFileNameWithLockedExtension(
        renamingFile.originalName,
        renamingFile.extension,
        draftBaseName
      );

      if (nextName !== renamingFile.originalName) {
        renamingFile.onRename?.(nextName);
      }

      setRenamingKey(null);
      setDraftBaseName('');
    }, [cancelRenaming, draftBaseName, renamingFile]);

    const onRenameInputBlur = useCallback(() => {
      if (skipRenameCommitRef.current) {
        skipRenameCommitRef.current = false;
        return;
      }

      commitRenaming();
    }, [commitRenaming]);

    const previewContent = (tab: TAttachmentTab, fullHeight?: boolean) => {
      if (tab.kind === 'content') {
        return (
          <div
            className={cn(
              'w-full max-w-full overflow-auto bg-[#262626] p-3',
              fullHeight ? 'min-h-0 flex-1' : 'max-h-[min(35vh,18rem)]'
            )}
          >
            {tab.content}
          </div>
        );
      }

      if (tab.kind === 'image') {
        return (
          <ImagePreview
            file={tab.file}
            fullHeight={fullHeight}
            onLoad={context === 'compose' ? onLayoutChange : undefined}
          />
        );
      }

      if (tab.kind === 'office') {
        return (
          <OfficeDocumentPreview
            file={tab.file}
            officeServerUrl={officeServerUrl}
            fullHeight={fullHeight}
            onReplace={tab.file.onReplace}
          />
        );
      }

      if (tab.kind === 'imageGallery') {
        const activeImage =
          tab.files[galleryActiveIndex] ?? tab.files[0] ?? null;

        if (fullHeight) {
          return (
            <div className="flex min-h-0 flex-1 flex-col bg-[#262626]">
              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
                {activeImage && (
                  <img
                    src={getAttachmentUrl(activeImage)}
                    alt={activeImage.originalName}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </div>
              {tab.files.length > 1 && (
                <div className="flex h-24 shrink-0 gap-2 overflow-x-auto border-t border-border bg-background p-2">
                  {tab.files.map((file, index) => (
                    <button
                      type="button"
                      key={file.key}
                      className={cn(
                        'h-20 w-fit max-w-40 shrink-0 overflow-hidden rounded-md bg-[#262626]',
                        galleryActiveIndex === index && 'ring-2 ring-ring'
                      )}
                      title={file.originalName}
                      onClick={() => setGalleryActiveIndex(index)}
                    >
                      <img
                        src={getAttachmentUrl(file)}
                        alt={file.originalName}
                        className="h-full w-auto object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        }

        return (
          <div
            className={cn(
              'min-h-0 flex-1 p-3',
              fullHeight
                ? 'h-full overflow-auto'
                : galleryFitsSingleRow
                  ? 'overflow-visible'
                  : 'max-h-full overflow-auto'
            )}
          >
            <div
              ref={galleryContainerRef}
              className="flex flex-wrap items-start gap-2"
            >
              {tab.files.map((file, index) => (
                <div
                  key={file.key}
                  className={cn(
                    'group/gallery-card relative max-w-full overflow-hidden rounded-md border border-border bg-background',
                    tab.files.length === 1 ? 'w-fit max-w-full' : 'w-full',
                    galleryActiveIndex === index && 'ring-1 ring-ring'
                  )}
                  style={
                    tab.files.length > 1 && galleryRowHeight
                      ? {
                          width: `${Math.max(
                            (imageAspectRatios[file.key] ?? 1) *
                              galleryRowHeight,
                            192
                          )}px`
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      'block cursor-zoom-in bg-[#1f1f1f]',
                      tab.files.length === 1 ? 'w-fit max-w-full' : 'w-full'
                    )}
                    title={t('fullscreenFilePreview')}
                    onClick={() => {
                      setGalleryActiveIndex(index);
                      setFullscreenOpen(true);
                    }}
                  >
                    <img
                      src={getAttachmentUrl(file)}
                      alt={file.originalName}
                      loading="lazy"
                      className={cn(
                        'block object-contain',
                        tab.files.length === 1
                          ? 'h-auto max-h-[min(35vh,22rem)] w-auto max-w-full'
                          : 'w-full'
                      )}
                      style={
                        tab.files.length > 1 && galleryRowHeight
                          ? { height: `${galleryRowHeight}px` }
                          : undefined
                      }
                      onLoad={(event) => {
                        const img = event.currentTarget;

                        if (img.naturalWidth && img.naturalHeight) {
                          setImageAspectRatios((current) => ({
                            ...current,
                            [file.key]: img.naturalWidth / img.naturalHeight
                          }));
                        }

                        if (context === 'compose') {
                          onLayoutChange?.();
                        }
                      }}
                    />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 flex min-w-0 items-center gap-1 bg-black/65 px-2 py-1.5 text-white opacity-0 transition-opacity group-hover/gallery-card:opacity-100 focus-within:opacity-100">
                    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                      {renamingKey === file.key ? (
                        <div
                          className="flex min-w-0 max-w-full items-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <span className="flex max-w-full overflow-hidden rounded border border-transparent hover:border-border focus-within:border-ring">
                            <input
                              ref={renameInputRef}
                              value={draftBaseName}
                              title={file.originalName}
                              className="max-w-full bg-transparent px-0 text-sm font-medium text-foreground outline-none"
                              style={{ width: `${editableBaseNameWidthCh}ch` }}
                              onChange={(event) =>
                                setDraftBaseName(event.target.value)
                              }
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
                          {renamingParts.extension && (
                            <span
                              className="shrink-0 text-sm font-medium text-muted-foreground"
                              title={renamingParts.extension}
                            >
                              {renamingParts.extension}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span
                          className="min-w-0 truncate text-sm font-medium"
                          title={file.originalName}
                        >
                          {file.originalName}
                        </span>
                      )}
                      <span className="text-xs text-white/70">
                        {filesize(file.size)}
                      </span>
                    </div>
                    {renamingKey !== file.key && file.onRename && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover/gallery-card:opacity-100 focus-visible:opacity-100"
                        title={t('renameFile')}
                        onClick={() => startRenaming(file)}
                      >
                        <TextCursorInput className="h-4 w-4" />
                      </Button>
                    )}
                    {context !== 'compose' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover/gallery-card:opacity-100 focus-visible:opacity-100"
                        title={t('downloadFile')}
                        disabled={downloadingFileId === file.key}
                        onClick={() => void downloadFile(file)}
                      >
                        {downloadingFileId === file.key ? (
                          <Loader2 className="h-4 w-4" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    {file.onRemove && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        title={t('deleteFileTitle')}
                        onClick={file.onRemove}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      if (tab.kind === 'other') {
        return (
          <div
            className={cn(
              'flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3',
              fullHeight ? 'h-full' : 'max-h-96'
            )}
          >
            {tab.files.map((file) => (
              <div
                key={file.key}
                className="group/file flex w-fit max-w-full items-center gap-3 rounded-md border border-border bg-background p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <FileIcon file={file} officeServerUrl={officeServerUrl} />
                </div>
                <div className="flex min-w-0 max-w-[30ch] flex-col overflow-hidden">
                  {renamingKey === file.key ? (
                    <div
                      className="flex min-w-0 max-w-full items-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="flex max-w-full overflow-hidden rounded border border-transparent hover:border-border focus-within:border-ring">
                        <input
                          ref={renameInputRef}
                          value={draftBaseName}
                          title={file.originalName}
                          className="max-w-full bg-transparent px-0 text-sm font-medium text-foreground outline-none"
                          style={{ width: `${editableBaseNameWidthCh}ch` }}
                          onChange={(event) =>
                            setDraftBaseName(event.target.value)
                          }
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
                      {renamingParts.extension && (
                        <span
                          className="shrink-0 text-sm font-medium text-muted-foreground"
                          title={renamingParts.extension}
                        >
                          {renamingParts.extension}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span
                      className="truncate text-sm font-medium text-foreground"
                      title={file.originalName}
                    >
                      {file.originalName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {filesize(file.size)}
                  </span>
                </div>
                <>
                  {renamingKey !== file.key && file.onRename && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title={t('renameFile')}
                      onClick={() => startRenaming(file)}
                    >
                      <TextCursorInput className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    title={t('downloadFile')}
                    disabled={downloadingFileId === file.key}
                    onClick={() => void downloadFile(file)}
                  >
                    {downloadingFileId === file.key ? (
                      <Loader2 className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                  {context !== 'compose' && file.onRemove && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      title={t('deleteFileTitle')}
                      onClick={file.onRemove}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </>
              </div>
            ))}
          </div>
        );
      }

      const state = previews[tab.file.key] ?? idlePreviewState;

      if (state.status === 'loading' || state.status === 'idle') {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4" />
            {t('loadingFilePreview')}
          </div>
        );
      }

      if (state.status === 'too-large') {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            {t('filePreviewTooLarge')}
          </div>
        );
      }

      if (state.status === 'error') {
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            {t('failedPreviewFile')}
          </div>
        );
      }

      if (state.status === 'ready') {
        return (
          <TextFilePreview
            content={state.content}
            name={tab.file.originalName}
            extension={tab.file.extension}
            mimeType={tab.file.mimeType}
            fullHeight={fullHeight}
          />
        );
      }

      return (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('loadingFilePreview')}
        </div>
      );
    };

    const getTabLabel = (tab: TAttachmentTab) =>
      tab.kind === 'other'
        ? t('otherFiles')
        : tab.kind === 'imageGallery'
          ? t('photoCount', { count: tab.files.length })
          : tab.kind === 'content'
            ? tab.label
            : tab.file.originalName;

    const getTabIcon = (tab: TAttachmentTab) => {
      if (tab.kind === 'image' || tab.kind === 'imageGallery')
        return <FileImage className="h-4 w-4 shrink-0" />;
      if (tab.kind === 'other') return <File className="h-4 w-4 shrink-0" />;
      if (tab.kind === 'content')
        return <FileText className="h-4 w-4 shrink-0" />;
      if (tab.kind === 'office')
        return <FileText className="h-4 w-4 shrink-0" />;

      return <FileText className="h-4 w-4 shrink-0" />;
    };

    const getTabMeta = (_tab: TAttachmentTab, _compact?: boolean) => null;

    const renderTabName = (file: TAttachmentFile) => {
      if (renamingKey !== file.key) {
        return (
          <span className="min-w-0 truncate text-sm font-medium">
            {file.originalName}
          </span>
        );
      }

      return (
        <span
          className="flex min-w-0 max-w-full items-center"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="flex max-w-full overflow-hidden rounded border border-transparent hover:border-border focus-within:border-ring">
            <input
              ref={renameInputRef}
              value={draftBaseName}
              title={file.originalName}
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
          {renamingParts.extension && (
            <span
              className="shrink-0 text-sm font-medium text-muted-foreground"
              title={renamingParts.extension}
            >
              {renamingParts.extension}
            </span>
          )}
        </span>
      );
    };

    const tabBar = ({
      compact,
      showCollapse = true,
      showFullscreen = true,
      showRemove = true
    }: {
      compact?: boolean;
      showCollapse?: boolean;
      showFullscreen?: boolean;
      showRemove?: boolean;
    } = {}) => {
      const fillWidth = inlinePreviewVisible || !showCollapse;
      const showInlineToggle = showCollapse && !disableInlinePreview;
      const hasPreviewableFile = firstPreviewableTabIndex >= 0;
      const previewOpen = !inlineCollapsed || !showCollapse;
      const showInlineActions = showCollapse;
      const showExpandedActions =
        showInlineActions && !disableInlinePreview && !inlineCollapsed;
      const isFullscreenBar = !showCollapse;
      const isCompose = context === 'compose';
      const showRemoveAction =
        showRemove &&
        removableFiles.length > 0 &&
        !isCompose &&
        !inlineCollapsed;
      const showDownloadAction =
        showExpandedActions && !isCompose && !!activeFile;
      const showRenameAction =
        showInlineActions && !renamingKey && !!activeFile?.onRename && previewOpen;
      const showFullscreenAction =
        showFullscreen && (disableInlinePreview || !inlineCollapsed);

      return (
        <div
          className={cn(
            'flex min-w-0 items-center border-b border-border bg-background',
            isFullscreenBar ? 'min-h-12' : 'min-h-6',
            fillWidth ? 'w-full' : 'w-fit max-w-full'
          )}
        >
          <div
            className={cn(
              'flex min-w-0 overflow-x-auto',
              fillWidth ? 'flex-1' : 'max-w-[min(42rem,calc(100vw-8rem))]'
            )}
          >
            {tabs.map((tab, index) => {
              const meta = getTabMeta(tab, compact);
              const removableTabFiles =
                tab.kind === 'content'
                  ? []
                  : tab.kind === 'other'
                    ? tab.files.filter((file) => !!file.onRemove)
                    : tab.kind === 'imageGallery'
                      ? tab.files.filter((file) => !!file.onRemove)
                      : tab.file.onRemove
                        ? [tab.file]
                        : [];
              const showTabRemoveAction =
                isCompose && showRemove && removableTabFiles.length > 0;

              return (
                <div
                  key={tab.id}
                  className={cn(
                    'flex min-w-0 max-w-56 shrink-0 items-center border-r border-border transition-colors',
                    isFullscreenBar ? 'h-12' : 'h-6',
                    activeIndex === index
                      ? 'bg-[#262626] text-foreground'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      'flex h-full min-w-0 flex-1 items-center text-left',
                      isFullscreenBar ? 'gap-2 px-3' : 'gap-1.5 px-2'
                    )}
                    title={getTabLabel(tab)}
                    onClick={() => {
                      setActiveIndex(index);
                      setInlineCollapsed(false);

                      if (tab.kind === 'text') {
                        void loadPreview(tab.file);
                      }
                    }}
                  >
                    {getTabIcon(tab)}
                    {tab.kind === 'other' ||
                    tab.kind === 'imageGallery' ||
                    tab.kind === 'content' ? (
                      <span className="min-w-0 truncate text-sm font-medium">
                        {getTabLabel(tab)}
                      </span>
                    ) : (
                      renderTabName(tab.file)
                    )}
                    {meta && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {meta}
                      </span>
                    )}
                  </button>

                  {showTabRemoveAction && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        'mr-1 shrink-0 bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent',
                        isFullscreenBar ? 'h-8 w-8' : 'h-5 w-5'
                      )}
                      title={t('deleteFileTitle')}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeTabFiles(tab);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center gap-1 px-2">
            {showInlineToggle && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent',
                  isFullscreenBar ? 'h-8 w-8' : 'h-5 w-5'
                )}
                title={
                  inlineCollapsed
                    ? t('expandFilePreview')
                    : t('collapseFilePreview')
                }
                aria-expanded={!inlineCollapsed}
                onClick={toggleInlinePreview}
              >
                {inlineCollapsed ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </Button>
            )}

            {showRemoveAction && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent',
                  isFullscreenBar ? 'h-8 w-8' : 'h-5 w-5'
                )}
                title={t('deleteFileTitle')}
                onClick={removeActiveOrAllFiles}
              >
                <X className="h-4 w-4" />
              </Button>
            )}

            {showRenameAction && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent',
                  isFullscreenBar ? 'h-8 w-8' : 'h-5 w-5'
                )}
                title={t('renameFile')}
                onClick={() => startRenaming(activeFile)}
              >
                <TextCursorInput className="h-4 w-4" />
              </Button>
            )}

            {showDownloadAction && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent',
                  isFullscreenBar ? 'h-8 w-8' : 'h-5 w-5'
                )}
                title={t('downloadFile')}
                disabled={!activeFile || downloadingFileId === activeFile.key}
                onClick={downloadActiveFile}
              >
                {activeFile && downloadingFileId === activeFile.key ? (
                  <Loader2 className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            )}

            {showFullscreenAction && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'bg-transparent hover:bg-transparent focus-visible:bg-transparent active:bg-transparent data-[state=open]:bg-transparent',
                  isFullscreenBar ? 'h-8 w-8' : 'h-5 w-5'
                )}
                title={t('fullscreenFilePreview')}
                disabled={!hasPreviewableFile}
                onClick={openFullscreen}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      );
    };

    const fullscreenActiveFile =
      activeTab?.kind === 'imageGallery'
        ? (activeTab.files[galleryActiveIndex] ?? activeTab.files[0])
        : activeFile;
    const isFullscreenImageTab =
      activeTab?.kind === 'image' || activeTab?.kind === 'imageGallery';
    const inlinePreviewClass = (() => {
      if (!inlinePreviewVisible || !activeTab) return 'w-fit';

      if (activeTab.kind === 'imageGallery') {
        return activeTab.files.length === 1
          ? 'w-fit max-w-full'
          : 'w-[min(36rem,100%)]';
      }

      if (activeTab.kind === 'text') {
        return 'w-[min(36rem,100%)]';
      }

      if (activeTab.kind === 'office') {
        return 'w-[min(42rem,100%)]';
      }

      if (activeTab.kind === 'content') {
        return 'w-[min(36rem,100%)]';
      }

      return 'w-fit max-w-full';
    })();

    if (tabs.length === 0) return null;

    return (
      <>
        <div
          className={cn(
            'flex max-w-full flex-col overflow-hidden rounded-md border border-border bg-[#262626]',
            inlinePreviewClass
          )}
          data-attachment-expanded={inlinePreviewVisible ? 'true' : undefined}
        >
          {tabBar()}
          {activeTab && inlinePreviewVisible && (
            <div
              key={activeTab.id}
              className={cn(
                'min-h-0 max-w-full',
                (activeTab.kind === 'text' ||
                  activeTab.kind === 'office' ||
                  activeTab.kind === 'content') &&
                  'w-full',
                activeTab.kind === 'imageGallery' &&
                  (galleryFitsSingleRow
                    ? 'overflow-visible'
                    : 'max-h-[min(35vh,22rem)] overflow-auto'),
                activeTab.kind === 'image' &&
                  'max-h-[min(35vh,18rem)] overflow-auto'
              )}
            >
              {previewContent(activeTab)}
            </div>
          )}
        </div>

        <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
          <DialogContent className="flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] w-[calc(100dvw-2rem)] max-w-[calc(100dvw-2rem)] flex-col gap-0 overflow-hidden bg-[#262626] p-0 sm:max-w-[calc(100dvw-2rem)]">
            <DialogHeader className="sr-only">
              <DialogTitle>
                {fullscreenActiveFile?.originalName ?? t('attachments')}
              </DialogTitle>
            </DialogHeader>
            <div className="flex h-12 shrink-0 items-center border-b border-border bg-background">
              <div className="min-w-0 flex-1">
                {tabBar({
                  compact: true,
                  showCollapse: false,
                  showFullscreen: false,
                  showRemove: true
                })}
              </div>
              <div className="flex shrink-0 items-center gap-1 px-2">
                {context !== 'compose' &&
                  fullscreenActiveFile &&
                  fullscreenActiveFile.onRename &&
                  !renamingKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 bg-background hover:bg-background focus-visible:bg-background active:bg-background data-[state=open]:bg-background"
                      title={t('renameFile')}
                      onClick={() => startRenaming(fullscreenActiveFile)}
                    >
                      <TextCursorInput className="h-4 w-4" />
                    </Button>
                  )}
                {context !== 'compose' && fullscreenActiveFile && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 bg-background hover:bg-background focus-visible:bg-background active:bg-background data-[state=open]:bg-background"
                    title={t('downloadFile')}
                    disabled={downloadingFileId === fullscreenActiveFile.key}
                    onClick={() => void downloadFile(fullscreenActiveFile)}
                  >
                    {downloadingFileId === fullscreenActiveFile.key ? (
                      <Loader2 className="h-4 w-4" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 bg-background hover:bg-background focus-visible:bg-background active:bg-background data-[state=open]:bg-background"
                  title={t('close')}
                  onClick={() => setFullscreenOpen(false)}
                >
                  <Minimize2 className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1">
              {activeTab && activeTab.kind !== 'other'
                ? previewContent(activeTab, true)
                : null}
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

export { TextFileTabs };
