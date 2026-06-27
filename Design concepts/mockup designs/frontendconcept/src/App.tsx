import React, { useState, useEffect } from 'react';
import { 
  Search, FileText, Sliders, AlertTriangle, AlertOctagon, HelpCircle, 
  ShieldCheck, Home, ChevronDown, ExternalLink, Moon, Sun, 
  ArrowLeft, PenTool, X, Eye, FileSpreadsheet
} from 'lucide-react';
import { initialReports, initialDisputes } from './mockData';
import type { AnalysisReport, Claim, Dispute } from './mockData';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'warning' | 'info' | 'error';
}

export default function App() {
  // Theme & Navigation
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [activeWorkspace, setActiveWorkspace] = useState<'consumer' | 'expert'>('consumer');
  
  // Database States (Mock)
  const [reports, setReports] = useState<AnalysisReport[]>(initialReports);
  const [disputes, setDisputes] = useState<Dispute[]>(initialDisputes);
  
  // View states
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [targetReportId, setTargetReportId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [activeTab, setActiveTab] = useState<'claims' | 'framing' | 'context' | 'perspectives'>('claims');
  
  // Interaction states
  const [expandedClaims, setExpandedClaims] = useState<Record<string, boolean>>({});
  const [activeFramingId, setActiveFramingId] = useState<string | null>(null);
  const [perspectiveFilter, setPerspectiveFilter] = useState<string>('all');
  const [disputeModalOpen, setDisputeModalOpen] = useState(false);
  const [disputeClaim, setDisputeClaim] = useState<Claim | null>(null);
  const [disputeExplanation, setDisputeExplanation] = useState('');
  const [disputeSourceUrl, setDisputeSourceUrl] = useState('');
  
  // Expert Workspace states
  const [selectedDisputeId, setSelectedDisputeId] = useState<string | null>('disp-1');
  const [expertEvidenceStrength, setExpertEvidenceStrength] = useState<Claim['evidenceStrength']>('supported');
  const [expertEvidenceDesc, setExpertEvidenceDesc] = useState('');
  const [expertChangelog, setExpertChangelog] = useState('');
  
  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Apply Theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light-theme');
    } else {
      root.classList.remove('light-theme');
    }
  }, [theme]);

  // Loading Steps Timer
  useEffect(() => {
    let interval: any;
    if (isAnalyzing) {
      interval = setInterval(() => {
        setAnalysisStep((prev) => {
          if (prev >= 4) {
            clearInterval(interval);
            setTimeout(() => {
              setIsAnalyzing(false);
              if (targetReportId) {
                setActiveReportId(targetReportId);
              }
              addToast('Analysis completed. Media-Literacy Report generated.', 'success');
            }, 500);
            return 4;
          }
          return prev + 1;
        });
      }, 700);
    }
    return () => clearInterval(interval);
  }, [isAnalyzing, targetReportId]);

  // Toast Helper
  const addToast = (message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const handleAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) {
      addToast('Please enter a valid link or transcript.', 'error');
      return;
    }
    const lowerUrl = urlInput.toLowerCase();
    let targetId = 'energy-subsidy';
    if (lowerUrl.includes('mining') || lowerUrl.includes('youtube')) {
      targetId = 'mining-video';
    } else if (lowerUrl.includes('transit') || lowerUrl.includes('medium')) {
      targetId = 'transit-article';
    }
    setTargetReportId(targetId);
    setAnalysisStep(0);
    setIsAnalyzing(true);
  };

  const handleSelectMockReport = (id: string) => {
    const report = reports.find(r => r.id === id);
    if (report) {
      setUrlInput(report.sourceUrl || 'Pasted transcript: ' + report.title);
      setTargetReportId(id);
      setAnalysisStep(0);
      setIsAnalyzing(true);
    }
  };

  const toggleClaimExpand = (claimId: string) => {
    setExpandedClaims(prev => ({
      ...prev,
      [claimId]: !prev[claimId]
    }));
  };

  const handleOpenDispute = (claim: Claim) => {
    setDisputeClaim(claim);
    setDisputeExplanation('');
    setDisputeSourceUrl('');
    setDisputeModalOpen(true);
  };

  const handleSubmitDispute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!disputeClaim || !activeReportId) return;

    if (!disputeSourceUrl.trim()) {
      addToast('A valid verification source URL is required.', 'error');
      return;
    }
    if (disputeExplanation.trim().length < 20) {
      addToast('Please provide a detailed explanation (min. 20 characters).', 'error');
      return;
    }

    const newDispute: Dispute = {
      id: 'disp-' + Math.random().toString(36).substring(2, 9),
      reportId: activeReportId,
      claimId: disputeClaim.id,
      claimNumber: disputeClaim.number,
      claimText: disputeClaim.text,
      sourceUrl: disputeSourceUrl,
      explanation: disputeExplanation,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    setDisputes(prev => [newDispute, ...prev]);

    // Update Report State to "under-dispute" status
    setReports(prevReports => prevReports.map(report => {
      if (report.id === activeReportId) {
        return {
          ...report,
          provenance: {
            ...report.provenance,
            reviewStatus: 'under-dispute',
            disputesCount: report.provenance.disputesCount + 1
          }
        };
      }
      return report;
    }));

    setDisputeModalOpen(false);
    addToast(`Dispute logged for Claim #${disputeClaim.number}. Sent to Expert Review Queue.`, 'warning');
  };

  // Expert workspace operations
  const activeReport = reports.find(r => r.id === activeReportId);
  const activeDispute = disputes.find(d => d.id === selectedDisputeId);

  useEffect(() => {
    if (activeDispute) {
      // Find the corresponding claim
      const targetReport = reports.find(r => r.id === activeDispute.reportId);
      const targetClaim = targetReport?.claims.find(c => c.id === activeDispute.claimId);
      if (targetClaim) {
        setExpertEvidenceStrength(targetClaim.evidenceStrength);
        setExpertEvidenceDesc(targetClaim.evidenceDescription);
      }
      setExpertChangelog('');
    }
  }, [selectedDisputeId, activeDispute, reports]);

  const handlePublishExpertChanges = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDispute) return;

    if (expertChangelog.trim().length < 10) {
      addToast('A public changelog explanation is required.', 'error');
      return;
    }

    // 1. Update the claim evidence status and description
    setReports(prevReports => prevReports.map(report => {
      if (report.id === activeDispute.reportId) {
        const updatedClaims = report.claims.map(claim => {
          if (claim.id === activeDispute.claimId) {
            return {
              ...claim,
              evidenceStrength: expertEvidenceStrength,
              evidenceDescription: expertEvidenceDesc
            };
          }
          return claim;
        });

        return {
          ...report,
          claims: updatedClaims,
          provenance: {
            ...report.provenance,
            reviewStatus: 'expert-reviewed',
            lastUpdated: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          }
        };
      }
      return report;
    }));

    // 2. Resolve the dispute status
    setDisputes(prev => prev.map(disp => {
      if (disp.id === activeDispute.id) {
        return { ...disp, status: 'resolved' };
      }
      return disp;
    }));

    addToast(`Expert edits published. Changelog entry logged.`, 'success');
  };

  // Helper for rendering transcript text with interactive highlights
  const renderHighlightedTranscript = (report: AnalysisReport) => {
    const text = report.transcript;
    const activeSignal = report.framingSignals.find(s => s.id === activeFramingId);
    
    if (!activeSignal) return <p>{text}</p>;

    // We sort examples by start index to slice properly
    const sortedExamples = [...activeSignal.examples].sort((a, b) => a.startIndex - b.startIndex);
    
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;

    sortedExamples.forEach((ex, idx) => {
      // Append text before highlight
      if (ex.startIndex > lastIndex) {
        elements.push(text.substring(lastIndex, ex.startIndex));
      }
      
      // Append highlighted text
      elements.push(
        <span 
          key={idx} 
          className="transcript-highlight" 
          title={ex.explanation}
        >
          {text.substring(ex.startIndex, ex.endIndex)}
          <span className="tooltip-bubble">{ex.explanation}</span>
        </span>
      );
      
      lastIndex = ex.endIndex;
    });

    if (lastIndex < text.length) {
      elements.push(text.substring(lastIndex));
    }

    return <p>{elements}</p>;
  };

  return (
    <div className="app-container">
      {/* Toast Manager */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span className="toast-message">{toast.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}>
              <X size={16} className="modal-close-btn" />
            </button>
          </div>
        ))}
      </div>

      {/* Fixed Left Sidebar */}
      <aside className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">f</div>
          <span className="logo-text">f-Socials</span>
        </div>

        <nav className="nav-links">
          <button 
            onClick={() => { setActiveWorkspace('consumer'); setActiveReportId(null); }} 
            className={`nav-link ${activeWorkspace === 'consumer' && !activeReportId ? 'active' : ''}`}
          >
            <Home size={18} />
            <span>Home Lens</span>
          </button>
          {activeReportId && activeWorkspace === 'consumer' && (
            <button className="nav-link active">
              <Eye size={18} />
              <span>Report Analysis</span>
            </button>
          )}
          <button 
            onClick={() => setActiveWorkspace('expert')} 
            className={`nav-link ${activeWorkspace === 'expert' ? 'active' : ''}`}
          >
            <PenTool size={18} />
            <span>Expert Queue</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="workspace-badge">
            <span>{activeWorkspace === 'consumer' ? 'CONSUMER LENS' : 'EXPERT DESK'}</span>
            <Sliders size={12} />
          </div>
          
          <button 
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="nav-link"
            style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px', borderRadius: 0 }}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="main-content">
        <header className="topbar">
          <h2 style={{ fontSize: 'var(--text-h2)', fontWeight: 'var(--font-weight-bold)' }}>
            {activeWorkspace === 'consumer' ? 'Media Context Lens' : 'Expert Verification Workspace'}
          </h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            {activeWorkspace === 'consumer' ? (
              <button 
                onClick={() => setActiveWorkspace('expert')} 
                className="provenance-btn primary"
                style={{ fontSize: 'var(--text-caption)' }}
              >
                <Sliders size={14} />
                <span>Switch to Expert Workspace</span>
              </button>
            ) : (
              <button 
                onClick={() => setActiveWorkspace('consumer')} 
                className="provenance-btn primary"
                style={{ fontSize: 'var(--text-caption)' }}
              >
                <Eye size={14} />
                <span>Switch to Consumer View</span>
              </button>
            )}
          </div>
        </header>

        {/* -------------------- CONSUMER WORKSPACE -------------------- */}
        {activeWorkspace === 'consumer' && (
          <>
            {/* Loading / Pipeline State */}
            {isAnalyzing && (
              <div className="loading-panel">
                <div className="loader-animation"></div>
                <h3 className="loading-title">Analyzing Media Construction</h3>
                <div className="pipeline-steps">
                  <div className={`pipeline-step ${analysisStep === 0 ? 'active' : ''} ${analysisStep > 0 ? 'completed' : ''}`}>
                    <div className="step-indicator">1</div>
                    <span className="step-label">Acquiring source transcript & content media...</span>
                  </div>
                  <div className={`pipeline-step ${analysisStep === 1 ? 'active' : ''} ${analysisStep > 1 ? 'completed' : ''}`}>
                    <div className="step-indicator">2</div>
                    <span className="step-label">Extracting primary assertions & claims...</span>
                  </div>
                  <div className={`pipeline-step ${analysisStep === 2 ? 'active' : ''} ${analysisStep > 2 ? 'completed' : ''}`}>
                    <div className="step-indicator">3</div>
                    <span className="step-label">Cross-referencing evidence against database...</span>
                  </div>
                  <div className={`pipeline-step ${analysisStep === 3 ? 'active' : ''} ${analysisStep > 3 ? 'completed' : ''}`}>
                    <div className="step-indicator">4</div>
                    <span className="step-label">Evaluating framing styles & structural angles...</span>
                  </div>
                  <div className={`pipeline-step ${analysisStep === 4 ? 'active' : ''}`}>
                    <div className="step-indicator">5</div>
                    <span className="step-label">Assembling media-literacy report card...</span>
                  </div>
                </div>
              </div>
            )}

            {/* Input Submission State */}
            {!isAnalyzing && !activeReportId && (
              <div className="home-panel">
                <h1 className="hero-title">Inspect before you react.</h1>
                <p className="hero-subtitle">
                  Paste a link to view claims, manipulation markers, and credible context. We show how it is built, so you can decide what is true.
                </p>

                <form onSubmit={handleAnalyze} className="input-container-glass">
                  <div className="url-input-wrapper">
                    <Search size={20} style={{ color: 'var(--text-muted)' }} />
                    <input 
                      type="text" 
                      id="url-input"
                      name="url-input"
                      placeholder="Paste YouTube link, article URL, or transcript..."
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      className="url-input"
                    />
                    <button type="submit" className="analyze-btn">
                      <span>Analyze</span>
                    </button>
                  </div>
                </form>

                <div className="suggestion-section">
                  <h4 className="suggestion-title">Or test with pre-analyzed examples</h4>
                  <div className="suggestion-grid">
                    {reports.map((report) => (
                      <button 
                        key={report.id}
                        onClick={() => handleSelectMockReport(report.id)}
                        className="suggestion-card"
                      >
                        <div className="suggestion-platform">
                          <FileText size={14} />
                          <span>{report.platform}</span>
                        </div>
                        <span className="suggestion-name">{report.title}</span>
                        <p className="suggestion-desc">{report.tldr}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Report Dashboard Screen */}
            {!isAnalyzing && activeReportId && activeReport && (
              <div className="report-panel">
                {/* Left Column: Media metadata card */}
                <div className="report-sidebar">
                  <button onClick={() => setActiveReportId(null)} className="report-back-btn">
                    <ArrowLeft size={16} />
                    <span>Analyze another URL</span>
                  </button>

                  <div className="media-thumbnail-card">
                    <img 
                      src={activeReport.thumbnailUrl} 
                      alt={activeReport.title} 
                      className="media-thumbnail-img"
                    />
                    <div className="media-info-body">
                      <span className="media-platform-badge">{activeReport.platform}</span>
                      <h3 className="media-title">{activeReport.title}</h3>
                      <div className="media-metadata-row">
                        <span>Creator: <strong>{activeReport.creator}</strong></span>
                        {activeReport.durationOrLength && <span>Length: {activeReport.durationOrLength}</span>}
                        <span>Analyzed: {activeReport.publishDate}</span>
                      </div>
                    </div>
                  </div>

                  <div className="onboarding-card">
                    <div className="onboarding-text">
                      <span className="onboarding-title">How to read this lens</span>
                      <p className="onboarding-desc">
                        f-Socials separates assertions into individual cards. We evaluate evidence strength and note rhetorical framing. Citing sources is our rule; we never label articles as simply true or false.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right Column: Dynamic Analysis Report Card */}
                <div className="report-dashboard">
                  <div className="tldr-card">
                    <div className="section-label">Summary</div>
                    <p className="tldr-text">{activeReport.tldr}</p>
                  </div>

                  <nav className="tab-navigation">
                    <button 
                      onClick={() => setActiveTab('claims')} 
                      className={`tab-btn ${activeTab === 'claims' ? 'active' : ''}`}
                    >
                      Claim Ledger ({activeReport.claims.length})
                    </button>
                    <button 
                      onClick={() => setActiveTab('framing')} 
                      className={`tab-btn ${activeTab === 'framing' ? 'active' : ''}`}
                    >
                      Framing Signals ({activeReport.framingSignals.length})
                    </button>
                    <button 
                      onClick={() => setActiveTab('context')} 
                      className={`tab-btn ${activeTab === 'context' ? 'active' : ''}`}
                    >
                      Useful Context ({activeReport.contextCards.length})
                    </button>
                    <button 
                      onClick={() => setActiveTab('perspectives')} 
                      className={`tab-btn ${activeTab === 'perspectives' ? 'active' : ''}`}
                    >
                      Bridging Perspectives ({activeReport.bridgingPerspectives.length})
                    </button>
                  </nav>

                  <div className="tab-content">
                    {/* CLAIMS LEDGER */}
                    {activeTab === 'claims' && (
                      <div className="claim-list">
                        {activeReport.claims.map((claim) => (
                          <div 
                            key={claim.id} 
                            className={`claim-card ${expandedClaims[claim.id] ? 'expanded' : ''}`}
                          >
                            <div 
                              onClick={() => toggleClaimExpand(claim.id)} 
                              className="claim-card-header"
                            >
                              <div className="claim-number-badge">{claim.number}</div>
                              <div className="claim-header-text-container">
                                <span className="claim-title-text">{claim.text}</span>
                                <div className="badge-row">
                                  <span className={`badge-pill ${claim.evidenceStrength}`}>
                                    {claim.evidenceStrength === 'supported' && <ShieldCheck size={12} />}
                                    {claim.evidenceStrength === 'mixed' && <AlertTriangle size={12} />}
                                    {claim.evidenceStrength === 'weak' && <AlertOctagon size={12} />}
                                    {claim.evidenceStrength === 'insufficient' && <HelpCircle size={12} />}
                                    <span style={{ textTransform: 'capitalize' }}>
                                      {claim.evidenceStrength} Evidence
                                    </span>
                                  </span>
                                  {activeReport.provenance.reviewStatus === 'under-dispute' && (
                                    <span className="badge-pill under-dispute">
                                      <AlertTriangle size={12} />
                                      <span>Disputed</span>
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ChevronDown className="claim-expand-arrow" size={20} />
                            </div>

                            {expandedClaims[claim.id] && (
                              <div className="claim-drawer">
                                <div className="original-quote-box">
                                  <span className="drawer-subtitle">Direct Quote</span>
                                  <p style={{ marginTop: '8px' }}>"{claim.quote}"</p>
                                </div>

                                <div>
                                  <span className="drawer-subtitle">Evidence Review</span>
                                  <p className="drawer-description" style={{ marginTop: '8px' }}>
                                    {claim.evidenceDescription}
                                  </p>
                                </div>

                                {claim.citations.length > 0 && (
                                  <div>
                                    <span className="drawer-subtitle">Verification Sources</span>
                                    <div className="citation-list" style={{ marginTop: '12px' }}>
                                      {claim.citations.map((citation) => (
                                        <a 
                                          key={citation.id} 
                                          href={citation.url} 
                                          target="_blank" 
                                          rel="noopener noreferrer"
                                          className="citation-chip"
                                        >
                                          <div className="citation-info">
                                            <div className="citation-title-row">
                                              <span className="citation-title">{citation.title}</span>
                                              <span className={`citation-tier-badge tier-${citation.tier}`}>
                                                Tier {citation.tier} Source
                                              </span>
                                            </div>
                                            <span className="citation-source">{citation.sourceName}</span>
                                          </div>
                                          <ExternalLink size={16} style={{ color: 'var(--accent-color)' }} />
                                        </a>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                <div className="claim-actions">
                                  <button 
                                    onClick={() => handleOpenDispute(claim)}
                                    className="dispute-claim-btn"
                                  >
                                    <AlertTriangle size={14} />
                                    <span>Dispute Evidence Assessment</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* FRAMING SIGNALS */}
                    {activeTab === 'framing' && (
                      <div className="framing-layout">
                        <div className="framing-signals-list">
                          <h4 className="suggestion-title">Rhetorical framing techniques</h4>
                          {activeReport.framingSignals.map((signal) => (
                            <div 
                              key={signal.id} 
                              onClick={() => setActiveFramingId(activeFramingId === signal.id ? null : signal.id)}
                              className={`framing-card ${activeFramingId === signal.id ? 'active' : ''}`}
                            >
                              <div className="framing-title-row">
                                <span className="framing-title">{signal.type}</span>
                                <span className={`severity-badge ${signal.severity}`}>
                                  {signal.severity} severity
                                </span>
                              </div>
                              <p className="framing-desc">{signal.description}</p>
                              
                              {activeFramingId === signal.id && (
                                <div className="framing-examples-container">
                                  <span className="drawer-subtitle">Identified Snippets</span>
                                  {signal.examples.map((ex, i) => (
                                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                                      <p className="framing-example-quote">"{ex.text}"</p>
                                      <p className="framing-example-expl">{ex.explanation}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Interactive Transcript Pane */}
                        <div className="transcript-viewer-card">
                          <span className="suggestion-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Interactive Transcript</span>
                            {activeFramingId && (
                              <button 
                                onClick={() => setActiveFramingId(null)}
                                style={{ color: 'var(--accent-color)', fontSize: '11px' }}
                              >
                                Clear Highlight
                              </button>
                            )}
                          </span>
                          <div className="transcript-content">
                            {renderHighlightedTranscript(activeReport)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* USEFUL CONTEXT */}
                    {activeTab === 'context' && (
                      <div className="context-grid">
                        {activeReport.contextCards.map((card) => (
                          <div key={card.id} className="context-card">
                            <div>
                              <h4 className="context-card-title">{card.title}</h4>
                              <p className="context-card-desc">{card.description}</p>
                            </div>
                            <a 
                              href={card.sourceUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="context-card-link"
                            >
                              <span>Source: {card.sourceName}</span>
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* BRIDGING PERSPECTIVES */}
                    {activeTab === 'perspectives' && (
                      <div className="perspectives-section">
                        <div className="perspective-tag-row">
                          {['all', 'environmental', 'policy', 'technical', 'community', 'research'].map((tag) => (
                            <button
                              key={tag}
                              onClick={() => setPerspectiveFilter(tag)}
                              className={`perspective-filter-btn ${perspectiveFilter === tag ? 'active' : ''}`}
                            >
                              <span style={{ textTransform: 'capitalize' }}>{tag} perspective</span>
                            </button>
                          ))}
                        </div>

                        <div className="perspectives-grid">
                          {activeReport.bridgingPerspectives
                            .filter(p => perspectiveFilter === 'all' || p.perspectiveTag === perspectiveFilter)
                            .map((p) => (
                              <div key={p.id} className="perspective-card">
                                <div className="perspective-header">
                                  <span className="perspective-source-name">{p.source}</span>
                                  <span className={`perspective-badge ${p.perspectiveTag}`}>
                                    {p.perspectiveTag}
                                  </span>
                                </div>
                                <h4 className="perspective-title">{p.title}</h4>
                                
                                <div className="perspective-rationale-box">
                                  <span className="drawer-subtitle" style={{ fontSize: '10px' }}>Why Included</span>
                                  <p style={{ marginTop: '4px', fontSize: 'var(--text-caption)' }}>
                                    {p.whyIncluded}
                                  </p>
                                </div>
                                
                                <a 
                                  href={p.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="context-card-link"
                                  style={{ marginTop: '8px' }}
                                >
                                  <span>Read perspective article</span>
                                  <ExternalLink size={12} />
                                </a>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Provenance Card Footer */}
                  <footer className="report-footer">
                    <div className="provenance-card">
                      <div className="provenance-info">
                        <div className="provenance-status-row">
                          <span className="provenance-status-title">Status:</span>
                          <span className={`badge-pill ${activeReport.provenance.reviewStatus === 'expert-reviewed' ? 'supported' : activeReport.provenance.reviewStatus === 'under-dispute' ? 'under-dispute' : 'mixed'}`}>
                            {activeReport.provenance.reviewStatus === 'expert-reviewed' && <ShieldCheck size={12} />}
                            {activeReport.provenance.reviewStatus === 'under-dispute' && <AlertTriangle size={12} />}
                            {activeReport.provenance.reviewStatus === 'ai-generated' && <Sliders size={12} />}
                            <span style={{ textTransform: 'capitalize' }}>
                              {activeReport.provenance.reviewStatus.replace('-', ' ')}
                            </span>
                          </span>
                        </div>
                        
                        <div className="provenance-meta">
                          <span>Analysis Model: <strong>{activeReport.provenance.model}</strong></span>
                          <span>Version: {activeReport.provenance.analysisVersion}</span>
                          <span>Standard Policy: {activeReport.provenance.sourcePolicyVersion}</span>
                          <span>Updated: {activeReport.provenance.lastUpdated}</span>
                        </div>
                      </div>

                      <div className="provenance-actions">
                        <button 
                          onClick={() => {
                            const newClaim = activeReport.claims[0];
                            handleOpenDispute(newClaim);
                          }}
                          className="provenance-btn warning"
                        >
                          <AlertTriangle size={14} />
                          <span>Dispute Analysis</span>
                        </button>
                      </div>
                    </div>
                  </footer>
                </div>
              </div>
            )}
          </>
        )}

        {/* -------------------- EXPERT DESK WORKSPACE -------------------- */}
        {activeWorkspace === 'expert' && (
          <div className="expert-layout">
            {/* Sidebar list of disputes */}
            <div className="expert-queue-sidebar">
              <h4 className="expert-section-title">Pending Disputes ({disputes.filter(d => d.status === 'pending').length})</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {disputes.map((disp) => (
                  <button 
                    key={disp.id}
                    onClick={() => setSelectedDisputeId(disp.id)}
                    className={`dispute-item-card ${selectedDisputeId === disp.id ? 'active' : ''}`}
                  >
                    <div className="dispute-meta-row">
                      <span>Status: <strong style={{ color: disp.status === 'resolved' ? 'var(--color-success)' : 'var(--color-warning)' }}>{disp.status.toUpperCase()}</strong></span>
                      <span>{new Date(disp.timestamp).toLocaleDateString()}</span>
                    </div>
                    <span className="dispute-card-title">Claim #{disp.claimNumber} (Report: {disp.reportId})</span>
                    <p className="dispute-card-desc">"{disp.claimText}"</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Editing desk workspace */}
            <div className="expert-workspace-desk">
              {!activeDispute ? (
                <div className="expert-empty-state">
                  <FileSpreadsheet size={48} style={{ marginBottom: '16px', color: 'var(--text-muted)' }} />
                  <h3>No dispute selected</h3>
                  <p style={{ fontSize: 'var(--text-small)', marginTop: '8px' }}>Select an open claim dispute from the left queue to begin validation review.</p>
                </div>
              ) : (
                <form onSubmit={handlePublishExpertChanges} className="modal-form">
                  <div className="modal-header" style={{ padding: 0 }}>
                    <div>
                      <h3 className="modal-title" style={{ fontSize: 'var(--text-h2)' }}>Review Claim #{activeDispute.claimNumber}</h3>
                      <span className="citation-source" style={{ display: 'block', marginTop: '4px' }}>Under report context ID: <strong>{activeDispute.reportId}</strong></span>
                    </div>
                    <span className={`badge-pill ${activeDispute.status === 'resolved' ? 'supported' : 'under-dispute'}`}>
                      {activeDispute.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="dispute-detail-block">
                    <span className="dispute-detail-label">Claim Asserted</span>
                    <p className="dispute-detail-text">"{activeDispute.claimText}"</p>
                  </div>

                  <div className="dispute-detail-block">
                    <span className="dispute-detail-label">User Contesting Argument</span>
                    <p className="dispute-detail-text">{activeDispute.explanation}</p>
                    <span className="dispute-detail-label" style={{ marginTop: '8px' }}>Submitted Verification Source</span>
                    <a href={activeDispute.sourceUrl} target="_blank" rel="noopener noreferrer" className="dispute-detail-url">
                      {activeDispute.sourceUrl}
                    </a>
                  </div>

                  <div className="workspace-columns">
                    {/* Left Desk Column: Form Edit */}
                    <div className="workspace-column">
                      <h4 className="column-header">Update Report Values</h4>
                      
                      <div className="form-group">
                        <label className="form-label">Evidence Strength Rating</label>
                        <select 
                          id="expert-rating"
                          name="expert-rating"
                          value={expertEvidenceStrength}
                          onChange={(e) => setExpertEvidenceStrength(e.target.value as Claim['evidenceStrength'])}
                          className="form-select"
                        >
                          <option value="supported">Supported (Tier 1 Consensus)</option>
                          <option value="mixed">Mixed (Evidence Contested)</option>
                          <option value="weak">Weak (Insufficient backing data)</option>
                          <option value="insufficient">Insufficient (No references)</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label" htmlFor="expert-explanation">Expert Evidence Explanation</label>
                        <textarea 
                          id="expert-explanation"
                          name="expert-explanation"
                          value={expertEvidenceDesc}
                          onChange={(e) => setExpertEvidenceDesc(e.target.value)}
                          className="form-textarea"
                          rows={4}
                          placeholder="Provide the objective reasoning for this rating..."
                        />
                      </div>
                    </div>

                    {/* Right Desk Column: Action Confirm */}
                    <div className="workspace-column">
                      <h4 className="column-header">Audit Logger & Release</h4>
                      
                      <div className="form-group">
                        <label className="form-label">Changelog Reason (Public)</label>
                        <textarea 
                          id="expert-changelog"
                          name="expert-changelog"
                          value={expertChangelog}
                          onChange={(e) => setExpertChangelog(e.target.value)}
                          className="form-textarea"
                          rows={4}
                          placeholder="e.g., Re-rated evidence to supported after reviewing local government tax records uploaded in dispute..."
                        />
                      </div>

                      <div style={{ marginTop: 'auto', display: 'flex', gap: '16px' }}>
                        <button 
                          type="submit" 
                          className="editor-btn save"
                          style={{ flex: 1 }}
                          disabled={activeDispute.status === 'resolved'}
                        >
                          {activeDispute.status === 'resolved' ? 'Changes Published' : 'Publish Report Revision'}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </main>

      {/* -------------------- DISPUTE SUBMISSION MODAL -------------------- */}
      {disputeModalOpen && disputeClaim && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Dispute Claim #{disputeClaim.number}</h3>
              <button onClick={() => setDisputeModalOpen(false)}>
                <X size={20} className="modal-close-btn" />
              </button>
            </div>

            <div className="original-quote-box" style={{ margin: 0 }}>
              <p>"{disputeClaim.text}"</p>
            </div>

            <form onSubmit={handleSubmitDispute} className="modal-form">
              <div className="form-group">
                <label className="form-label" htmlFor="dispute-source-url">Verification Source URL</label>
                <input 
                  type="url" 
                  id="dispute-source-url"
                  name="dispute-source-url"
                  required
                  placeholder="https://example.com/source-document"
                  value={disputeSourceUrl}
                  onChange={(e) => setDisputeSourceUrl(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="dispute-explanation">Explanation of Omission or Error</label>
                <textarea 
                  id="dispute-explanation"
                  name="dispute-explanation"
                  required
                  placeholder="Explain why this claim's evidence assessment is inaccurate or what context was omitted..."
                  value={disputeExplanation}
                  onChange={(e) => setDisputeExplanation(e.target.value)}
                  className="form-textarea"
                  rows={4}
                />
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  onClick={() => setDisputeModalOpen(false)}
                  className="modal-btn cancel"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="modal-btn submit"
                >
                  Submit Dispute
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
