import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useStore } from '@/store/useSlideFormatterStore';
import { Step1Template } from '@/components/slide_formatter/Step1Template';
import { Step2Upload } from '@/components/slide_formatter/Step2Upload';
import { Step3Figures } from '@/components/slide_formatter/Step3Figures';
import { Step4Mapping } from '@/components/slide_formatter/Step4Mapping';
import { Step5Export } from '@/components/slide_formatter/Step5Export';

const steps = [
  { number: 1, label: 'Template Master' },
  { number: 2, label: 'Upload Content' },
  { number: 3, label: 'PDF Figures' },
  { number: 4, label: 'Review Presentation' },
  { number: 5, label: 'Export Deck' },
];

export function PostProdSlideFormatter() {
  const navigate = useNavigate();
  const { step, setStep, selectedTemplate, inputPptName, sourcePdfName } = useStore();

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
            <h1 className="text-2xl font-bold font-serif text-text tracking-tight m-0">SlideFormatter</h1>
            <p className="text-xs text-muted mt-1 leading-none">
              Format, style, and structure slide decks using automated layouts and template compliance checks.
            </p>
          </div>
        </div>

        {/* Compact horizontal stepper */}
        <div className="hidden md:flex items-center space-x-3 bg-surface/50 border border-border p-1.5 px-3 rounded-xl shadow-sm">
          {steps.map((s, index) => {
            const isCompleted = step > s.number;
            const isActive = step === s.number;

            return (
              <React.Fragment key={s.number}>
                <div
                  onClick={() => {
                    if (s.number === 1) setStep(1);
                    else if (s.number === 2 && selectedTemplate) setStep(2);
                    else if (s.number === 3 && selectedTemplate && inputPptName && sourcePdfName) setStep(3);
                    else if (s.number === 4 && selectedTemplate && inputPptName && sourcePdfName) setStep(4);
                    else if (s.number === 5 && selectedTemplate && inputPptName && sourcePdfName) setStep(5);
                  }}
                  className="flex items-center space-x-1.5 cursor-pointer select-none group transition-all"
                >
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all ${
                      isCompleted
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : isActive
                        ? 'bg-primary border-primary text-white ring-2 ring-primary/10'
                        : 'bg-white border-border text-muted-foreground group-hover:border-primary group-hover:text-primary'
                    }`}
                  >
                    {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-white" /> : s.number}
                  </div>
                  <span
                    className={`text-[10px] font-bold tracking-tight uppercase ${
                      isActive
                        ? 'text-text'
                        : 'text-muted-foreground group-hover:text-text'
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={`w-6 h-[1px] ${isCompleted ? 'bg-emerald-500' : 'bg-border'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Main Workspace viewport */}
      <div className="min-h-[500px]">
        {step === 1 && <Step1Template />}
        {step === 2 && <Step2Upload />}
        {step === 3 && <Step3Figures />}
        {step === 4 && <Step4Mapping />}
        {step === 5 && <Step5Export />}
      </div>
    </motion.div>
  );
}
