import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from "react";
import { useOnlyOfficeConfig } from "./useOnlyOfficeConfig";
import { useOnlyOfficeScript } from "./useOnlyOfficeScript";

interface OnlyOfficeEditorProps {
  fileId: number;
  mode: "structuring" | "original";
  height?: string | number;
  /** Called with the live connector once the document is ready (and null on teardown). */
  onConnectorReady?: (connector: any) => void;
}

export interface OnlyOfficeEditorHandle {
  connector: any;
}

export const OnlyOfficeEditor = forwardRef<OnlyOfficeEditorHandle, OnlyOfficeEditorProps>(
  ({ fileId, mode, height = "600px", onConnectorReady }, ref) => {
    const containerId = `onlyoffice-editor-${fileId}-${mode}`;
    const [connector, setConnector] = useState<any>(null);
    const docEditorRef = useRef<any>(null);
    const configRef = useRef<any>(null);

    // Surface the live connector to the parent. The connector is created
    // asynchronously (onDocumentReady), so a ref read during render is always
    // stale — this effect pushes it up whenever it changes.
    useEffect(() => {
      onConnectorReady?.(connector);
    }, [connector, onConnectorReady]);

    const { data: configData, isLoading: configLoading } = useOnlyOfficeConfig(fileId, mode);
    const publicUrl = configData?.onlyoffice_public_url;
    const config = configData?.config;
    configRef.current = config;
    const hasConfig = Boolean(config);

    const scriptUrl = publicUrl ? `${publicUrl}/web-apps/apps/api/documents/api.js` : "";
    const { loaded: scriptLoaded, error: scriptError } = useOnlyOfficeScript(scriptUrl);

    useImperativeHandle(ref, () => ({
      connector,
    }), [connector]);

    // Create the editor ONCE per file/mode (not on every config refetch, which
    // would reset the connector). Acquire the connector via onDocumentReady and
    // a poll fallback, since createConnector() can throw if called too early.
    useEffect(() => {
      if (!scriptLoaded || !hasConfig || !window.DocsAPI) return;
      const cfg = configRef.current;
      if (!cfg) return;

      // Clean up previous instance if any
      if (docEditorRef.current) {
        try {
          docEditorRef.current.destroyEditor();
        } catch (e) {
          console.error("Failed to destroy previous OnlyOffice editor instance:", e);
        }
        docEditorRef.current = null;
        setConnector(null);
      }

      let acquired = false;
      let pollId: number | undefined;
      let stopId: number | undefined;

      const acquireConnector = () => {
        if (acquired) return;
        const inst = docEditorRef.current;
        if (inst && typeof inst.createConnector === "function") {
          try {
            const conn = inst.createConnector();
            if (conn) {
              acquired = true;
              setConnector(conn);
              if (pollId) window.clearInterval(pollId);
              if (stopId) window.clearTimeout(stopId);
            }
          } catch {
            // Not ready yet — the poll below will retry.
          }
        }
      };

      const editorConfig = {
        ...cfg,
        events: {
          ...(cfg.events || {}),
          onDocumentReady: () => {
            console.log("OnlyOffice Document Ready");
            acquireConnector();
          },
        },
      };

      try {
        docEditorRef.current = new window.DocsAPI.DocEditor(containerId, editorConfig);
      } catch (e) {
        console.error("Failed to initialize OnlyOffice editor:", e);
      }

      // Fallback: retry until the connector is obtainable, then stop.
      pollId = window.setInterval(acquireConnector, 800);
      stopId = window.setTimeout(() => {
        if (pollId) window.clearInterval(pollId);
      }, 20000);

      return () => {
        if (pollId) window.clearInterval(pollId);
        if (stopId) window.clearTimeout(stopId);
        if (docEditorRef.current) {
          try {
            docEditorRef.current.destroyEditor();
          } catch (e) {
            console.error("Failed to destroy OnlyOffice editor on unmount:", e);
          }
          docEditorRef.current = null;
          setConnector(null);
        }
      };
    }, [scriptLoaded, containerId, hasConfig]);

    if (configLoading || (publicUrl && !scriptLoaded)) {
      return (
        <div className="flex flex-col items-center justify-center p-10 bg-slate-100" style={{ height }}>
          <div className="w-8 h-8 border-4 border-navy-600 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-semibold mt-4 text-navy-800">Loading OnlyOffice Editor...</span>
        </div>
      );
    }

    if (scriptError) {
      return (
        <div className="flex flex-col items-center justify-center p-10 bg-red-50 text-center" style={{ height }}>
          <span className="text-sm font-bold text-red-700">Failed to load OnlyOffice document editor API.</span>
          <span className="text-xs text-red-500 mt-2">Check ONLYOFFICE_PUBLIC_URL configuration: {publicUrl}</span>
        </div>
      );
    }

    return (
      <div className="flex-1 min-w-0 relative bg-slate-200" style={{ height }}>
        <div id={containerId} className="w-full h-full" />
      </div>
    );
  }
);

OnlyOfficeEditor.displayName = "OnlyOfficeEditor";
