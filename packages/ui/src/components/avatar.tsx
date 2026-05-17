import * as AvatarPrimitive from '@radix-ui/react-avatar';
import * as React from 'react';

import { cn } from '../lib/utils';

const SUPERELLIPSE_CLIP_PATH =
  'polygon(100.00% 50.00%,99.84% 60.63%,99.36% 66.82%,98.55% 71.92%,97.43% 76.36%,95.98% 80.29%,94.21% 83.79%,92.11% 86.92%,89.69% 89.69%,86.92% 92.11%,83.79% 94.21%,80.29% 95.98%,76.36% 97.43%,71.92% 98.55%,66.82% 99.36%,60.63% 99.84%,50.00% 100.00%,39.37% 99.84%,33.18% 99.36%,28.08% 98.55%,23.64% 97.43%,19.71% 95.98%,16.21% 94.21%,13.08% 92.11%,10.31% 89.69%,7.89% 86.92%,5.79% 83.79%,4.02% 80.29%,2.57% 76.36%,1.45% 71.92%,0.64% 66.82%,0.16% 60.63%,0.00% 50.00%,0.16% 39.37%,0.64% 33.18%,1.45% 28.08%,2.57% 23.64%,4.02% 19.71%,5.79% 16.21%,7.89% 13.08%,10.31% 10.31%,13.08% 7.89%,16.21% 5.79%,19.71% 4.02%,23.64% 2.57%,28.08% 1.45%,33.18% 0.64%,39.37% 0.16%,50.00% 0.00%,60.63% 0.16%,66.82% 0.64%,71.92% 1.45%,76.36% 2.57%,80.29% 4.02%,83.79% 5.79%,86.92% 7.89%,89.69% 10.31%,92.11% 13.08%,94.21% 16.21%,95.98% 19.71%,97.43% 23.64%,98.55% 28.08%,99.36% 33.18%,99.84% 39.37%)';

function Avatar({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        'relative flex size-8 shrink-0 overflow-hidden rounded-lg [container-type:inline-size]',
        className
      )}
      style={{
        clipPath: SUPERELLIPSE_CLIP_PATH,
        ...style
      }}
      {...props}
    />
  );
}

function AvatarImage({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      style={{
        clipPath: 'inherit',
        ...style
      }}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-lg bg-[#e5e5e5] text-[50cqi] font-medium leading-none dark:bg-[#333333]',
        className
      )}
      style={{
        clipPath: 'inherit',
        ...style
      }}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
