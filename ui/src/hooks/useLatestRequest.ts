import { useCallback, useRef } from "react";

/** Guards against a slow, older answer overwriting the newer one: call `begin()` when a request starts
 *  and check the returned function when its answer arrives; it is true only for the latest request. */
export function useLatestRequest() {
  const latest = useRef(0);
  return useCallback(() => {
    const id = ++latest.current;
    return () => id === latest.current;
  }, []);
}
