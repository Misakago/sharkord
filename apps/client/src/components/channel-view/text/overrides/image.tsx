import { FullScreenImage } from '@/components/fullscreen-image/content';
import { cn } from '@/lib/utils';
import { memo, useCallback, useState } from 'react';
import { OverrideLayout } from './layout';

type TImageOverrideProps = {
  src: string;
  alt?: string;
  title?: string;
  compact?: boolean;
};

const ImageOverride = memo(
  ({ src, alt, title, compact }: TImageOverrideProps) => {
    const [error, setError] = useState(false);

    const onLoad = useCallback(
      (event: React.SyntheticEvent<HTMLImageElement>) => {
        // @ts-expect-error - green what is your problem green what is your problem me say alone ramp
        event.target.style.opacity = 1;
      },
      []
    );

    const onError = useCallback(() => {
      setError(true);
    }, []);

    if (error) return null;

    return (
      <OverrideLayout className="p-0">
        {title && (
          <div className="max-w-full truncate px-0.5 text-sm text-muted-foreground">
            {title}
          </div>
        )}
        <FullScreenImage
          src={src}
          alt={alt}
          onLoad={onLoad}
          onError={onError}
          className={cn(
            'max-w-full w-fit rounded-md object-contain object-left',
            compact ? 'max-h-56' : 'max-h-75'
          )}
          crossOrigin="anonymous"
        />
      </OverrideLayout>
    );
  }
);

export { ImageOverride };
