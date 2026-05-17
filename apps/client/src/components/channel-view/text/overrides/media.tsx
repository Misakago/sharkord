import { cn } from '@/lib/utils';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@mikotord/ui';
import { ChevronLeft, ChevronRight, Grid2X2, Images, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFoundMedia } from '../renderer/types';
import { OverrideLayout } from './layout';

type TMediaOverrideProps = {
  media: TFoundMedia[];
  compact?: boolean;
};

const MediaOverride = memo(({ media, compact }: TMediaOverrideProps) => {
  const { t } = useTranslation('common');
  const [activeIndex, setActiveIndex] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const activeItem = media[activeIndex] ?? media[0];
  const hasMultipleImages = media.length > 1;
  const shouldShowFoldedStack = media.length > 3;

  useEffect(() => {
    if (activeIndex >= media.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, media.length]);

  const photoCountLabel = useMemo(
    () => t('photoCount', { count: media.length }),
    [media.length, t]
  );

  const goPrevious = useCallback(() => {
    setActiveIndex((current) => (current - 1 + media.length) % media.length);
  }, [media.length]);

  const goNext = useCallback(() => {
    setActiveIndex((current) => (current + 1) % media.length);
  }, [media.length]);

  if (!activeItem) return null;

  return (
    <OverrideLayout className="p-0">
      <div
        className={cn(
          'group/gallery relative w-fit max-w-full',
          shouldShowFoldedStack && 'pr-3'
        )}
      >
        {shouldShowFoldedStack && (
          <>
            <div className="absolute right-1 top-3 h-[calc(100%-1.5rem)] w-8 rounded-md bg-[#262626]/70" />
            <div className="absolute right-0 top-6 h-[calc(100%-3rem)] w-8 rounded-md bg-[#262626]/45" />
          </>
        )}

        <div className="relative overflow-hidden rounded-md bg-[#262626]">
          <button
            type="button"
            className="block max-w-full cursor-zoom-in"
            onClick={() => setGalleryOpen(true)}
            title={t('openImageGallery')}
          >
            <img
              src={activeItem.url}
              alt={activeItem.name ?? photoCountLabel}
              crossOrigin="anonymous"
              className={cn(
                'block max-w-full object-contain object-left',
                compact ? 'max-h-56' : 'max-h-75'
              )}
            />
          </button>

          <button
            type="button"
            className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/80"
            onClick={() => setGalleryOpen(true)}
            title={t('openImageGallery')}
          >
            <Grid2X2 className="h-4 w-4" />
            <span>{photoCountLabel}</span>
          </button>

          {hasMultipleImages && (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/55 text-white opacity-0 hover:bg-black/75 hover:text-white group-hover/gallery:opacity-100 focus-visible:opacity-100"
                onClick={goPrevious}
                title={t('previousImage')}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/55 text-white opacity-0 hover:bg-black/75 hover:text-white group-hover/gallery:opacity-100 focus-visible:opacity-100"
                onClick={goNext}
                title={t('nextImage')}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {activeItem.name && (
        <div className="max-w-full truncate px-0.5 text-sm text-muted-foreground">
          {activeItem.name}
        </div>
      )}

      <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden rounded-md bg-background p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{photoCountLabel}</DialogTitle>
          </DialogHeader>

          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Images className="h-5 w-5 text-muted-foreground" />
              <span>{photoCountLabel}</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={() => setGalleryOpen(false)}
              title={t('close')}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
              {media.map((item, index) => (
                <button
                  type="button"
                  key={item.key}
                  className={cn(
                    'group relative overflow-hidden rounded-md bg-[#262626] text-left',
                    activeIndex === index && 'ring-2 ring-ring'
                  )}
                  onClick={() => setActiveIndex(index)}
                >
                  <img
                    src={item.url}
                    alt={item.name ?? t('imageNumber', { number: index + 1 })}
                    crossOrigin="anonymous"
                    className="h-56 w-full object-contain"
                  />
                  {item.name && (
                    <div className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1 text-sm text-white opacity-0 group-hover:opacity-100">
                      {item.name}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </OverrideLayout>
  );
});

export { MediaOverride };
