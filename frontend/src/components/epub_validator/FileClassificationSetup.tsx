import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getFileMappings, saveFileMappings } from '@/api/epubValidator';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { AlertCircle, CheckCircle2, Save, XCircle } from 'lucide-react';
import { toast } from '@/store/useToastStore';
import { motion } from 'framer-motion';

export interface XHTMLFileBasics {
  file_name: string;
}

interface FileClassificationSetupProps {
  folderName: string;
  xhtmlFiles: XHTMLFileBasics[];
  onComplete: () => void;
}

const CATEGORIES = ["Front Matter", "Chapters", "Back Matter", "Not found"] as const;
type Category = typeof CATEGORIES[number];

export function FileClassificationSetup({ folderName, xhtmlFiles, onComplete }: FileClassificationSetupProps) {
  const [mappings, setMappings] = useState<Record<string, Category>>({});
  
  const { data: initialMappings, isLoading, isError } = useQuery({
    queryKey: ['epub-file-mappings', folderName],
    queryFn: () => getFileMappings(folderName),
    enabled: !!folderName,
    staleTime: 0,
  });

  useEffect(() => {
    if (initialMappings) {
      // Map initial backend values to our Category type
      const nextMappings: Record<string, Category> = {};
      for (const file of xhtmlFiles) {
        const cat = initialMappings[file.file_name];
        if (cat === "Front Matter" || cat === "Chapters" || cat === "Back Matter") {
          nextMappings[file.file_name] = cat;
        } else {
          nextMappings[file.file_name] = "Not found";
        }
      }
      setMappings(nextMappings);
    }
  }, [initialMappings, xhtmlFiles]);

  const saveMutation = useMutation({
    mutationFn: (newMappings: Record<string, string>) => saveFileMappings(folderName, newMappings),
    onSuccess: () => {
      toast.success('File classification saved successfully.');
      onComplete();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save classifications.');
    }
  });

  const handleCategoryChange = (fileName: string, category: Category) => {
    setMappings(prev => ({
      ...prev,
      [fileName]: category
    }));
  };

  const handleSave = () => {
    const unmapped = Object.values(mappings).filter(c => c === 'Not found');
    if (unmapped.length > 0) {
      toast.error(`Please map all files. ${unmapped.length} files are still "Not found".`);
      return;
    }
    saveMutation.mutate(mappings);
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-destructive">
        <AlertCircle className="mb-2 h-10 w-10" />
        <p>Failed to load initial file classifications.</p>
      </div>
    );
  }

  const unmappedCount = Object.values(mappings).filter(c => c === 'Not found').length;
  const isReadyToSave = unmappedCount === 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-6xl mx-auto h-full flex flex-col font-sans pb-4"
    >
      <Card className="border-border/60 shadow-md bg-card flex flex-col flex-1 min-h-0">
        <CardHeader className="border-b border-border/40 pb-5 shrink-0">
          <CardTitle className="text-xl font-serif text-foreground">File Classification Mapping</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Please verify the auto-classification of your XHTML files. Ensure every file is assigned to a valid category before saving.
          </p>
        </CardHeader>
        <CardBody className="p-0 flex flex-col flex-1 min-h-0">
          
          <div className="flex items-center justify-between p-4 bg-muted/30 border-b border-border/40 shrink-0">
            <div className="flex items-center gap-3">
              {isReadyToSave ? (
                <div className="bg-emerald-500/10 p-2 rounded-full">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                </div>
              ) : (
                <div className="bg-amber-500/10 p-2 rounded-full">
                  <AlertCircle className="h-5 w-5 text-amber-500" />
                </div>
              )}
              <div>
                <p className="font-semibold text-sm">
                  {isReadyToSave ? 'Ready to Save' : 'Action Required'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isReadyToSave 
                    ? 'All files mapped successfully.' 
                    : `${unmappedCount} file(s) currently marked as "Not found".`}
                </p>
              </div>
            </div>
            <Button 
              onClick={handleSave} 
              disabled={!isReadyToSave || saveMutation.isPending}
              className="px-5 py-2"
            >
              <div className="flex flex-row items-center justify-center gap-2 whitespace-nowrap">
                {saveMutation.isPending ? (
                  <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  <Save className="h-4 w-4 shrink-0" />
                )}
                <span>Save</span>
              </div>
            </Button>
          </div>

          <div className="flex flex-col flex-1 min-h-0">
            <div className="grid grid-cols-12 bg-muted/40 p-3 px-6 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/50 shrink-0">
              <div className="col-span-8">File Name</div>
              <div className="col-span-4">Assigned Category</div>
            </div>
            <div className="max-h-[calc(100vh-350px)] overflow-y-auto divide-y divide-border/40">
              {xhtmlFiles.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  No XHTML files found to classify.
                </div>
              ) : (
                xhtmlFiles.map(file => {
                  const currentCategory = mappings[file.file_name] || 'Not found';
                  const isNotFound = currentCategory === 'Not found';
                  
                  return (
                    <div 
                      key={file.file_name} 
                      className={`grid grid-cols-12 items-center p-3 px-6 transition-all duration-200 ${isNotFound ? 'bg-amber-500-[0.02] hover:bg-amber-500/5' : 'hover:bg-muted/30'}`}
                    >
                      <div className="col-span-8 flex items-center gap-3 pr-6">
                        {isNotFound ? (
                          <XCircle className="h-4 w-4 text-amber-500 shrink-0" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 opacity-80" />
                        )}
                        <span className="font-mono text-xs font-medium truncate text-foreground/80" title={file.file_name}>
                          {file.file_name}
                        </span>
                      </div>
                      <div className="col-span-4">
                        <select
                          className={`w-full text-xs font-semibold rounded-lg border py-1.5 px-3 transition-colors shadow-sm outline-none ${
                            isNotFound 
                              ? 'bg-amber-500/5 border-amber-200 text-amber-700 dark:border-amber-500/30 dark:text-amber-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-500/20' 
                              : 'bg-card border-border text-foreground hover:border-primary/40 focus:border-primary focus:ring-2 focus:ring-primary/20'
                          }`}
                          value={currentCategory}
                          onChange={(e) => handleCategoryChange(file.file_name, e.target.value as Category)}
                        >
                          {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </CardBody>
      </Card>
    </motion.div>
  );
}
