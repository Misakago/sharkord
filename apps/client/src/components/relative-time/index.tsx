import { useDateLocale } from '@/hooks/use-date-locale';
import {
  format,
  isWithinInterval,
  isFuture,
  subHours,
  type Locale
} from 'date-fns';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';

const ONE_HOUR = 60 * 60 * 1000;
const DEFAULT_FORMAT = 'PPpp'; // eg: 12 August 2022, 14:30
const HOUR_MINUTE_FORMAT = 'HH:mm';

type TRelativeTimeProps = {
  date: Date | string;
  interval?: number;
  children: (relativeTime: string) => ReactNode;
};

const getFormattedTime = (d: Date, dateLocale: Locale): string => {
  const now = new Date();
  const twentyFourHoursAgo = subHours(now, 24);

  // past 24 hours show exact 24-hour time, eg: 14:35
  if (isWithinInterval(d, { start: twentyFourHoursAgo, end: now })) {
    return format(d, HOUR_MINUTE_FORMAT, { locale: dateLocale });
  }

  return format(d, DEFAULT_FORMAT, { locale: dateLocale });
};

const getUpdateInterval = (date: Date): number | null => {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();

  // future dates or absolute dates don't need updates
  if (isFuture(date) || diffInMs > 24 * ONE_HOUR) {
    return null; // no updates needed
  }

  return null;
};

const RelativeTime = memo(
  ({
    date,
    interval, // optional override
    children
  }: TRelativeTimeProps) => {
    const dateLocale = useDateLocale();
    const parsedDate = useMemo(
      () => (typeof date === 'string' ? new Date(date) : date),
      [date]
    );

    const [, setCounter] = useState(0);

    useEffect(() => {
      const updateInterval = interval ?? getUpdateInterval(parsedDate);

      // if no update interval is needed, don't set up a timer
      if (updateInterval === null) {
        return;
      }

      const timer = setInterval(() => {
        // force re-render to update the relative time display
        setCounter((prev) => prev + 1);
      }, updateInterval);

      return () => clearInterval(timer);
    }, [interval, parsedDate]);

    return children(getFormattedTime(parsedDate, dateLocale));
  }
);

export { RelativeTime };
