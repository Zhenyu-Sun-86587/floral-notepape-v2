import { useEffect, useRef } from "react";

/** 隐藏的 WKWebView 可能暂停动画帧；首次显示必须由初始化完成触发。 */
export function useInitialWindowReveal(
  ready: boolean,
  standby: boolean,
  reveal: (isCancelled: () => boolean) => Promise<void>,
  onError: (error: unknown) => void,
): void {
  const entered = useRef(false);
  useEffect(() => {
    if (!ready || standby || entered.current) return;
    let cancelled = false;
    void reveal(() => cancelled)
      .then(() => {
        if (!cancelled) entered.current = true;
      })
      .catch((error) => {
        if (!cancelled) onError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, standby, reveal, onError]);
}
