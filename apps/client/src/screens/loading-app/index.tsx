import { loadApp } from '@/features/app/actions';
import { useStrictEffect } from '@/hooks/use-strict-effect';
import { memo } from 'react';

type TLoadingApp = {
  text: string;
};

const LoadingApp = memo(({ text = 'Loading' }: TLoadingApp) => {
  useStrictEffect(() => {
    loadApp();
  }, []);

  return (
    <div className="flex h-full items-center justify-center">
      <span className="text-xl text-muted-foreground">{text}</span>
    </div>
  );
});

export { LoadingApp };
