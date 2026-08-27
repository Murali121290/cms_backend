/**
 * ChapterEditorPage
 * Full-screen document viewer/editor.
 * Opened ONLY when the user clicks "View" from the file manager.
 *
 * Route: …/chapters/:chapterId/view/:subfolder/:filename
 */
import { useState, useEffect, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Save, Loader2, Download, Maximize2, Minimize2 } from 'lucide-react'
import { DocxViewer } from '@/components/DocxViewer'
import { SourceEditor, SourceEditorRef, formatXmlString } from '@/components/epub_validator/SourceEditor'
import 'pdfjs-viewer-element'
import { projectsApi } from '@/api/projects'
import { chaptersApi } from '@/api/chapters'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { toast } from '@/store/useToastStore'
import { OnlyOfficeEditor, TinyMceEditor, type TinyMceEditorHandle } from '@/features/editor'
import { useParagraphStyles } from '@/features/editor/useParagraphStyles'

interface LintError {
  line: number;
  message: string;
}

interface OutlineItem {
  tagName: string;
  line: number;
  children: OutlineItem[];
}

const parseLogErrors = (log: string | null): LintError[] => {
  if (!log) return [];
  const errors: LintError[] = [];
  const lines = log.split('\n');
  const regex = /:(\d+):\s*(?:validity error\s*:\s*)?(.+)/i;
  
  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const lineNo = parseInt(match[1], 10);
      const message = match[2].trim();
      if (message && message !== '^' && !message.includes('Validation failed: no DTD found')) {
        errors.push({ line: lineNo, message });
      }
    }
  }
  return errors;
};

const parseXmlOutline = (xml: string | null): OutlineItem[] => {
  if (!xml) return [];
  const outline: OutlineItem[] = [];
  const lines = xml.split('\n');
  const stack: OutlineItem[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const tagRegex = /<(\/)?([a-zA-Z0-9_\-]+)(?:\s+[^>]*)*(\/)?>/g;
    let match;
    while ((match = tagRegex.exec(lineText)) !== null) {
      const isClosing = !!match[1];
      const tagName = match[2];
      const isSelfClosing = !!match[3];
      
      if (tagName.startsWith('?') || tagName.startsWith('!')) continue;
      
      if (['strong', 'em', 'italic', 'bold', 'sub', 'sup', 'xref', 'link', 'mml:math', 'mml:mrow', 'tab'].includes(tagName.toLowerCase())) {
        continue;
      }
      
      if (isClosing) {
        stack.pop();
      } else {
        const item: OutlineItem = {
          tagName,
          line: i + 1,
          children: []
        };
        
        if (stack.length === 0) {
          outline.push(item);
        } else {
          stack[stack.length - 1].children.push(item);
        }
        
        if (!isSelfClosing) {
          stack.push(item);
        }
      }
    }
  }
  return outline;
};

function OutlineNode({ node, onSelect }: { node: OutlineItem; onSelect: (line: number) => void }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  
  return (
    <div className="pl-3 font-sans text-xs select-none">
      <div className="flex items-center py-1 hover:bg-gray-100 rounded cursor-pointer group">
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 mr-1"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-4 mr-1" />
        )}
        <span
          onClick={() => onSelect(node.line)}
          className="text-blue-600 hover:underline font-mono"
        >
          &lt;{node.tagName}&gt;
        </span>
        <span className="text-[10px] text-gray-400 ml-auto pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
          L{node.line}
        </span>
      </div>
      {hasChildren && expanded && (
        <div className="border-l border-gray-200 ml-2">
          {node.children.map((child, idx) => (
            <OutlineNode key={idx} node={child} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

interface EpubViewerProps {
  src: string;
}

function EpubViewer({ src }: EpubViewerProps) {
  const [loaded, setLoaded] = useState(false);
  const [toc, setToc] = useState<any[]>([]);
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.error("Error enabling fullscreen:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      });
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const checkEPub = setInterval(() => {
      if ((window as any).ePub) {
        clearInterval(checkEPub);
        setLoaded(true);
      }
    }, 100);
    return () => clearInterval(checkEPub);
  }, []);

  useEffect(() => {
    if (!loaded || !viewerRef.current) return;

    if (viewerRef.current) {
      viewerRef.current.innerHTML = '';
    }

    let active = true;
    let currentBook: any = null;

    fetch(src, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch EPUB file');
        return res.arrayBuffer();
      })
      .then(buffer => {
        if (!active || !viewerRef.current) return;

        try {
          const book = (window as any).ePub(buffer);
          currentBook = book;
          bookRef.current = book;

          const rendition = book.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            flow: 'paginated',
            spread: 'none',
          });
          renditionRef.current = rendition;

          rendition.display();

          book.loaded.navigation.then((nav: any) => {
            if (active) {
              setToc(nav.toc || []);
            }
          });

          rendition.on('relocated', (location: any) => {
            if (active && location && location.start) {
              setCurrentSection(location.start.href);
            }
          });
        } catch (err) {
          console.error("Error loading epub:", err);
          toast.error("Failed to parse EPUB archive");
        }
      })
      .catch(err => {
        console.error("Error fetching EPUB buffer:", err);
        toast.error("Failed to load EPUB file content");
      });

    return () => {
      active = false;
      if (currentBook) {
        try {
          currentBook.destroy();
        } catch (e) {}
      }
    };
  }, [loaded, src]);

  const handlePrev = () => {
    if (renditionRef.current) {
      renditionRef.current.prev();
    }
  };

  const handleNext = () => {
    if (renditionRef.current) {
      renditionRef.current.next();
    }
  };

  const handleSelectToc = (href: string) => {
    if (renditionRef.current) {
      renditionRef.current.display(href);
    }
  };

  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-xs text-gray-500 font-sans">Loading EPUB Reader engine...</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-white overflow-hidden font-sans">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50 select-none flex-shrink-0">
        <div className="flex items-center gap-3">
          {toc.length > 0 && (
            <select
              className="text-xs border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              onChange={(e) => handleSelectToc(e.target.value)}
              value={currentSection || ''}
            >
              <option value="">Table of Contents</option>
              {toc.map((item, idx) => (
                <option key={idx} value={item.href}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            className="p-1 px-3 rounded border border-gray-200 bg-white text-xs font-semibold hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            ◀ Prev
          </button>
          <button
            type="button"
            onClick={handleNext}
            className="p-1 px-3 rounded border border-gray-200 bg-white text-xs font-semibold hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            Next ▶
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            className="p-1 px-2.5 rounded border border-gray-200 bg-white text-xs hover:bg-gray-50 active:bg-gray-100 transition-colors flex items-center justify-center gap-1.5"
          >
            {isFullscreen ? <Minimize2 size={12} className="text-gray-600" /> : <Maximize2 size={12} className="text-gray-600" />}
            <span className="font-semibold text-gray-700">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden bg-gray-100 flex justify-center p-4">
        <div 
          ref={viewerRef} 
          className="w-full max-w-[800px] h-full bg-white shadow-md rounded border border-gray-200 overflow-hidden"
        />
      </div>
    </div>
  );
}

export function ChapterEditorPage() {
  const { projectId, chapterId, subfolder, filename } = useParams<{
    projectId:  string
    chapterId:  string
    subfolder:  string
    filename:   string
  }>()
  const navigate = useNavigate()

  const [loading,  setLoading]  = useState(true)
  const [chapter,  setChapter]  = useState<{ chapter_title: string | null; chapters: string; current_assignee_name: string | null } | null>(null)
  const [project,  setProject]  = useState<{ file_details: Record<string,unknown> | null } | null>(null)

  const [xmlContent, setXmlContent] = useState<string | null>(null)
  const [logContent, setLogContent] = useState<string | null>(null)
  const [xmlLoading, setXmlLoading] = useState(false)
  const [xmlSaving, setXmlSaving] = useState(false)
  const [isXmlDirty, setIsXmlDirty] = useState(false)

  // XHTML states
  const [xhtmlContent, setXhtmlContent] = useState<string | null>(null)
  const [xhtmlLoading, setXhtmlLoading] = useState(false)
  const [xhtmlSaving, setXhtmlSaving] = useState(false)
  const [isXhtmlDirty, setIsXhtmlDirty] = useState(false)
  const [pdfFileUrl, setPdfFileUrl] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [currentPdfPage, setCurrentPdfPage] = useState<number>(1)
  const [activeFileId, setActiveFileId] = useState<number | null>(null)
  const [customCssContent, setCustomCssContent] = useState<string | null>(null)

  const [showOutline, setShowOutline] = useState(true)
  const [showLog, setShowLog] = useState(true)
  const [activeRightTab, setActiveRightTab] = useState<'log' | 'xpath' | 'shortcuts' | 'design' | 'manuscript' | 'layout_preview'>('log')
  const [layoutPreviewUrl, setLayoutPreviewUrl] = useState<string | null>(null)
  const [layoutLoading, setLayoutLoading] = useState(false)
  const [designPdfUrl, setDesignPdfUrl] = useState<string | null>(null)
  const [designLoading, setDesignLoading] = useState(false)
  const [manuscriptHtmlUrl, setManuscriptHtmlUrl] = useState<string | null>(null)
  const [manuscriptLoading, setManuscriptLoading] = useState(false)
  const [manuscriptFileId, setManuscriptFileId] = useState<number | null>(null)
  const [xpathQuery, setXpathQuery] = useState('//title')
  const [xpathResults, setXpathResults] = useState<{ line: number; tagName: string; text: string }[]>([])
  const [xpathError, setXpathError] = useState<string | null>(null)
  
  const xmlEditorRef = useRef<SourceEditorRef | null>(null)
  const wysiwygEditorRef = useRef<TinyMceEditorHandle>(null)
  const pdfjsViewerRef = useRef<any>(null)

  // Styles for XHTML WYSIWYG Editor
  const stylesQuery = useParagraphStyles()
  const [customStyles, setCustomStyles] = useState<string[]>([])
  const publisherStyles = stylesQuery.data || []
  const allStyles = [...publisherStyles, ...customStyles].sort()
  const handleAddStyle = (style: string) => {
    if (!customStyles.includes(style)) {
      setCustomStyles((prev) => [...prev, style].sort())
    }
  }
  
  // XML metrics (Well-formedness check + tags count + words count)
  const xmlMetrics = useMemo(() => {
    if (!xmlContent) return { isValid: true, elementsCount: 0, wordsCount: 0 };
    
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    
    let isValid = true;
    let line: number | undefined;
    let message: string | undefined;
    
    if (parserError) {
      isValid = false;
      message = parserError.textContent || 'XML syntax error';
      const lineMatch = message.match(/line\s+(\d+)/i) || message.match(/:(\d+):\s*(\d+)/);
      line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
    }
    
    const elementsCount = isValid ? xmlDoc.getElementsByTagName('*').length : 0;
    
    const cleanText = xmlContent.replace(/<[^>]*>/g, ' ').trim();
    const wordsCount = cleanText ? cleanText.split(/\s+/).filter(w => w.length > 0).length : 0;
    
    return {
      isValid,
      line,
      message,
      elementsCount,
      wordsCount
    };
  }, [xmlContent]);

  // Combine server-side DTD errors and client-side well-formedness errors
  const xmlErrors = useMemo(() => {
    const errors = parseLogErrors(logContent);
    if (!xmlMetrics.isValid && xmlMetrics.line) {
      errors.push({
        line: xmlMetrics.line,
        message: `Syntax Error: ${xmlMetrics.message}`
      });
    }
    return errors;
  }, [logContent, xmlMetrics]);

  const xmlOutline = useMemo(() => parseXmlOutline(xmlContent), [xmlContent])
  
  const handleOutlineNodeSelect = (lineNum: number) => {
    xmlEditorRef.current?.scrollToLine(lineNum)
  }

  const handleFormatXml = () => {
    if (!xmlContent) return
    try {
      const formatted = formatXmlString(xmlContent)
      setXmlContent(formatted)
      setIsXmlDirty(true)
      toast.success('XML formatted successfully')
    } catch (e) {
      toast.error('Failed to format XML')
    }
  }

  const handleEvaluateXPath = () => {
    if (!xmlContent || !xpathQuery.trim()) return;
    setXpathError(null);
    setXpathResults([]);
    
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'application/xml');
      const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
      if (parserError) {
        throw new Error('XML is not well-formed. Fix syntax errors before running XPath queries.');
      }
      
      const resolver = xmlDoc.createNSResolver(
        xmlDoc.documentElement || xmlDoc
      );
      
      const result = xmlDoc.evaluate(
        xpathQuery,
        xmlDoc,
        resolver,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
        null
      );
      
      const matches: { line: number; tagName: string; text: string }[] = [];
      const lines = xmlContent.split('\n');
      
      for (let i = 0; i < result.snapshotLength; i++) {
        const node = result.snapshotItem(i);
        if (!node) continue;
        let tagName = node.nodeName || 'Match';
        let textVal = node.textContent?.trim() || '';
        
        if (node.nodeType === Node.ATTRIBUTE_NODE) {
          tagName = `@${(node as Attr).name}`;
          textVal = (node as Attr).value;
        } else if (node.nodeType === Node.TEXT_NODE) {
          tagName = '#text';
          textVal = node.nodeValue?.trim() || '';
        }
        
        let lineNum = 1;
        const outerHTML = node.nodeType === Node.ELEMENT_NODE ? (node as Element).outerHTML : '';
        const searchVal = outerHTML ? outerHTML.split('\n')[0].trim() : textVal;
        
        for (let idx = 0; idx < lines.length; idx++) {
          if (lines[idx].includes(searchVal) || (textVal && lines[idx].includes(textVal))) {
            lineNum = idx + 1;
            break;
          }
        }
        
        matches.push({
          line: lineNum,
          tagName,
          text: textVal
        });
      }
      
      setXpathResults(matches);
      if (matches.length === 0) {
        toast.info('XPath evaluation: 0 matches found');
      } else {
        toast.success(`XPath evaluated: ${matches.length} matches found`);
      }
    } catch (err: any) {
      setXpathError(err.message || 'XPath evaluation failed');
      toast.error('XPath evaluation failed');
    }
  };

  useEffect(() => {
    if (!chapterId || !projectId) return
    setLoading(true)
    Promise.all([
      chaptersApi.getById(Number(chapterId)),
      projectsApi.getById(Number(projectId)),
    ])
      .then(([ch, proj]) => {
        setChapter(ch)
        setProject((proj as any).project as { file_details: Record<string, unknown> | null })
      })
      .catch(() => toast.error('Failed to load chapter'))
      .finally(() => setLoading(false))
  }, [chapterId, projectId])

  useEffect(() => {
    const scriptId = 'pdfjs-viewer-element-script';
    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = scriptId;
      script.type = 'module';
      script.src = 'https://cdn.jsdelivr.net/npm/pdfjs-viewer-element/dist/pdfjs-viewer-element.js';
      document.body.appendChild(script);
    }
  }, [])



  const decodedFilename  = filename  ? decodeURIComponent(filename)  : ''
  const decodedSubfolder = subfolder ? decodeURIComponent(subfolder) : ''
  const ext = decodedFilename.split('.').pop()?.toLowerCase() ?? ''
  const logFilename = decodedFilename.replace(/\.xml$/i, '.log')

  // Build download / view URL from the API. Passes chapter_id explicitly so
  // the backend resolver picks the right ChapterInfo row even when multiple
  // chapters share the same slugified name ("chapter-01" matches both a plain
  // "01" and a labelled "Ch 01 - Art").
  const fileUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        const chNo = chapter?.chapters?.match(/\d+/)?.[0]
        if (!project?.file_details || !chNo) return `chapter-${chNo ?? chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(c => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      })()}/${decodedSubfolder}/${encodeURIComponent(decodedFilename)}/download?chapter_id=${chapterId}`
    : null

  const logFileUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        const chNo = chapter?.chapters?.match(/\d+/)?.[0]
        if (!project?.file_details || !chNo) return `chapter-${chNo ?? chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(c => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      })()}/${decodedSubfolder}/${encodeURIComponent(logFilename)}/download`
    : null

  const saveUrl = chapterId && projectId && decodedSubfolder && decodedFilename
    ? `/api/uploads/${projectId}/chapter/${(() => {
        const chNo = chapter?.chapters?.match(/\d+/)?.[0]
        if (!project?.file_details || !chNo) return `chapter-${chNo ?? chapterId}`
        const cf = (project.file_details as { chapter_folders?: { chapters?: Array<{ chapter_name: string }> } }).chapter_folders
        return cf?.chapters?.find(c => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      })()}/${decodedSubfolder}/${encodeURIComponent(decodedFilename)}/save`
    : null

  useEffect(() => {
    if (!projectId || !chapterId || !decodedFilename) return
    projectsApi.getChapterFiles(Number(projectId), Number(chapterId))
      .then(filesData => {
        const docxFile = filesData.files?.find(f => {
          if (!f.filename.toLowerCase().endsWith('.docx')) return false
          let xmlBase = decodedFilename.replace(/\.xml$/i, '')
          if (xmlBase.toLowerCase().endsWith('_indd')) {
            xmlBase = xmlBase.slice(0, -5)
          }
          let docxBase = f.filename.slice(0, -5)
          return xmlBase.toLowerCase() === docxBase.toLowerCase()
        })
        if (docxFile) {
          setManuscriptFileId(docxFile.id)
        }
      })
      .catch(err => {
        console.error("Failed to load chapter files for manuscript:", err)
      })
  }, [projectId, chapterId, decodedFilename])

  const isEditable = !!chapter?.current_assignee_name

  // pdfjs-viewer-element only reacts to a `src` attribute change once its
  // internal viewer app has finished bootstrapping (its attributeChangedCallback
  // no-ops until then) — setting `src` as a plain JSX prop loses that race,
  // since React applies it before the element is even connected to the DOM.
  // Waiting on the element's own `initPromise` before setting it imperatively
  // sidesteps that entirely.
  const pdfViewerRef = useRef<(HTMLElement & { initPromise?: Promise<unknown> }) | null>(null)
  useEffect(() => {
    if (ext !== 'pdf' || !fileUrl) return
    const el = pdfViewerRef.current
    if (!el) return
    let cancelled = false
    Promise.resolve(el.initPromise).then(() => {
      if (!cancelled) el.setAttribute('src', fileUrl)
    })
    return () => { cancelled = true }
  }, [ext, fileUrl])

  // Warning for unsaved changes before leaving browser tab
  useEffect(() => {
    if (!isXmlDirty && !isXhtmlDirty) return
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isXmlDirty, isXhtmlDirty])


  // Fetch XML and Log files if file is XML
  useEffect(() => {
    if (ext !== 'xml' || !fileUrl || !logFileUrl || loading || !chapter) return
    setXmlLoading(true)
    
    fetch(`${fileUrl}${fileUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('XML file not found')
        return res.text()
      })
      .then(text => {
        setXmlContent(text)
      })
      .catch(err => {
        console.error(err)
        toast.error('Failed to load XML content')
      })
      .finally(() => setXmlLoading(false))

    fetch(`${logFileUrl}${logFileUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) return 'No log file found.'
        return res.text()
      })
      .then(text => {
        setLogContent(text)
      })
      .catch(() => {
        setLogContent('No log file found.')
      })
  }, [ext, fileUrl, logFileUrl, loading, chapter])

  // Fetch XHTML content
  useEffect(() => {
    if (ext !== 'xhtml' || !fileUrl || loading || !chapter) return
    setXhtmlLoading(true)
    
    fetch(`${fileUrl}${fileUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('XHTML file not found')
        return res.text()
      })
      .then(text => {
        // Preprocess inline XML citation tags from <div> to <span> so TinyMCE does not split paragraphs
        const inlineTags = "edition|publisher-name|publisher-loc|month|year|surname|given-names|collab|comment|volume|issue|fpage|lpage|ext-link|uri|xref|named-content|label|string-name|person-group|mixed-citation|bold|italic|sub|sup";
        const divInlineRegex = new RegExp(`<div(\\s+[^>]*)data-xml-tag="(${inlineTags})"([^>]*)>(.*?)<\\/div>`, "gi");
        let cleaned = text.replace(divInlineRegex, '<span$1data-xml-tag="$2"$3>$4</span>');
        
        // Merge adjacent consecutive track changes insertion spans into a single span
        let prevCleaned = "";
        while (prevCleaned !== cleaned) {
          prevCleaned = cleaned;
          cleaned = cleaned.replace(/(<(?:span|ins)[^>]*class="[^"]*tc-insert[^"]*"[^>]*>)(.*?)<\/(?:span|ins)>\s*<(?:span|ins)[^>]*class="[^"]*tc-insert[^"]*"[^>]*>(.*?)<\/(?:span|ins)>/gi, '$1$2$3</span>');
        }

        setXhtmlContent(cleaned)
      })
      .catch(err => {
        console.error(err)
        toast.error('Failed to load XHTML content')
      })
      .finally(() => setXhtmlLoading(false))
  }, [ext, fileUrl, loading, chapter])

  // Fetch Matching Chapter PDF
  // Fetch Matching Chapter PDF, Active File ID & Generated CSS
  useEffect(() => {
    if (!projectId || !chapterId) return
    setPdfLoading(true)
    projectsApi.getChapterFiles(Number(projectId), Number(chapterId))
      .then(filesData => {
        // Resolve active file ID
        if (decodedFilename) {
          const fileRec = filesData.files?.find(f => f.filename === decodedFilename)
          if (fileRec) {
            setActiveFileId(fileRec.id)
          }
        }

        if (ext !== 'xhtml' || !chapter) return

        // Resolve matching PDF
        const pdfFile = filesData.files?.find(f => f.filename.toLowerCase().endsWith('.pdf'))
        if (pdfFile) {
          const chNo = chapter.chapters?.match(/\d+/)?.[0]
          let chFolder = `chapter-${chapterId}`
          if (project?.file_details && chNo) {
            const cf = (project.file_details as any).chapter_folders
            chFolder = cf?.chapters?.find((c: any) => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
          }
          const folder = (pdfFile as any).subfolder || pdfFile.category || 'Proof'
          const url = `/api/uploads/${projectId}/chapter/${chFolder}/${folder}/${encodeURIComponent(pdfFile.filename)}/download?chapter_id=${chapterId}`
          setPdfFileUrl(url)
        } else {
          console.warn("No PDF proof file found for this chapter")
        }

        // Resolve matching InDesign CSS
        const cssFile = filesData.files?.find(f => f.filename.toLowerCase().endsWith('.css'))
        if (cssFile) {
          const chNo = chapter.chapters?.match(/\d+/)?.[0]
          let chFolder = `chapter-${chapterId}`
          if (project?.file_details && chNo) {
            const cf = (project.file_details as any).chapter_folders
            chFolder = cf?.chapters?.find((c: any) => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
          }
          const folder = (cssFile as any).subfolder || cssFile.category || 'Proof'
          const url = `/api/uploads/${projectId}/chapter/${chFolder}/${folder}/${encodeURIComponent(cssFile.filename)}/download?chapter_id=${chapterId}`
          
          fetch(url, { credentials: 'include' })
            .then(res => {
              if (!res.ok) throw new Error('CSS file not found')
              return res.text()
            })
            .then(text => setCustomCssContent(text))
            .catch(err => console.error("Failed to load custom CSS file:", err))
        }
      })
      .catch(err => {
        console.error("Failed to load chapter files:", err)
      })
      .finally(() => setPdfLoading(false))
  }, [ext, projectId, chapterId, chapter, project, decodedFilename])

  // CSS rule prefixing helper to prevent styles from bleeding out of the editor wrapper
  const scopeCss = (cssText: string, prefix: string): string => {
    return cssText.replace(/([^\r\n,{}]+)(?=\s*\{)/g, (match) => {
      const trimmed = match.trim()
      if (trimmed.startsWith('@') || trimmed.startsWith('to') || trimmed.startsWith('from') || /^\d+%$/.test(trimmed)) {
        return match
      }
      return trimmed
        .split(',')
        .map((sel) => {
          const s = sel.trim()
          return s === 'body' || s === 'html' ? `${prefix}` : `${prefix} ${s}`
        })
        .join(', ')
    })
  }

  // Inject/cleanup custom CSS styles in the document head
  useEffect(() => {
    if (!customCssContent) return
    
    const existing = document.getElementById('xhtml-chapter-styles')
    if (existing) existing.remove()
    
    const styleEl = document.createElement('style')
    styleEl.id = 'xhtml-chapter-styles'
    styleEl.textContent = scopeCss(customCssContent, '.ProseMirror')
    document.head.appendChild(styleEl)
    
    return () => {
      const el = document.getElementById('xhtml-chapter-styles')
      if (el) el.remove()
    }
  }, [customCssContent])

  // Inject custom XHTML block highlighting (boxed-text and LearnObject) in document head
  useEffect(() => {
    if (ext !== 'xhtml') return
    
    const existing = document.getElementById('xhtml-block-highlights')
    if (existing) existing.remove()
    
    const styleEl = document.createElement('style')
    styleEl.id = 'xhtml-block-highlights'
    styleEl.textContent = `
      /* Generic highlighting wrapper styles */
      .ProseMirror div[data-xml-tag="boxed-text"],
      .ProseMirror div[data-xml-tag="sec"][disp-level="LearnObject"] {
        position: relative;
        border-radius: 6px;
        padding: 16px;
        margin: 20px 0;
        transition: all 0.2s ease;
        box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.02);
      }
      
      .ProseMirror div[data-xml-tag="boxed-text"]:hover,
      .ProseMirror div[data-xml-tag="sec"][disp-level="LearnObject"]:hover {
        box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.05);
      }
      
      /* Badge label formatting */
      .ProseMirror div[data-xml-tag="boxed-text"]::before,
      .ProseMirror div[data-xml-tag="sec"][disp-level="LearnObject"]::before {
        display: inline-block;
        float: right;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: none;
        padding: 2px 6px;
        border-radius: 4px;
        margin-top: -6px;
        margin-right: -6px;
        pointer-events: none;
        user-select: none;
      }
      
      /* 1. Boxed Text Highlights */
      .ProseMirror div[data-xml-tag="boxed-text"] {
        border: 1px dashed #f59e0b !important;
        border-left: 4px solid #f59e0b !important;
        background-color: #fffbeb !important;
      }
      .ProseMirror div[data-xml-tag="boxed-text"]::before {
        content: "Boxed Text";
        color: #d97706;
        background-color: #fef3c7;
      }
      
      /* 2. Learning Objectives Highlights */
      .ProseMirror div[data-xml-tag="sec"][disp-level="LearnObject"] {
        border: 1px dashed #10b981 !important;
        border-left: 4px solid #10b981 !important;
        background-color: #f0fdf4 !important;
      }
      .ProseMirror div[data-xml-tag="sec"][disp-level="LearnObject"]::before {
        content: "Learning Objectives";
        color: #059669;
        background-color: #d1fae5;
      }
    `
    document.head.appendChild(styleEl)
    
    return () => {
      const el = document.getElementById('xhtml-block-highlights')
      if (el) el.remove()
    }
  }, [ext])

  // XHTML Save Handler
  const handleXhtmlSave = async (explicitHtml?: string) => {
    let content = typeof explicitHtml === 'string' ? explicitHtml : xhtmlContent
    if (!explicitHtml && wysiwygEditorRef.current?.editor) {
      content = wysiwygEditorRef.current.editor.getHTML()
    }
    if (!saveUrl || !content || xhtmlSaving) return
    setXhtmlSaving(true)
    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('Save failed')
      setIsXhtmlDirty(false)
      toast.success('XHTML saved successfully')
    } catch (err) {
      toast.error('Failed to save XHTML')
    } finally {
      setXhtmlSaving(false)
    }
  }

  // Synchronize editor cursor position to PDF page number
  const handleSelectionUpdate = ({ editor }: { editor: any }) => {
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0) {
      let node: Node | null = selection.getRangeAt(0).startContainer
      while (node && node !== editor.view.dom) {
        let sibling: Node | null = node
        while (sibling) {
          if (sibling.nodeType === Node.ELEMENT_NODE) {
            const el = sibling as HTMLElement
            const isPageElement = el.classList.contains('page') || 
                                  el.classList.contains('page-break') || 
                                  el.classList.contains('pb') || 
                                  el.id?.toLowerCase().startsWith('page-') ||
                                  el.id?.toLowerCase().startsWith('page_') ||
                                  el.getAttribute('data-page')
             
            if (isPageElement) {
              const pageStr = el.getAttribute('data-page') || 
                              el.id?.replace(/page[-_]/i, '') || 
                              el.textContent?.replace(/\D/g, '') || 
                              el.getAttribute('id')
              const pageNum = parseInt(pageStr || '', 10)
              if (pageNum && !isNaN(pageNum)) {
                setCurrentPdfPage(pageNum)
                return
              }
            }
          }
          sibling = sibling.previousSibling
        }
        node = node.parentNode
      }
    }
  }

  const loadLayoutPreview = () => {
    if (!projectId || !chapterId || !decodedFilename) return
    setLayoutLoading(true)
    const chFolder = chapter?.chapters ? chapter.chapters.replace(/^chapter-/, '') : chapterId
    const url = `/api/uploads/${projectId}/chapter/chapter-${chFolder}/${decodedSubfolder}/${encodeURIComponent(decodedFilename)}/layout-preview?t=${Date.now()}`
    setLayoutPreviewUrl(url)
  }

  const handleXmlSave = async () => {
    if (!saveUrl || xmlContent === null || xmlSaving) return
    setXmlSaving(true)
    try {
      const res = await fetch(saveUrl, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: xmlContent }),
      })
      if (!res.ok) throw new Error('Save failed')
      const data = await res.json()
      setIsXmlDirty(false)
      if (data.log_content) {
        setLogContent(data.log_content)
      }
      toast.success('XML file saved successfully')
      if (layoutPreviewUrl) {
        loadLayoutPreview()
      }
    } catch (err) {
      toast.error('Failed to save XML file')
    } finally {
      setXmlSaving(false)
    }
  }

  // Window-level Ctrl+S / Cmd+S save keymap shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (ext === 'xml') {
          void handleXmlSave()
        } else if (ext === 'xhtml') {
          void handleXhtmlSave()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [ext, handleXmlSave, handleXhtmlSave])

  const loadDesignPdf = async () => {
    if (designPdfUrl || designLoading) return
    setDesignLoading(true)
    try {
      const chaptersData = await projectsApi.getProjectChapters(Number(projectId))
      const designChapter = chaptersData.chapters?.find(c => c.number.toLowerCase() === 'design')
      if (designChapter) {
        const filesData = await projectsApi.getChapterFiles(Number(projectId), designChapter.id)
        const pdfFile = filesData.files?.find(f => f.filename.toLowerCase().endsWith('.pdf'))
        if (pdfFile) {
          const url = `/api/uploads/${projectId}/chapter/chapter-${designChapter.id}/${pdfFile.category}/${encodeURIComponent(pdfFile.filename)}/download`
          setDesignPdfUrl(url)
        } else {
          toast.error("No Design PDF file found in Design folder")
        }
      } else {
        toast.error("Design chapter not found in this project")
      }
    } catch (err) {
      console.error("Failed to load design pdf:", err)
      toast.error("Failed to fetch design details")
    } finally {
      setDesignLoading(false)
    }
  }

  const loadManuscriptHtml = async () => {
    if (manuscriptHtmlUrl || manuscriptLoading) return
    setManuscriptLoading(true)
    try {
      // Derive manuscript base name from the XML file name currently being edited
      let baseName = decodedFilename.replace(/\.xml$/i, '')
      if (baseName.toLowerCase().endsWith('_indd')) {
        baseName = baseName.slice(0, -5)
      }
      const htmlFilename = `${baseName}.html`
      
      const chNo = chapter?.chapters?.match(/\d+/)?.[0]
      let chFolder = `chapter-${chapterId}`
      if (project?.file_details && chNo) {
        const cf = (project.file_details as any).chapter_folders
        chFolder = cf?.chapters?.find((c: any) => c.chapter_name === `chapter-${chNo}`)?.chapter_name ?? `chapter-${chNo}`
      }
      
      const url = `/api/uploads/${projectId}/chapter/${chFolder}/Manuscript/xhtml/${encodeURIComponent(htmlFilename)}/download`
      setManuscriptHtmlUrl(url)
    } catch (err) {
      console.error("Failed to load manuscript:", err)
      toast.error("Failed to fetch manuscript details")
    } finally {
      setManuscriptLoading(false)
    }
  }

  const handleBack = () => {
    if (isXmlDirty || isXhtmlDirty) {
      if (!window.confirm('You have unsaved changes. Do you really want to leave?')) {
        return
      }
    }
    navigate(-1)
  }

  if (loading) return <FullPageSpinner/>

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">

      {/* ── TOOLBAR ──────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0 shadow-sm">
        {/* Back to file manager */}
        <button onClick={handleBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          <ArrowLeft size={13}/> Back to Files
        </button>

        <div className="w-px h-5 bg-gray-200 flex-shrink-0"/>

        {/* File name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileText size={14} className="text-gray-400 flex-shrink-0"/>
          <span className="text-sm font-semibold text-gray-900 truncate">{decodedFilename}</span>
          <span className="text-[10px] text-gray-400">{decodedSubfolder}</span>
          {!isEditable && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 flex-shrink-0">
              View Only
            </span>
          )}
        </div>

        {/* Download */}
        {fileUrl && (
          <a href={fileUrl} download={decodedFilename}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <Download size={13}/> Download
          </a>
        )}

        {/* Save */}
        {isEditable && (
          <button
            onClick={ext === 'xml' ? handleXmlSave : ext === 'xhtml' ? () => handleXhtmlSave() : () => toast.success('Auto-saved')}
            disabled={(ext === 'xml' && xmlSaving) || (ext === 'xhtml' && xhtmlSaving)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50">
            {(xmlSaving || xhtmlSaving) ? <Loader2 size={13} className="animate-spin" /> : <Save size={13}/>}
            {ext === 'xml' && isXmlDirty ? 'Save*' : ext === 'xhtml' && isXhtmlDirty ? 'Save*' : 'Save'}
          </button>
        )}
      </header>

      {/* ── DOCUMENT AREA — full screen, no split ─────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {!fileUrl ? (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <FileText size={48} className="mx-auto mb-3 opacity-20"/>
              <p className="text-sm">File not found</p>
            </div>
          </div>
        ) : ext === 'xhtml' ? (
          xhtmlLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="flex h-full w-full overflow-hidden">
              {/* Left Panel: PDF Viewer */}
              <div className="w-1/2 h-full flex flex-col overflow-hidden bg-gray-50 border-r border-gray-200">
                {pdfLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  </div>
                ) : pdfFileUrl ? (
                  // @ts-ignore
                  <pdfjs-viewer-element src={pdfFileUrl} key={pdfFileUrl} page={currentPdfPage} ref={pdfjsViewerRef} style={{ width: '100%', height: '100%', display: 'block', border: '0' }} />
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400 p-8 text-center">
                    <div>
                      <FileText size={48} className="mx-auto mb-3 opacity-20"/>
                      <p className="text-sm font-medium">No matching PDF proof file found</p>
                      <p className="text-xs mt-1 max-w-xs text-gray-400">
                        Please make sure a .pdf file is uploaded in the chapter's Proof folder to enable split view linking.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              {/* Right Panel: XHTML Editor (WYSIWYG) */}
              <div className="w-1/2 h-full border-l border-gray-200 flex flex-col overflow-hidden bg-slate-900">
                <TinyMceEditor
                  ref={wysiwygEditorRef}
                  key={fileUrl || 'xhtml'}
                  initialContent={xhtmlContent ?? ""}
                  onSave={async (html) => {
                    await handleXhtmlSave(html)
                  }}
                  isSaving={xhtmlSaving}
                  saveLabel="Save XHTML"
                  documentTitle={decodedFilename}
                  height="calc(100vh - 48px)"
                  styles={allStyles}
                  onAddStyle={handleAddStyle}
                  onContentChange={() => setIsXhtmlDirty(true)}
                  onSelectionUpdate={handleSelectionUpdate}
                  fileId={activeFileId ? String(activeFileId) : undefined}
                  trackChangesEnabled={true}
                  currentUser={chapter?.current_assignee_name || 'Compositor'}
                  customCss={customCssContent || ""}
                />
              </div>
            </div>
          )
        ) : ext === 'pdf' ? (
          // @ts-ignore
          <pdfjs-viewer-element
            src={fileUrl}
            key={fileUrl}
            ref={pdfViewerRef}
            style={{ width: '100%', height: '100%', display: 'block', border: '0' }}
          />
        ) : (ext === 'html' || ext === 'htm') ? (
          <iframe
            src={fileUrl}
            title={decodedFilename}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
          />
        ) : (ext === 'docx' || ext === 'doc') ? (
          <DocxViewer src={fileUrl} editable={isEditable} className="h-full"/>
        ) : (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) ? (
          <div className="h-full flex items-center justify-center bg-gray-50 overflow-auto p-8">
            <img src={fileUrl} alt={decodedFilename}
              className="max-w-full max-h-full object-contain rounded-lg shadow-md"/>
          </div>
        ) : ext === 'epub' ? (
          <EpubViewer src={fileUrl} />
        ) : ext === 'xml' ? (
          xmlLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="flex h-full w-full overflow-hidden">
              {/* Collapsible Outline Panel */}
              {showOutline && (
                <div className="w-64 h-full border-r border-gray-200 bg-white flex flex-col overflow-hidden flex-shrink-0">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider flex-shrink-0">
                    Document Outline
                  </div>
                  <div className="flex-1 overflow-auto p-2">
                    {xmlOutline.length === 0 ? (
                      <div className="text-gray-400 text-center py-4 text-xs font-sans">No elements found</div>
                    ) : (
                      xmlOutline.map((node, idx) => (
                        <OutlineNode key={idx} node={node} onSelect={handleOutlineNodeSelect} />
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Left Panel: XML Editor */}
              <div className={`${showLog ? 'w-1/2' : 'flex-1'} h-full border-r border-gray-200 flex flex-col overflow-hidden`}>
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-700 uppercase tracking-wider flex items-center justify-between flex-shrink-0 select-none">
                  <div className="flex items-center gap-2">
                    <span>XML Source</span>
                    {isXmlDirty && <span className="text-amber-600 normal-case font-normal font-sans text-[11px] ml-2">Unsaved changes</span>}
                  </div>
                  <div className="flex items-center gap-1.5 normal-case font-medium">
                    <button
                      type="button"
                      onClick={() => setShowOutline(!showOutline)}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors flex items-center gap-1 ${showOutline ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      Outline
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (xmlMetrics.isValid) {
                          toast.success('✓ XML Document is Well-Formed!');
                        } else {
                          if (xmlMetrics.line) {
                            xmlEditorRef.current?.scrollToLine(xmlMetrics.line);
                            toast.error(`✗ Syntax Error on Line ${xmlMetrics.line}`);
                          } else {
                            toast.error(`✗ Syntax Error: ${xmlMetrics.message}`);
                          }
                        }
                      }}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${xmlMetrics.isValid ? 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50' : 'bg-red-50 text-red-700 border-red-200 font-semibold'}`}
                    >
                      Check Well-Formedness
                    </button>
                    <button
                      type="button"
                      onClick={handleFormatXml}
                      disabled={!isEditable}
                      className="px-2 py-0.5 rounded border text-[11px] bg-white text-gray-600 border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Format XML
                    </button>
                    {ext === 'xml' && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowLog(true)
                          setActiveRightTab('layout_preview')
                          loadLayoutPreview()
                        }}
                        className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${showLog && activeRightTab === 'layout_preview' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                      >
                        {layoutLoading ? 'Loading Layout...' : 'Layout HTML'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowLog(true)
                        setActiveRightTab('shortcuts')
                      }}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${showLog && activeRightTab === 'shortcuts' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      Shortcuts
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLog(true)
                        setActiveRightTab('design')
                        void loadDesignPdf()
                      }}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${showLog && activeRightTab === 'design' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      {designLoading ? 'Loading Design...' : 'Design'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowLog(true)
                        setActiveRightTab('manuscript')
                        void loadManuscriptHtml()
                      }}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${showLog && activeRightTab === 'manuscript' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                    >
                      {manuscriptLoading ? 'Converting...' : 'Manuscript'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLog(!showLog)}
                      className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${showLog ? 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50' : 'bg-amber-50 text-amber-700 border-amber-200'}`}
                    >
                      {showLog ? 'Hide Log' : 'Show Log'}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <SourceEditor
                    ref={xmlEditorRef}
                    value={xmlContent ?? ''}
                    onChange={(val) => {
                      setXmlContent(val)
                      setIsXmlDirty(true)
                    }}
                    readOnly={!isEditable}
                    errors={xmlErrors}
                    onSave={handleXmlSave}
                    className="flex-1 min-h-0"
                  />
                </div>
              </div>
              
              {/* Right Panel: Log or XPath (Read-only) */}
              {showLog && (
                <div className="w-1/2 h-full flex flex-col bg-gray-50 overflow-hidden">
                  <div className="flex bg-gray-100 border-b border-gray-200 h-9 flex-shrink-0 select-none">
                    <button
                      type="button"
                      onClick={() => setActiveRightTab('log')}
                      className={`flex-1 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${activeRightTab === 'log' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                    >
                      Conversion Log
                    </button>
                    {ext === 'xml' && (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveRightTab('layout_preview')
                          loadLayoutPreview()
                        }}
                        className={`flex-1 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${activeRightTab === 'layout_preview' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                      >
                        Layout HTML
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveRightTab('xpath')}
                      className={`flex-1 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${activeRightTab === 'xpath' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                    >
                      XPath Evaluator
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveRightTab('shortcuts')}
                      className={`flex-1 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${activeRightTab === 'shortcuts' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                    >
                      Shortcuts
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveRightTab('design')
                        void loadDesignPdf()
                      }}
                      className={`flex-1 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${activeRightTab === 'design' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                    >
                      Design PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveRightTab('manuscript')
                        void loadManuscriptHtml()
                      }}
                      className={`flex-1 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${activeRightTab === 'manuscript' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                    >
                      Manuscript
                    </button>
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {activeRightTab === 'layout_preview' && (
                      <div className="flex-1 flex flex-col min-h-0 bg-white relative">
                        {layoutLoading && (
                          <div className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs text-gray-500 gap-1.5 z-10">
                            <Loader2 size={14} className="animate-spin text-blue-600" /> Generating Layout Preview...
                          </div>
                        )}
                        {layoutPreviewUrl ? (
                          <iframe
                            src={layoutPreviewUrl}
                            onLoad={() => setLayoutLoading(false)}
                            className="w-full h-full border-0 bg-white"
                            title="Layout HTML Preview"
                          />
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-sans p-4 text-center">
                            Could not generate Layout Preview.
                          </div>
                        )}
                      </div>
                    )}
                    {activeRightTab === 'log' && (
                      <SourceEditor
                        value={logContent ?? 'Loading log...'}
                        onChange={() => {}}
                        readOnly={true}
                        onLogLineClick={handleOutlineNodeSelect}
                        className="flex-1 min-h-0 bg-gray-50 opacity-80"
                      />
                    )}
                    {activeRightTab === 'xpath' && (
                      <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden bg-white">
                        <div className="flex gap-2 flex-shrink-0">
                          <input
                            type="text"
                            value={xpathQuery}
                            onChange={(e) => setXpathQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleEvaluateXPath(); }}
                            placeholder="e.g. //title or //xref"
                            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                          />
                          <button
                            type="button"
                            onClick={handleEvaluateXPath}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex-shrink-0"
                          >
                            Evaluate
                          </button>
                        </div>
                        
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex-shrink-0">
                          Matches
                        </div>
                        
                        <div className="flex-1 border border-gray-200 rounded-lg overflow-y-auto bg-gray-50 font-mono text-[11px]">
                          {xpathError ? (
                            <div className="p-3 text-red-600">{xpathError}</div>
                          ) : xpathResults.length === 0 ? (
                            <div className="p-3 text-gray-400 text-center text-xs font-sans">
                              Enter XPath query and click evaluate
                            </div>
                          ) : (
                            xpathResults.map((match, idx) => (
                              <div
                                key={idx}
                                onClick={() => handleOutlineNodeSelect(match.line)}
                                className="p-2 border-b border-gray-200 hover:bg-gray-100 cursor-pointer transition-colors flex flex-col gap-0.5"
                              >
                                <span className="text-blue-700 font-semibold">&lt;{match.tagName}&gt; (Line {match.line})</span>
                                <span className="text-gray-600 truncate">{match.text || '(empty)'}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                    {activeRightTab === 'shortcuts' && (
                      <div className="flex-1 p-4 overflow-y-auto bg-white text-xs font-sans text-gray-700">
                        <h3 className="font-semibold text-sm mb-3 border-b pb-2 text-gray-800">XML Editor Keyboard Shortcuts</h3>
                        <table className="w-full border-collapse border border-gray-200 text-xs">
                          <thead>
                            <tr className="bg-gray-50 text-[10px] uppercase text-gray-500">
                              <th className="border border-gray-200 p-2 text-left">Action / Operation</th>
                              <th className="border border-gray-200 p-2 text-left">Windows / Linux</th>
                              <th className="border border-gray-200 p-2 text-left">macOS</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="border border-gray-200 p-2 font-medium">💾 Save Document</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl + S</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd + S</td>
                            </tr>
                            <tr className="bg-gray-50/50">
                              <td className="border border-gray-200 p-2 font-medium">🔄 Toggle Word Wrap</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Alt + Z</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Option + Z</td>
                            </tr>
                            <tr>
                              <td className="border border-gray-200 p-2 font-medium">🔍 Open Find Panel</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl + F</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd + F</td>
                            </tr>
                            <tr className="bg-gray-50/50">
                              <td className="border border-gray-200 p-2 font-medium">✏️ Open Replace Panel</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl + H</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd + H</td>
                            </tr>
                            <tr>
                              <td className="border border-gray-200 p-2 font-medium">⏭️ Find Next Match</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">F3 / Enter</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">F3 / Enter</td>
                            </tr>
                            <tr className="bg-gray-50/50">
                              <td className="border border-gray-200 p-2 font-medium">⏮️ Find Previous Match</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Shift+F3 / Shift+Enter</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Shift+F3 / Shift+Enter</td>
                            </tr>
                            <tr>
                              <td className="border border-gray-200 p-2 font-medium">❌ Close Search Panel</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Escape</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Escape</td>
                            </tr>
                            <tr className="bg-gray-50/50">
                              <td className="border border-gray-200 p-2 font-medium">↩️ Undo Edit</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl + Z</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd + Z</td>
                            </tr>
                            <tr>
                              <td className="border border-gray-200 p-2 font-medium">↪️ Redo Edit</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl+Y / Ctrl+Shift+Z</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd+Shift+Z</td>
                            </tr>
                            <tr className="bg-gray-50/50">
                              <td className="border border-gray-200 p-2 font-medium">📐 Fold XML tag</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl + Shift + [</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd + Option + [</td>
                            </tr>
                            <tr>
                              <td className="border border-gray-200 p-2 font-medium">📐 Unfold XML tag</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Ctrl + Shift + ]</td>
                              <td className="border border-gray-200 p-2 font-mono text-blue-600">Cmd + Option + ]</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    {activeRightTab === 'design' && (
                      <div className="flex-1 flex flex-col min-h-0 bg-white">
                        {designLoading ? (
                          <div className="flex-1 flex items-center justify-center text-xs text-gray-500 gap-1.5">
                            <Loader2 size={14} className="animate-spin text-blue-600" /> Loading Design PDF...
                          </div>
                        ) : designPdfUrl ? (
                          <iframe
                            src={designPdfUrl}
                            className="w-full h-full border-0"
                            title="Design PDF Preview"
                          />
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-sans p-4 text-center">
                            No Design PDF found.
                          </div>
                        )}
                      </div>
                    )}
                    {activeRightTab === 'manuscript' && (
                      <div className="flex-1 flex flex-col min-h-0 bg-white relative">
                        {manuscriptFileId ? (
                          <OnlyOfficeEditor
                            fileId={manuscriptFileId}
                            mode="structuring"
                            height="100%"
                          />
                        ) : manuscriptLoading ? (
                          <div className="flex-1 flex items-center justify-center text-xs text-gray-500 gap-1.5">
                            <Loader2 size={14} className="animate-spin text-blue-600" /> Loading Manuscript...
                          </div>
                        ) : manuscriptHtmlUrl ? (
                          <iframe
                            src={manuscriptHtmlUrl}
                            className="w-full h-full border-0 bg-white"
                            title="Manuscript Preview"
                          />
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-xs text-gray-400 font-sans p-4 text-center">
                            No converted Manuscript file found.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-8">
            <FileText size={52} className="text-gray-200"/>
            <p className="text-sm font-semibold text-gray-700">{decodedFilename}</p>
            <p className="text-xs text-gray-400">.{ext.toUpperCase()} files cannot be previewed in the browser.</p>
            <a href={fileUrl} download={decodedFilename}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors">
              ⬇ Download to view
            </a>
          </div>
        )}
      </div>
      {ext === 'xml' && !xmlLoading && (
        <footer className="h-7 bg-white border-t border-gray-200 px-4 flex items-center justify-between text-[11px] text-gray-500 font-sans select-none flex-shrink-0">
          <div
            onClick={() => {
              if (!xmlMetrics.isValid && xmlMetrics.line) {
                xmlEditorRef.current?.scrollToLine(xmlMetrics.line);
              }
            }}
            className={`flex items-center gap-1.5 font-medium cursor-pointer ${xmlMetrics.isValid ? 'text-green-600 hover:underline' : 'text-red-600 hover:underline animate-pulse'}`}
          >
            {xmlMetrics.isValid ? '✓ Well-formed' : `✗ Syntax Error (Line ${xmlMetrics.line ?? '?'})`}
          </div>
          <div className="flex gap-4">
            <span>Elements: {xmlMetrics.elementsCount}</span>
            <span>Words: {xmlMetrics.wordsCount}</span>
          </div>
        </footer>
      )}
    </div>
  )
}
