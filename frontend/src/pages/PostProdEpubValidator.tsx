import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CloudUpload,
  FileArchive,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Loader2,
  BookOpen,
  Plus,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { useEpubBookStore } from '@/hooks/useEpubBookStore';
import { BookCard, cardVariants } from '@/components/epub_validator/BookCard';
import { uploadFile, getFiles, resolveFolderName } from '@/api/epubValidator';
import { useToast } from '@/components/ui/useToast';
import { formatFileSize } from '@/utils/epubValidatorUtils';
import type { UploadStage } from '@/types/epubValidator';

const ACCEPTED = ['.epub', '.zip'];

function isValidFile(f: File) {
  const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
  return ACCEPTED.includes(ext);
}

interface StepProps {
  label: string;
  done: boolean;
  active: boolean;
}

function Step({ label, done, active }: StepProps) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
          done ? 'bg-emerald-500' : active ? 'bg-primary animate-pulse' : 'bg-muted'
        }`}
      >
        {done ? (
          <CheckCircle2 className="w-4 h-4 text-white" />
        ) : active ? (
          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />
        )}
      </div>
      <span
        className={`text-sm font-medium transition-colors ${
          done ? 'text-emerald-600' : active ? 'text-foreground' : 'text-muted-foreground'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

export function PostProdEpubValidator() {
  const navigate = useNavigate();
  const { books, upsertBook } = useEpubBookStore();
  const { addToast } = useToast();

  const [showUpload, setShowUpload] = useState(false);
  const [stage, setStage] = useState<UploadStage>('idle');
  const [uploadPct, setUploadPct] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!isValidFile(file)) {
        setErrorMsg(`"${file.name}" is not supported. Please use .epub or .zip files.`);
        setStage('failed');
        return;
      }
      setSelectedFile(file);
      setErrorMsg(null);
      setUploadPct(0);
      setStage('uploading');

      try {
        const response = await uploadFile(file, (pct) => {
          setUploadPct(pct);
          if (pct >= 100) setStage('extracting');
        });

        if (!response.status) {
          throw new Error(response.message || 'Upload failed');
        }

        const folderName = resolveFolderName(response, file);

        let totalFiles = 0;
        try {
          const filesData = await getFiles(folderName);
          if (filesData.status && filesData.total_files != null) {
            totalFiles = filesData.total_files;
          }
        } catch {
          // non-critical, continue
        }

        upsertBook({
          folder_name: folderName,
          epub_path: response.epub_path ?? response.epub_extract_path ?? '',
          uploaded_at: new Date().toISOString(),
          total_files: totalFiles,
        });

        setStage('completed');
        addToast({
          title: 'EPUB Extracted',
          description: `Successfully loaded ${folderName} for validation.`,
          variant: 'success',
        });
        setTimeout(() => {
          setStage('idle');
          setSelectedFile(null);
          setShowUpload(false);
          navigate(`/post-production/epub-validator/${folderName}`);
        }, 1400);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
        setErrorMsg(msg);
        setStage('failed');
        addToast({
          title: 'Upload failed',
          description: msg,
          variant: 'error',
        });
      }
    },
    [navigate, upsertBook, addToast],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setStage('idle');
      const f = e.dataTransfer.files[0];
      if (f) processFile(f);
    },
    [processFile],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (stage === 'idle') setStage('dragging');
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (stage === 'dragging') setStage('idle');
  };
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  };

  const isIdle = stage === 'idle' || stage === 'dragging';
  const dragging = stage === 'dragging';
  const failed = stage === 'failed';
  const uploading = stage === 'uploading';
  const extracting = stage === 'extracting';
  const completed = stage === 'completed';
  const busy = uploading || extracting || completed;

  return (
    <motion.div
      className="space-y-6 max-w-7xl mx-auto p-6 text-text"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22 }}
    >
      {/* Sticky header */}
      <div className="border-b border-border/60 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/post-production')}
            className="shrink-0 h-9 w-9 p-0 rounded-lg"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold font-serif text-text tracking-tight m-0">EPUB Validator</h1>
            <p className="text-xs text-muted mt-1 leading-none">
              Verify markup, stylesheet rules, heading sequences, links, and layout parity.
            </p>
          </div>
        </div>

        {books.length > 0 && (
          <Button
            onClick={() => setShowUpload(!showUpload)}
            className="gap-2 shadow-sm text-xs font-semibold py-1.5 h-9"
          >
            {showUpload ? (
              <>
                <ChevronUp className="w-4 h-4" /> Hide Upload
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" /> Add Validation Job
              </>
            )}
          </Button>
        )}
      </div>

      {/* Upload Zone (Collapsible if books exist, otherwise full size) */}
      <AnimatePresence>
        {(books.length === 0 || showUpload) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="w-full max-w-2xl mx-auto p-4 border border-border/60 bg-muted/20 rounded-2xl mb-4">
              <AnimatePresence mode="wait">
                {isIdle || failed ? (
                  <motion.div
                    key="dropzone"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onClick={() => {
                      if (!failed) inputRef.current?.click();
                    }}
                    className={`relative rounded-xl border-2 border-dashed cursor-pointer transition-colors duration-200 flex flex-col items-center justify-center gap-4 py-10 px-6 text-center ${
                      dragging
                        ? 'border-primary bg-primary/5'
                        : failed
                        ? 'border-danger/40 bg-danger/5'
                        : 'border-border bg-card hover:border-primary/50 hover:bg-primary/[0.01]'
                    }`}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept={ACCEPTED.join(',')}
                      className="sr-only"
                      onChange={onInputChange}
                    />

                    <motion.div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        dragging ? 'bg-primary/15' : failed ? 'bg-danger/10' : 'bg-muted/60'
                      }`}
                      animate={dragging ? { y: -4, rotate: -3 } : { y: 0, rotate: 0 }}
                    >
                      {failed ? (
                        <XCircle className="w-6 h-6 text-danger" />
                      ) : (
                        <CloudUpload
                          className={`w-6 h-6 ${dragging ? 'text-primary' : 'text-muted-foreground'}`}
                        />
                      )}
                    </motion.div>

                    <div>
                      <p className="text-sm font-semibold text-text mb-1">
                        {failed
                          ? 'Upload failed'
                          : dragging
                          ? 'Release to upload'
                          : 'Drag & drop EPUB or ZIP book packages'}
                      </p>
                      <p className="text-xs text-muted font-sans leading-normal">
                        {failed
                          ? errorMsg ?? 'Something went wrong.'
                          : 'or click to browse local files — accepts .zip and .epub'}
                      </p>
                    </div>

                    {failed ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setStage('idle');
                          setErrorMsg(null);
                        }}
                        className="text-xs"
                      >
                        Try again
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          inputRef.current?.click();
                        }}
                        className="text-xs font-semibold h-8"
                      >
                        Select file
                      </Button>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="progress"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="bg-card rounded-xl border border-border shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center gap-3.5 px-5 py-4 border-b border-border/60">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileArchive className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-text truncate">
                          {selectedFile?.name ?? ''}
                        </p>
                        <p className="text-[10px] text-muted font-sans mt-0.5">
                          {selectedFile ? formatFileSize(selectedFile.size) : ''}
                        </p>
                      </div>
                      {completed && <CheckCircle2 className="w-5 h-5 text-success-600 flex-shrink-0" />}
                    </div>

                    {(uploading || extracting) && (
                      <div className="px-5 py-4 border-b border-border/40">
                        <ProgressBar
                          value={extracting ? 100 : uploadPct}
                          color="gold"
                          label={uploading ? 'Uploading package…' : 'Extracting structure…'}
                          showValue={uploading}
                          size="sm"
                        />
                      </div>
                    )}

                    <div className="px-5 py-4 space-y-2.5">
                      <Step label="Uploading file" done={extracting || completed} active={uploading} />
                      <Step label="Extracting book hierarchy" done={completed} active={extracting} />
                      <Step
                        label={completed ? 'Extraction complete — loading workspace…' : 'Validation ready'}
                        done={false}
                        active={completed}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Books grid */}
      <div className="space-y-4">
        {books.length > 0 && (
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <h2 className="text-base font-bold font-serif text-text m-0">Recent Validation Jobs</h2>
            <span className="text-[11px] font-semibold tracking-wider font-mono text-muted">
              {books.length} BOOK{books.length !== 1 ? 'S' : ''} REGISTERED
            </span>
          </div>
        )}

        {books.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No validation jobs yet"
            description="Upload a zipped book package (containing the EPUB files and layout PDF) to run local semantic checks."
            action={
              <Button onClick={() => setShowUpload(true)} className="gap-2 shadow-sm font-semibold text-xs">
                <Plus className="w-4 h-4" /> Add first job
              </Button>
            }
          />
        ) : (
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            variants={containerVariants}
            initial="hidden"
            animate="show"
          >
            {books.map((book, i) => (
              <motion.div key={book.folder_name} variants={cardVariants} custom={i}>
                <BookCard book={book} index={i} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
