import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-CN');

export const formatDate = (date: string | Date | undefined | null, format = 'YYYY-MM-DD HH:mm:ss'): string => {
  if (!date) return '-';
  return dayjs(date).format(format);
};

export const formatDateSimple = (date: string | Date | undefined | null): string => {
  return formatDate(date, 'YYYY-MM-DD');
};

export const formatTime = (date: string | Date | undefined | null): string => {
  return formatDate(date, 'HH:mm:ss');
};

export const fromNow = (date: string | Date | undefined | null): string => {
  if (!date) return '-';
  return dayjs(date).fromNow();
};

export const isToday = (date: string | Date | undefined | null): boolean => {
  if (!date) return false;
  return dayjs(date).isSame(dayjs(), 'day');
};

export const isExpired = (date: string | Date | undefined | null, days: number): boolean => {
  if (!date) return false;
  return dayjs().diff(dayjs(date), 'day') > days;
};