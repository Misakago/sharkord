import { memo } from 'react';

type TSpinnerProps = React.SVGProps<SVGSVGElement> & {
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg';
};

const Spinner = memo((props: TSpinnerProps) => {
  void props;

  return null;
});

export { Spinner };
