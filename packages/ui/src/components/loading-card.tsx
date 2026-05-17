import { memo } from 'react';

type TLoadingCardProps = {
  className?: string;
};

const LoadingCard = memo(({ className: _className }: TLoadingCardProps) => {
  return null;
});

LoadingCard.displayName = 'LoadingCard';

export { LoadingCard };
