import { create } from 'zustand';

(function getOrCreateSessionId() {
  if (typeof document !== 'undefined') {
    let sessionId = document.cookie.split('; ').find(row => row.startsWith('session_id='))?.split('=')[1];
    if (!sessionId) {
      sessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
      document.cookie = `session_id=${sessionId}; path=/; max-ok=31536000; max-age=31536000; SameSite=Strict`;
    }
  }
})();

export interface ShapeStyle {
  font_name?: string | null;
  font_size_pt?: number | null;
  bold?: boolean | null;
  italic?: boolean | null;
  color_rgb?: string | null;
  alignment?: string | null;
}

export interface ShapeData {
  index: number;
  shapeName: string;
  shapeType: string;
  text?: string;
  position: {
    x_pt: number;
    y_pt: number;
  };
  size: {
    width_pt: number;
    height_pt: number;
  };
  placeholder?: {
    type: string;
    idx: number;
  };
  style?: ShapeStyle;
  imageUrl?: string;
  textBody?: {
    bodyProperties?: Record<string, any>;
    paragraphs?: any[];
  };
  fill?: string;
  border?: {
    color?: string;
  };
  rotation?: number;
}

export interface SlideData {
  index: number;
  slide_id: number;
  backgroundColor?: string;
  shapes: ShapeData[];
}

export interface StylesData {
  slide_width_pt: number;
  slide_height_pt: number;
  slideLayouts: any[];
  slides: SlideData[];
  theme?: any;
  _meta?: {
    warnings?: string[];
    [key: string]: unknown;
  };
}

export interface RunData {
  text: string;
  bold: boolean;
  italic: boolean;
}

export interface AltTextEntry {
  figure_key: string;
  element: string;
  chapter: string;
  decorative: boolean;
  alt_text_short: string;
  alt_text_long: string;
}

export interface Figure {
  id: string;
  name: string;
  url: string;
  page: number;
  filename: string;
  caption?: string;
  captionRuns?: RunData[];
  credit?: string;
  creditRuns?: RunData[];
  alt_text?: string;
  mappedTo?: {
    slideIndex: number;
    shapeIndex: number;
  } | null;
}

export interface PdfCaption {
  id: string;
  page: number;
  label: string;
  text: string;
  runs?: RunData[];
  credit?: string;
  creditRuns?: RunData[];
}

interface StoredTemplate {
  name: string;
  filename: string;
}

interface DeckforgeState {
  step: number;
  setStep: (step: number) => void;

  savedTemplates: StoredTemplate[];
  selectedTemplate: StoredTemplate | null;
  templateStyles: StylesData | null;
  templateLoading: boolean;
  customerName: string;
  projectName: string;
  setCustomerName: (name: string) => void;
  setProjectName: (name: string) => void;
  customers: string[];
  fetchCustomers: () => Promise<void>;
  
  inputPptName: string | null;
  detectedChapter: number | null;
  sourcePdfName: string | null;
  sourcePdfPages: number;
  isConverting: boolean;
  conversionProgress: number;
  includeFigureCaptions: boolean;
  includeTableCaptions: boolean;
  setIncludeFigureCaptions: (val: boolean) => void;
  setIncludeTableCaptions: (val: boolean) => void;

  pdfUrl: string | null;
  currentPdfPage: number;
  figures: Figure[];
  pdfCaptions: PdfCaption[];
  altTextEntries: AltTextEntry[];
  altTextLoading: boolean;
  addFigure: (figure: Omit<Figure, 'id' | 'name'>) => void;
  renameFigure: (id: string, newName: string) => void;
  updateFigureCaption: (id: string, caption: string, credit?: string, captionRuns?: RunData[], creditRuns?: RunData[]) => void;
  updateFigureCredit: (id: string, credit: string) => void;
  updateFigureAltText: (id: string, alt_text: string) => void;
  deleteFigure: (id: string) => void;
  uploadAltTextExcel: (file: File) => Promise<void>;

  slides: SlideData[] | null;
  currentSlideIndex: number;
  setCurrentSlideIndex: (idx: number) => void;
  focusedShapeIndex: number | null;
  setFocusedShapeIndex: (idx: number | null) => void;
  placeFigureOnShape: (slideIndex: number, shapeIndex: number, figureId: string) => Promise<void>;
  placeFigureAtCoordinates: (slideIndex: number, figureId: string, x_pt: number, y_pt: number, w_pt: number, h_pt: number) => Promise<void>;
  removeFigureFromShape: (slideIndex: number, shapeIndex: number) => Promise<void>;

  fetchTemplates: () => Promise<void>;
  uploadTemplateFile: (file: File) => Promise<void>;
  selectTemplate: (filename: string) => Promise<void>;
  uploadInputPptFile: (file: File) => Promise<void>;
  uploadPdfFile: (file: File) => Promise<void>;
  convertDeck: (targetStep?: number) => Promise<void>;
  resetSession: () => Promise<void>;
}

const BASE_URL = '/api/v2/post-prod/ppt-builder';

export const useStore = create<DeckforgeState>((set, get) => ({
  step: 1,
  setStep: (step) => set({ step }),

  savedTemplates: [],
  selectedTemplate: null,
  templateStyles: null,
  templateLoading: false,
  customerName: '',
  projectName: '',
  setCustomerName: (customerName) => set({ customerName }),
  setProjectName: (projectName) => set({ projectName }),
  customers: [],

  inputPptName: null,
  detectedChapter: null,
  sourcePdfName: null,
  sourcePdfPages: 0,
  isConverting: false,
  conversionProgress: 0,
  includeFigureCaptions: true,
  includeTableCaptions: true,
  setIncludeFigureCaptions: (val) => set({ includeFigureCaptions: val }),
  setIncludeTableCaptions: (val) => set({ includeTableCaptions: val }),

  pdfUrl: null,
  currentPdfPage: 0,
  figures: [],
  pdfCaptions: [],
  altTextEntries: [],
  altTextLoading: false,

  slides: null,
  currentSlideIndex: 0,
  focusedShapeIndex: null,

  fetchTemplates: async () => {
    try {
      const res = await fetch(`${BASE_URL}/templates`);
      const data = await res.json();
      if (data.ok) {
        set({ savedTemplates: data.templates });
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    }
  },

  fetchCustomers: async () => {
    try {
      const res = await fetch(`${BASE_URL}/customers`);
      const data = await res.json();
      if (data.ok) {
        set({ customers: data.customers });
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    }
  },

  uploadTemplateFile: async (file: File) => {
    set({ templateLoading: true });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/upload-template`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        set({
          selectedTemplate: { name: file.name.replace('.pptx', ''), filename: data.filename },
          templateStyles: data.styles,
        });
        await get().fetchTemplates();
      } else {
        throw new Error(data.detail || 'Upload failed');
      }
    } catch (err) {
      console.error('Failed to upload template:', err);
      throw err;
    } finally {
      set({ templateLoading: false });
    }
  },

  selectTemplate: async (filename: string) => {
    set({ templateLoading: true });
    try {
      const res = await fetch(`${BASE_URL}/select-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const data = await res.json();
      if (data.ok) {
        set({
          selectedTemplate: { name: filename.replace('.pptx', ''), filename },
          templateStyles: data.styles,
        });
      }
    } catch (err) {
      console.error('Failed to select template:', err);
    } finally {
      set({ templateLoading: false });
    }
  },

  uploadInputPptFile: async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/upload-ppt`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        set({
          inputPptName: file.name,
          detectedChapter: data.chapterNumber ?? null,
          slides: data.slidesInfo?.slides || null,
        });
      }
    } catch (err) {
      console.error('Failed to upload input PPT:', err);
      throw err;
    }
  },

  uploadPdfFile: async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/upload-pdf`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        set({
          sourcePdfName: file.name,
          sourcePdfPages: data.pageCount,
          pdfUrl: `${BASE_URL}/pdf/file`,
          currentPdfPage: 0,
          pdfCaptions: data.captions || [],
        });
      }
    } catch (err) {
      console.error('Failed to upload PDF:', err);
      throw err;
    }
  },

  convertDeck: async (targetStep = 3) => {
    set({ isConverting: true, conversionProgress: 10 });
    const interval = setInterval(() => {
      set((state) => ({
        conversionProgress: Math.min(state.conversionProgress + 15, 90),
      }));
    }, 300);

    try {
      const figuresPayload = get().figures.map((f) => ({
        name: f.name,
        filename: f.filename,
        caption: f.caption,
        captionRuns: f.captionRuns,
        credit: f.credit,
        creditRuns: f.creditRuns,
        alt_text: f.alt_text,
      }));

      const res = await fetch(`${BASE_URL}/process-ppt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          figures: figuresPayload,
          include_figure_captions: get().includeFigureCaptions,
          include_table_captions: get().includeTableCaptions,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        clearInterval(interval);

        const updatedFigures = get().figures.map((fig) => {
          const mapping = (data.autoInserted || []).find((m: any) => m.filename === fig.filename);
          if (mapping) {
            return {
              ...fig,
              mappedTo: {
                slideIndex: mapping.slideIndex,
                shapeIndex: mapping.shapeIndex,
              }
            };
          }
          return fig;
        });

        set({
          conversionProgress: 100,
          slides: data.slidesInfo.slides,
          figures: updatedFigures,
        });
        setTimeout(() => {
          set({ isConverting: false, step: targetStep });
        }, 500);
      } else {
        throw new Error(data.detail || 'Conversion failed');
      }
    } catch (err) {
      clearInterval(interval);
      set({ isConverting: false, conversionProgress: 0 });
      console.error('Failed to convert deck:', err);
      throw err;
    }
  },

  addFigure: (figData) => {
    set((state) => {
      const pageFigures = state.figures.filter((f) => f.page === figData.page);
      const index = pageFigures.length + 1;
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const name = `Figure${figData.page}.${index}`;

      return {
        figures: [...state.figures, { ...figData, id, name, mappedTo: null }],
      };
    });
  },

  renameFigure: (id, newName) => {
    set((state) => ({
      figures: state.figures.map((f) => (f.id === id ? { ...f, name: newName } : f)),
    }));
  },

  updateFigureCredit: (id, credit) => {
    set((state) => ({
      figures: state.figures.map((f) =>
        f.id === id ? { ...f, credit } : f
      ),
    }));
  },

  updateFigureCaption: (id, caption, credit, captionRuns, creditRuns) => {
    set((state) => ({
      figures: state.figures.map((f) =>
        f.id === id ? { ...f, caption, credit, captionRuns, creditRuns } : f
      ),
    }));
  },

  deleteFigure: (id) => {
    set((state) => ({
      figures: state.figures.filter((f) => f.id !== id),
    }));
  },

  updateFigureAltText: (id, alt_text) => {
    set((state) => ({
      figures: state.figures.map((f) => f.id === id ? { ...f, alt_text } : f),
    }));
  },

  uploadAltTextExcel: async (file) => {
    set({ altTextLoading: true });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/parse-alttext-excel`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.ok) throw new Error(data.detail || 'Parse failed');
      const entries: AltTextEntry[] = data.entries;
      const altMap: Record<string, AltTextEntry> = {};
      entries.forEach((e) => { altMap[e.figure_key] = e; });
      set((state) => ({
        altTextEntries: entries,
        figures: state.figures.map((f) => {
          const key = f.name.toLowerCase().replace(/([a-z]+)(\d)/, '$1 $2').replace(/(\d+)\.(\d+)/, '$1.$2');
          const norm = key.replace(/^(figure|table)\s*/, (m: string) => m.trim() + ' ');
          const entry = altMap[norm] ?? altMap[f.name.toLowerCase()];
          return entry ? { ...f, alt_text: entry.alt_text_short } : f;
        }),
      }));
    } finally {
      set({ altTextLoading: false });
    }
  },

  placeFigureOnShape: async (slideIndex, shapeIndex, figureId) => {
    const figure = get().figures.find((f) => f.id === figureId);
    const slides = get().slides;
    if (!figure || !slides) return;

    const targetSlide = slides[slideIndex];
    const targetShape = targetSlide.shapes[shapeIndex];

    try {
      const formData = new FormData();
      formData.append('slide_index', String(slideIndex));
      formData.append('image_name', figure.filename);
      formData.append('x_pt', String(targetShape.position.x_pt));
      formData.append('y_pt', String(targetShape.position.y_pt));
      formData.append('w_pt', String(targetShape.size.width_pt));
      formData.append('h_pt', String(targetShape.size.height_pt));
      const isFigure = figure.name.toLowerCase().startsWith('figure');
      const isTable = figure.name.toLowerCase().startsWith('table');
      const captionAllowed =
        (isFigure && get().includeFigureCaptions) ||
        (isTable && get().includeTableCaptions) ||
        (!isFigure && !isTable);
      if (figure.caption && captionAllowed) {
        formData.append('caption', figure.caption);
        if (figure.captionRuns?.length) {
          formData.append('caption_runs', JSON.stringify(figure.captionRuns));
        }
      }

      const res = await fetch(`${BASE_URL}/add-image`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        set((state) => ({
          slides: data.slidesInfo.slides,
          figures: state.figures.map((f) =>
            f.id === figureId
              ? { ...f, mappedTo: { slideIndex, shapeIndex } }
              : f.mappedTo?.slideIndex === slideIndex && f.mappedTo?.shapeIndex === shapeIndex
              ? { ...f, mappedTo: null }
              : f
          ),
        }));
      }
    } catch (err) {
      console.error('Failed to map figure to shape:', err);
    }
  },

  placeFigureAtCoordinates: async (slideIndex, figureId, x_pt, y_pt, w_pt, h_pt) => {
    const figure = get().figures.find((f) => f.id === figureId);
    if (!figure) return;

    try {
      const formData = new FormData();
      formData.append('slide_index', String(slideIndex));
      formData.append('image_name', figure.filename);
      formData.append('x_pt', String(x_pt));
      formData.append('y_pt', String(y_pt));
      formData.append('w_pt', String(w_pt));
      formData.append('h_pt', String(h_pt));
      const isFigureC = figure.name.toLowerCase().startsWith('figure');
      const isTableC = figure.name.toLowerCase().startsWith('table');
      const captionAllowedC =
        (isFigureC && get().includeFigureCaptions) ||
        (isTableC && get().includeTableCaptions) ||
        (!isFigureC && !isTableC);
      if (figure.caption && captionAllowedC) {
        formData.append('caption', figure.caption);
        if (figure.captionRuns?.length) {
          formData.append('caption_runs', JSON.stringify(figure.captionRuns));
        }
      }

      const res = await fetch(`${BASE_URL}/add-image`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        set((state) => ({
          slides: data.slidesInfo.slides,
          figures: state.figures.map((f) =>
            f.id === figureId
              ? { ...f, mappedTo: { slideIndex, shapeIndex: data.slidesInfo.slides[slideIndex].shapes.length - 1 } }
              : f
          ),
        }));
      }
    } catch (err) {
      console.error('Failed to place figure at coordinates:', err);
    }
  },

  removeFigureFromShape: async (slideIndex, shapeIndex) => {
    set((state) => ({
      figures: state.figures.map((f) =>
        f.mappedTo?.slideIndex === slideIndex && f.mappedTo?.shapeIndex === shapeIndex
          ? { ...f, mappedTo: null }
          : f
      ),
      slides: state.slides
        ? state.slides.map((slide, sIdx) =>
            sIdx === slideIndex
              ? {
                  ...slide,
                  shapes: slide.shapes.map((sh, shIdx) =>
                    shIdx === shapeIndex ? { ...sh, imageUrl: undefined } : sh
                  ),
                }
              : slide
          )
        : null,
    }));
  },

  setCurrentSlideIndex: (currentSlideIndex) => set({ currentSlideIndex }),

  setFocusedShapeIndex: (focusedShapeIndex) => set({ focusedShapeIndex }),

  resetSession: async () => {
    try {
      await fetch(`${BASE_URL}/reset`, { method: 'POST' });
    } catch (_) {}
    set({
      step: 1,
      selectedTemplate: null,
      templateStyles: null,
      inputPptName: null,
      detectedChapter: null,
      sourcePdfName: null,
      sourcePdfPages: 0,
      isConverting: false,
      conversionProgress: 0,
      pdfUrl: null,
      currentPdfPage: 0,
      figures: [],
      pdfCaptions: [],
      slides: null,
      currentSlideIndex: 0,
      focusedShapeIndex: null,
      customerName: '',
      projectName: '',
    });
  },
}));
