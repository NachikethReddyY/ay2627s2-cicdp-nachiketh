import { useCallback, useEffect, useRef, useState } from "react";
import type { RouterOutputs } from "./trpc";

export type HomeData = RouterOutputs["home"]["get"];
export type PathCardData = HomeData["official"][number];
export type CourseData = RouterOutputs["courses"]["get"];
export type ExplorePath = RouterOutputs["paths"]["list"][number];

export type ApiState<T> = { data?: T; error?: unknown; loading: boolean; reload: () => void };

export function useApi<T>(key: string, run: () => Promise<T>): ApiState<T> {
  const [state, setState] = useState<{ key: string; tick: number; data?: T; error?: unknown }>({ key: "", tick: -1 });
  const [tick, setTick] = useState(0);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  useEffect(() => {
    let live = true;
    runRef.current().then(
      (data) => live && setState({ key, tick, data }),
      (error) => live && setState({ key, tick, error }),
    );
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const fresh = state.key === key && state.tick === tick;
  return { data: state.key === key ? state.data : undefined, error: fresh ? state.error : undefined, loading: !fresh, reload };
}
