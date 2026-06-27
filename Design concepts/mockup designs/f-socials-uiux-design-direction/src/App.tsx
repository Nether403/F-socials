import { useState } from 'react';
import LandingPage from './components/LandingPage';
import AnalyzingScreen from './components/AnalyzingScreen';
import ReportPage from './components/ReportPage';

type AppState = 'landing' | 'analyzing' | 'report';

export default function App() {
  const [state, setState] = useState<AppState>('landing');
  const [analyzingUrl, setAnalyzingUrl] = useState('');

  const handleAnalyze = (url: string) => {
    setAnalyzingUrl(url);
    setState('analyzing');
  };

  const handleAnalysisComplete = () => {
    setState('report');
  };

  const handleNewAnalysis = () => {
    setState('landing');
    setAnalyzingUrl('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (state === 'landing') {
    return <LandingPage onAnalyze={handleAnalyze} />;
  }

  if (state === 'analyzing') {
    return <AnalyzingScreen url={analyzingUrl} onComplete={handleAnalysisComplete} />;
  }

  return <ReportPage onNewAnalysis={handleNewAnalysis} />;
}
