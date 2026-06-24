import { useEffect, useState } from "react";

declare global {
  interface Window {
    DocsAPI?: any;
  }
}

export function useOnlyOfficeScript(url: string) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) return;

    // DocsAPI already set — script is loaded and functional.
    if (window.DocsAPI) {
      setLoaded(true);
      return;
    }

    // Script tag exists but window.DocsAPI is gone (destroyEditor() cleared it).
    // Remove the stale tag so we can reinject a fresh copy.
    const stale = document.querySelector(`script[src="${url}"]`);
    if (stale) {
      stale.remove();
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    const onScriptLoad = () => setLoaded(true);
    const onScriptError = () => setError(true);

    script.addEventListener("load", onScriptLoad);
    script.addEventListener("error", onScriptError);

    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", onScriptLoad);
      script.removeEventListener("error", onScriptError);
    };
  }, [url]);

  return { loaded, error };
}
