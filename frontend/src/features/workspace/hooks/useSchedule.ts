import { useQuery } from "@tanstack/react-query";

import { workspaceApi } from "../api";
import { SCHEDULE_QUERY_KEY } from "../constants";
import type { ScheduleRange } from "../utils/schedule";

export function useSchedule(stage: string | null, range: ScheduleRange, includeCompleted: boolean) {
  return useQuery({
    queryKey: [SCHEDULE_QUERY_KEY, stage, range.startKey, range.endKey, includeCompleted],
    queryFn: () => workspaceApi.schedule(stage as string, range.startKey, range.endKey, includeCompleted),
    enabled: Boolean(stage),
    staleTime: 30_000,
  });
}
