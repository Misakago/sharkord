import { cn } from '@/lib/utils';
import { IconButton } from '@mikotord/ui';
import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const portalRoot = document.getElementById('imagePortal')!;

type TFullScreenImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  as?: React.ElementType;
};

const FullScreenImage = memo(
  ({ as: Component = 'img', ...props }: TFullScreenImageProps) => {
    const [open, setOpen] = useState(false);
    const [visible, setVisible] = useState(false);
    const closeTimerRef = useRef<number | null>(null);

    const imgRef = useRef<HTMLImageElement>(null);
    const scaleRef = useRef(0.8);
    const posRef = useRef({ x: 0, y: 0 });
    const lastMouseRef = useRef({ x: 0, y: 0 });
    const draggingRef = useRef(false);

    const applyTransform = useCallback(() => {
      const el = imgRef.current;

      if (!el) return;

      el.style.transform = `scale(${scaleRef.current}) translate(${posRef.current.x}px, ${posRef.current.y}px)`;
    }, []);

    const onOpenClick = useCallback(() => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      scaleRef.current = 0.8;
      posRef.current = { x: 0, y: 0 };
      draggingRef.current = false;

      setOpen(true);

      setTimeout(() => setVisible(true), 10);
    }, []);

    const onCloseClick = useCallback(() => {
      setVisible(false);
      draggingRef.current = false;

      closeTimerRef.current = window.setTimeout(() => {
        setOpen(false);
        scaleRef.current = 0.8;
        posRef.current = { x: 0, y: 0 };
        closeTimerRef.current = null;
      }, 300);
    }, []);

    useEffect(
      () => () => {
        if (closeTimerRef.current) {
          window.clearTimeout(closeTimerRef.current);
        }
      },
      []
    );

    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLImageElement>) => {
        if (e.button !== 0) return;

        draggingRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };

        const el = imgRef.current;

        if (el) {
          el.style.cursor = 'grabbing';
        }
      },
      []
    );

    useEffect(() => {
      if (!open) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onCloseClick();
        }
      };

      const handleWheel = (e: WheelEvent) => {
        e.preventDefault();

        const prev = scaleRef.current;

        scaleRef.current = Math.min(Math.max(prev - e.deltaY * 0.001, 0.5), 3);

        applyTransform();
      };

      const handleMouseMove = (e: MouseEvent) => {
        if (!draggingRef.current) return;
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;

        lastMouseRef.current = { x: e.clientX, y: e.clientY };

        posRef.current = {
          x: posRef.current.x + dx,
          y: posRef.current.y + dy
        };

        applyTransform();
      };

      const handleMouseUp = () => {
        draggingRef.current = false;

        const el = imgRef.current;

        if (el) {
          el.style.cursor = 'grab';
        }
      };

      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('wheel', handleWheel, { passive: false });
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('wheel', handleWheel);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }, [open, onCloseClick, applyTransform]);

    const onClickOutside = useCallback(() => {
      if (!draggingRef.current) {
        onCloseClick();
      }
    }, [onCloseClick]);

    const portalContainer = open
      ? createPortal(
          <>
            <div
              className={cn(
                'fixed inset-0 flex justify-center items-center backdrop-blur-sm bg-black/30 z-50 transition-opacity duration-300',
                visible ? 'opacity-100' : 'opacity-0',
                open ? 'pointer-events-auto' : 'pointer-events-none'
              )}
              onClick={onClickOutside}
            >
              <Component
                {...props}
                ref={imgRef}
                style={{
                  transform: `scale(${scaleRef.current}) translate(${posRef.current.x}px, ${posRef.current.y}px)`,
                  cursor: 'grab'
                }}
                className="p-4 max-w-full max-h-full object-contain"
                onMouseDown={handleMouseDown}
                draggable={false}
                onClick={(e: React.MouseEvent<HTMLDivElement>) =>
                  e.stopPropagation()
                }
              />
              <div className="flex gap-2 absolute top-2 right-2 z-50">
                <IconButton onClick={onCloseClick} icon={X} variant="ghost" />
              </div>
            </div>
          </>,
          portalRoot
        )
      : null;

    return (
      <>
        <Component
          {...props}
          className={cn('cursor-pointer', props.className)}
          onClick={onOpenClick}
          draggable={false}
        />
        {portalContainer}
      </>
    );
  }
);

export { FullScreenImage };
