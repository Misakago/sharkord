import { memo, useMemo } from 'react';
import { ImageOverride } from '../overrides/image';
import { MediaOverride } from '../overrides/media';
import type { TFoundMedia } from '../renderer/types';

type TMediaProps = {
  media: TFoundMedia[];
  compact?: boolean;
};

const Media = memo(({ media, compact }: TMediaProps) => {
  const images = useMemo(
    () => media.filter((item) => item.type === 'image'),
    [media]
  );

  const singleImage = images.length === 1 ? images[0] : null;

  return (
    <>
      {singleImage && (
        <ImageOverride
          src={singleImage.url}
          alt={singleImage.name}
          title={singleImage.name}
          compact={compact}
        />
      )}

      {!singleImage && images.length > 0 && (
        <MediaOverride media={images} compact={compact} />
      )}
    </>
  );
});

export { Media };
