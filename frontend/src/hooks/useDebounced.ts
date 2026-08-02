import { useEffect, useState } from 'react';

/** 防抖：value 变化后 delay 毫秒同步，期间新输入会重置计时器。 */
export function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
