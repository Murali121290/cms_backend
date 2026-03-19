import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { startProcessingJob, getProcessingStatus } from "@/api/processing";
import { getApiErrorMessage } from "@/api/client";
import { useToast } from "@/components/ui/useToast";

const POLL_INTERVAL_MS = 5_000;
const TIMEOUT_MS = 600_000; // 10 minutes

interface UseProcessingJobOptions {
  fileId: number;
  projectId: number | null;
  chapterId: number | null;
}

interface UseProcessingJobResult {
  isStarting: boolean;
  isPolling: boolean;
  isComplete: boolean;
  isTimeout: boolean;
  startJob: (processType: string, mode?: string) => Promise<void>;
  reset: () => void;
}

export function useProcessingJob({
  fileId,
  projectId,
  chapterId,
}: UseProcessingJobOptions): UseProcessingJobResult {
  const { addToast, updateToast } = useToast();
  const queryClient = useQueryClient();

  const [isStarting, setIsStarting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isTimeout, setIsTimeout] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number | null>(null);

  function clearPolling() {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  const reset = useCallback(() => {
    clearPolling();
    if (toastIdRef.current) {
      // Don't remove the toast — let user dismiss it
      toastIdRef.current = null;
    }
    startTimeRef.current = null;
    setIsStarting(false);
    setIsPolling(false);
    setIsComplete(false);
    setIsTimeout(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearPolling();
  }, []);

  const startJob = useCallback(
    async (processType: string, mode = "style") => {
      setIsStarting(true);
      setIsComplete(false);
      setIsTimeout(false);

      const toastId = addToast({
        title: `${processType} in progress`,
        description: `Processing file…`,
        variant: "processing",
        duration: 0,
      });
      toastIdRef.current = toastId;

      try {
        await startProcessingJob(fileId, processType, mode);
      } catch (err) {
        updateToast(toastId, {
          title: `${processType} failed to start`,
          description: getApiErrorMessage(err, "Unexpected error"),
          variant: "error",
          duration: 6000,
        });
        setIsStarting(false);
        return;
      }

      setIsStarting(false);
      setIsPolling(true);
      startTimeRef.current = Date.now();

      intervalRef.current = setInterval(async () => {
        // Timeout check
        if (
          startTimeRef.current !== null &&
          Date.now() - startTimeRef.current >= TIMEOUT_MS
        ) {
          clearPolling();
          setIsPolling(false);
          setIsTimeout(true);
          updateToast(toastId, {
            title: `${processType} timed out`,
            description: "Processing took too long. Check server logs.",
            variant: "timeout",
            duration: 0,
          });
          return;
        }

        try {
          const status = await getProcessingStatus(fileId, processType);
          if (status.status === "completed") {
            clearPolling();
            setIsPolling(false);
            setIsComplete(true);
            updateToast(toastId, {
              title: `${processType} complete`,
              description: status.derived_filename ?? "Processing finished",
              variant: "success",
              duration: 6000,
            });
            // Refresh the file list
            if (projectId !== null && chapterId !== null) {
              void queryClient.invalidateQueries({
                queryKey: ["chapter-files", projectId, chapterId],
              });
            }
          }
        } catch {
          // Ignore transient poll errors; let timeout handle unresponsive jobs
        }
      }, POLL_INTERVAL_MS);
    },
    [fileId, projectId, chapterId, addToast, updateToast, queryClient]
  );

  return { isStarting, isPolling, isComplete, isTimeout, startJob, reset };
}
