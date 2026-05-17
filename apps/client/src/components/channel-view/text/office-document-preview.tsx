import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const SHARKORD_DOCUMENT_SAVED = 'SHARKORD_DOCUMENT_SAVED';
const SHARKORD_DOCUMENT_SAVE_ERROR = 'SHARKORD_DOCUMENT_SAVE_ERROR';
const RENDER_OFFICE = 'RENDER_OFFICE';
const FILE_CHUNK_SIZE = 16 * 1024;

type TOfficeAttachmentFile = {
  key: string;
  originalName: string;
  size: number;
  extension: string;
  mimeType?: string;
  href?: string;
  previewUrl?: string;
  sourceFile?: globalThis.File;
};

type TOfficeDocumentPreviewProps = {
  file: TOfficeAttachmentFile;
  officeServerUrl: string;
  fullHeight?: boolean;
  onReplace?: (file: globalThis.File) => Promise<unknown>;
};

type TOfficeChunk = {
  name: string;
  type?: string;
  mimeType?: string;
  size: number;
  lastModified?: number;
  totalChunks: number;
  chunkIndex: number;
  data: string;
  encoding?: 'binary' | 'base64';
  transferId?: string;
};

type TOfficeSavePayload = Partial<TOfficeChunk> & {
  data?: string;
  content?: number[] | ArrayBuffer;
  buffer?: ArrayBuffer;
  message?: string;
};

const getAttachmentUrl = (file: TOfficeAttachmentFile) =>
  file.href ?? file.previewUrl ?? '';

const getLanguage = (language: string) =>
  language.toLowerCase().startsWith('zh') ? 'zh' : 'en';

const encodePlatformMessage = (payload: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';

  for (let i = 0; i < bytes.length; i += FILE_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.slice(i, i + FILE_CHUNK_SIZE));
  }

  return btoa(binary);
};

const decodePlatformMessage = (data: unknown): unknown => {
  if (typeof data !== 'string') return data;

  try {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return data;
  }
};

const getEventPayload = (data: unknown, type: string): unknown | null => {
  const decoded = decodePlatformMessage(data);

  if (!decoded || typeof decoded !== 'object') return null;

  const record = decoded as Record<string, unknown>;

  if (record.type === type) {
    if (record.payload) return record.payload;

    const payload = { ...record };

    delete payload.type;

    return payload;
  }

  return null;
};

const binaryStringToBytes = (value: string) => {
  const bytes = new Uint8Array(value.length);

  for (let i = 0; i < value.length; i++) {
    bytes[i] = value.charCodeAt(i);
  }

  return bytes;
};

const base64ToBytes = (value: string) => {
  const data = value.includes(',') ? value.split(',').pop()! : value;
  const binary = atob(data);

  return binaryStringToBytes(binary);
};

const payloadStringToBytes = (
  payload: Pick<TOfficeSavePayload, 'data' | 'encoding'>
) => {
  if (!payload.data) return new Uint8Array();

  if (
    payload.encoding === 'base64' ||
    payload.data.startsWith('data:') ||
    /^[A-Za-z0-9+/]+={0,2}$/.test(payload.data)
  ) {
    try {
      return base64ToBytes(payload.data);
    } catch {
      return binaryStringToBytes(payload.data);
    }
  }

  return binaryStringToBytes(payload.data);
};

const decodeOfficePayload = (payload: TOfficeSavePayload) => {
  const type = payload.type ?? payload.mimeType ?? '';
  const lastModified = payload.lastModified ?? Date.now();
  const name = payload.name ?? 'document';
  let bytes: Uint8Array;

  if (payload.buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(payload.buffer);
  } else if (payload.content instanceof ArrayBuffer) {
    bytes = new Uint8Array(payload.content);
  } else if (Array.isArray(payload.content)) {
    bytes = new Uint8Array(payload.content);
  } else {
    bytes = payloadStringToBytes(payload);
  }

  return new File([bytes], name, {
    type,
    lastModified
  });
};

const decodeOfficeChunks = (chunks: TOfficeChunk[]) => {
  const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const first = sortedChunks[0];
  const parts = sortedChunks.map((chunk) => payloadStringToBytes(chunk));

  return new File(parts, first.name, {
    type: first.type ?? first.mimeType ?? '',
    lastModified: first.lastModified ?? Date.now()
  });
};

const encodeFileChunked = async (
  file: globalThis.File,
  chunkSize = FILE_CHUNK_SIZE
): Promise<TOfficeChunk[]> => {
  const totalChunks = Math.ceil(file.size / chunkSize) || 1;
  const chunks: TOfficeChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const arrayBuffer = await file.slice(start, end).arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let data = '';

    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      data += String.fromCharCode(...bytes.slice(offset, offset + chunkSize));
    }

    chunks.push({
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      totalChunks,
      chunkIndex: i,
      data,
      encoding: 'binary'
    });
  }

  return chunks;
};

const OfficeDocumentPreview = memo(
  ({
    file,
    officeServerUrl,
    fullHeight,
    onReplace
  }: TOfficeDocumentPreviewProps) => {
    const { t, i18n } = useTranslation('common');
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const postedSourceFileKeyRef = useRef<string | null>(null);
    const incomingChunksRef = useRef<Map<string, TOfficeChunk[]>>(new Map());
    const [saving, setSaving] = useState(false);
    const attachmentUrl = getAttachmentUrl(file);
    const sourceFileKey = file.sourceFile
      ? `${file.sourceFile.name}:${file.sourceFile.size}:${file.sourceFile.lastModified}`
      : '';

    const officeOrigin = useMemo(() => {
      try {
        return new URL(officeServerUrl, window.location.href).origin;
      } catch {
        return '';
      }
    }, [officeServerUrl]);

    const iframeSrc = useMemo(() => {
      if (!officeServerUrl) return '';

      try {
        const url = new URL(officeServerUrl, window.location.href);
        const canUseSrc = attachmentUrl && !attachmentUrl.startsWith('blob:');

        if (canUseSrc) {
          url.searchParams.set('src', attachmentUrl);
        }

        url.searchParams.set('sharkord', '1');
        url.searchParams.set('locale', getLanguage(i18n.language));
        url.searchParams.set('name', file.originalName);

        return url.toString();
      } catch {
        return '';
      }
    }, [attachmentUrl, file.originalName, i18n.language, officeServerUrl]);

    useEffect(() => {
      postedSourceFileKeyRef.current = null;
      incomingChunksRef.current.clear();
    }, [attachmentUrl, file.key, sourceFileKey]);

    const saveFile = useCallback(
      async (replacementFile: globalThis.File) => {
        if (!onReplace) {
          toast.error(t('failedSaveFile'));
          return;
        }

        setSaving(true);

        try {
          await onReplace(replacementFile);
          toast.success(t('fileSaved'));
        } catch {
          toast.error(t('failedSaveFile'));
        } finally {
          setSaving(false);
        }
      },
      [onReplace, t]
    );

    const handleSavedPayload = useCallback(
      async (payload: TOfficeSavePayload) => {
        if (
          typeof payload.chunkIndex === 'number' &&
          typeof payload.totalChunks === 'number'
        ) {
          const key =
            payload.transferId ??
            `${payload.name ?? file.originalName}:${payload.size ?? 0}:${
              payload.lastModified ?? 0
            }`;
          const chunks = incomingChunksRef.current.get(key) ?? [];

          chunks[payload.chunkIndex] = payload as TOfficeChunk;
          incomingChunksRef.current.set(key, chunks);

          const readyChunks = chunks.filter(Boolean);

          if (readyChunks.length !== payload.totalChunks) {
            return;
          }

          incomingChunksRef.current.delete(key);
          await saveFile(decodeOfficeChunks(readyChunks));

          return;
        }

        await saveFile(decodeOfficePayload(payload));
      },
      [file.originalName, saveFile]
    );

    useEffect(() => {
      if (!officeOrigin) return;

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== officeOrigin) return;
        if (event.source !== iframeRef.current?.contentWindow) return;

        const saveErrorPayload = getEventPayload(
          event.data,
          SHARKORD_DOCUMENT_SAVE_ERROR
        );

        if (saveErrorPayload) {
          const message =
            typeof saveErrorPayload === 'object' &&
            'message' in saveErrorPayload
              ? String((saveErrorPayload as { message?: unknown }).message)
              : t('failedSaveFile');

          toast.error(message || t('failedSaveFile'));
          return;
        }

        const savedPayload = getEventPayload(
          event.data,
          SHARKORD_DOCUMENT_SAVED
        );

        if (!savedPayload || typeof savedPayload !== 'object') return;

        void handleSavedPayload(savedPayload as TOfficeSavePayload);
      };

      window.addEventListener('message', onMessage);

      return () => window.removeEventListener('message', onMessage);
    }, [handleSavedPayload, officeOrigin, t]);

    const postSourceFile = useCallback(async () => {
      const iframeWindow = iframeRef.current?.contentWindow;

      if (!file.sourceFile || !iframeWindow || !officeOrigin) return;
      if (postedSourceFileKeyRef.current === sourceFileKey) return;

      postedSourceFileKeyRef.current = sourceFileKey;

      const chunks = await encodeFileChunked(file.sourceFile);

      chunks.forEach((chunk, index) => {
        iframeWindow.postMessage(
          encodePlatformMessage({
            type: RENDER_OFFICE,
            payload: chunk,
            id: `${file.key}-${sourceFileKey}-${index}`
          }),
          officeOrigin
        );
      });
    }, [file.key, file.sourceFile, officeOrigin, sourceFileKey]);

    if (!iframeSrc || !officeOrigin) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
          {t('officePreviewUnavailable')}
        </div>
      );
    }

    return (
      <div
        className={cn(
          'relative flex min-h-0 flex-1 overflow-hidden bg-background',
          fullHeight
            ? 'h-full'
            : 'h-[min(52vh,42rem)] w-full max-w-full'
        )}
      >
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title={file.originalName}
          className="h-full w-full border-0 bg-background"
          sandbox="allow-downloads allow-forms allow-popups allow-same-origin allow-scripts"
          onLoad={() => void postSourceFile()}
        />
        {saving && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-background/90 px-3 py-2 text-sm text-muted-foreground shadow-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('savingFile')}
          </div>
        )}
      </div>
    );
  }
);

export { OfficeDocumentPreview };
export type { TOfficeAttachmentFile };
