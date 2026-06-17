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
    if (window.DocsAPI) {
      setLoaded(true);
      return;
    }

    // Check if script is already injected by another component instance
    const existingScript = document.querySelector(`script[src="${url}"]`);
    if (existingScript) {
      const handleLoad = () => setLoaded(true);
      const handleError = () => setError(true);
      existingScript.addEventListener("load", handleLoad);
      existingScript.addEventListener("error", handleError);
      return () => {
        existingScript.removeEventListener("load", handleLoad);
        existingScript.removeEventListener("error", handleError);
      };
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    const onScriptLoad = () => {
      setLoaded(true);
    };

    const onScriptError = () => {
      setError(true);
    };

    script.addEventListener("load", onScriptLoad);
    script.addEventListener("error", onScriptError);

    document.body.appendChild(script);

    return () => {
      script.removeEventListener("load", onScriptLoad);
      script.removeEventListener("error", onScriptError);
      // Optional: keep script in body if other instances might need it,
      // but remove listeners to avoid memory leaks.
    };
  }, [url]);

  return { loaded, error };
}
