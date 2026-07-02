import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface ImageEditingContextValue {
  cropMode: boolean;
  setCropMode: (v: boolean) => void;
  viewZoom: number;
  setViewZoom: (v: number) => void;
}

const ImageEditingContext = createContext<ImageEditingContextValue | null>(null);

export function ImageEditingProvider({ children }: { children: ReactNode }) {
  const [cropMode, setCropMode] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);

  const value = useMemo(
    () => ({ cropMode, setCropMode, viewZoom, setViewZoom }),
    [cropMode, viewZoom],
  );

  return (
    <ImageEditingContext.Provider value={value}>
      {children}
    </ImageEditingContext.Provider>
  );
}

export function useImageEditing(): ImageEditingContextValue {
  const ctx = useContext(ImageEditingContext);
  if (!ctx) {
    return {
      cropMode: false,
      setCropMode: () => {},
      viewZoom: 1,
      setViewZoom: () => {},
    };
  }
  return ctx;
}
