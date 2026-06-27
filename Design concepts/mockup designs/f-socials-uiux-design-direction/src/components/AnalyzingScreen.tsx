import { useEffect, useState } from 'react';

interface AnalyzingScreenProps {
  url: string;
  onComplete: () => void;
}

const steps = [
  { id: 1, label: 'Fetching content', detail: 'Retrieving article text and metadata' },
  { id: 2, label: 'Extracting claims', detail: 'Identifying factual, causal, predictive, and opinion statements' },
  { id: 3, label: 'Checking evidence', detail: 'Cross-referencing citations and available source material' },
  { id: 4, label: 'Detecting framing patterns', detail: 'Analyzing language, contrast, and source distribution' },
  { id: 5, label: 'Sourcing related context', detail: 'Locating independent reporting on the same topics' },
  { id: 6, label: 'Selecting bridging sources', detail: 'Matching credible, moderately divergent perspectives' },
  { id: 7, label: 'Building provenance record', detail: 'Documenting model version, policy state, and review status' },
];

export default function AnalyzingScreen({ url, onComplete }: AnalyzingScreenProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState<number[]>([]);

  useEffect(() => {
    let stepIdx = 0;
    const interval = setInterval(() => {
      if (stepIdx < steps.length) {
        setCurrentStep(stepIdx);
        if (stepIdx > 0) {
          setCompleted(prev => [...prev, stepIdx - 1]);
        }
        stepIdx++;
      } else {
        setCompleted(steps.map((_, i) => i));
        clearInterval(interval);
        setTimeout(onComplete, 700);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [onComplete]);

  const progress = Math.round(((completed.length) / steps.length) * 100);

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] opacity-[0.04]"
          style={{ background: 'radial-gradient(circle, #6ea8c4, transparent 65%)' }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 py-5 flex items-center gap-3 border-b border-white/5 bg-[#0f1117]/90 backdrop-blur-sm">
        <LensLogo />
        <span className="text-[#e2e4e9] font-semibold tracking-tight text-lg">F-Socials</span>
        <span className="tag px-2 py-0.5 rounded border border-white/10 text-zinc-600">BETA</span>
      </header>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-20">
        <div className="w-full max-w-md mx-auto space-y-10">
          {/* Progress ring + title */}
          <div className="text-center space-y-5">
            <div className="flex justify-center">
              <div className="relative w-16 h-16">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="27" stroke="#1e2330" strokeWidth="3" fill="none" />
                  <circle
                    cx="32" cy="32" r="27"
                    stroke="#6ea8c4"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 27}`}
                    strokeDashoffset={`${2 * Math.PI * 27 * (1 - progress / 100)}`}
                    style={{ transition: 'stroke-dashoffset 0.45s cubic-bezier(0.4,0,0.2,1)' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-mono font-medium text-[#6ea8c4]">{progress}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold text-[#e2e4e9] tracking-tight">
                {completed.length === steps.length ? 'Analysis complete' : 'Inspecting content…'}
              </h1>
              <div className="flex items-center justify-center gap-2 font-mono">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 flex-shrink-0">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span className="text-xs text-zinc-600 truncate max-w-xs">{url}</span>
              </div>
            </div>
          </div>

          {/* Steps */}
          <div className="rounded-xl border border-white/8 bg-[#161922]/60 overflow-hidden divide-y divide-white/5">
            {steps.map((step, i) => {
              const isDone = completed.includes(i);
              const isActive = currentStep === i && !isDone;
              return (
                <div
                  key={step.id}
                  className={`flex items-start gap-3 px-4 py-3 transition-all duration-300 ${
                    isDone ? 'opacity-40' : isActive ? 'bg-[#1a2030]' : 'opacity-20'
                  }`}
                >
                  {/* Indicator */}
                  <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 border transition-all duration-300 ${
                    isDone
                      ? 'border-teal-700/40 bg-teal-950/60'
                      : isActive
                      ? 'border-[#6ea8c4]/50 bg-[#6ea8c4]/10 scan-pulse'
                      : 'border-white/10 bg-transparent'
                  }`}>
                    {isDone ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isActive ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#6ea8c4]" />
                    ) : (
                      <span className="w-1 h-1 rounded-full bg-zinc-700" />
                    )}
                  </div>

                  {/* Text */}
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${isDone ? 'text-zinc-600' : isActive ? 'text-[#e2e4e9]' : 'text-zinc-700'}`}>
                      {step.label}
                    </p>
                    {isActive && (
                      <p className="text-xs text-zinc-500 mt-0.5 drawer-enter">{step.detail}</p>
                    )}
                  </div>

                  {/* Step num */}
                  <span className={`text-xs font-mono mt-0.5 ${isDone ? 'text-zinc-700' : isActive ? 'text-zinc-500' : 'text-zinc-800'}`}>
                    {String(step.id).padStart(2, '0')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Disclaimer */}
          <div className="flex items-start gap-3 p-4 rounded-xl border border-white/6 bg-white/[0.02]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 flex-shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="text-xs text-zinc-600 leading-relaxed">
              This analysis is AI-generated. Citations require independent verification.
              F-Socials does not render verdicts on truth or intent — it is a lens, not a judge.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LensLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-[#6ea8c4]">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <circle cx="11" cy="11" r="1" fill="currentColor" opacity="0.3" />
    </svg>
  );
}
