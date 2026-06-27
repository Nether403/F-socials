export interface Claim {
  id: string;
  text: string;
  type: 'factual' | 'causal' | 'predictive' | 'opinion' | 'quote';
  verifiability: 'verifiable' | 'partly-verifiable' | 'opinion' | 'unclear';
  evidenceStrength: 'strong' | 'moderate' | 'weak' | 'insufficient';
  evidenceLabel: string;
  citationCount: number;
  span: string;
  citations: Citation[];
  evidenceNotes: string;
}

export interface Citation {
  id: string;
  title: string;
  outlet: string;
  url: string;
  publishedDate: string;
  relevance: string;
}

export interface FramingSignal {
  id: string;
  type: string;
  description: string;
  span: string;
  whyShown: string;
  intensity: 'low' | 'medium' | 'high';
}

export interface ContextItem {
  id: string;
  headline: string;
  outlet: string;
  angle: string;
  snippet: string;
  url: string;
  publishedDate: string;
}

export interface BridgingSource {
  id: string;
  title: string;
  outlet: string;
  tier: 'primary' | 'secondary' | 'specialist';
  tierLabel: string;
  whyIncluded: string;
  frameDifference: string;
  evidenceQuality: 'high' | 'medium' | 'mixed';
  angle: string;
  url: string;
  publishedDate: string;
}

export interface ReportData {
  id: string;
  analyzedUrl: string;
  contentTitle: string;
  platform: string;
  dateAnalyzed: string;
  contentDate: string;
  tldr: string;
  provenanceVersion: string;
  modelVersion: string;
  policyVersion: string;
  reviewStatus: string;
  claims: Claim[];
  framingSignals: FramingSignal[];
  contextItems: ContextItem[];
  bridgingSources: BridgingSource[];
}

export const reportData: ReportData = {
  id: 'rpt-2024-0341',
  analyzedUrl: 'https://example-news.com/article/tech-regulation-threatens-economy',
  contentTitle: 'New Tech Regulation Will Destroy Millions of Jobs and Collapse Innovation',
  platform: 'Online Article · ExampleNews',
  dateAnalyzed: 'June 12, 2025 · 14:32 UTC',
  contentDate: 'June 10, 2025',
  tldr: 'The article argues that proposed federal technology regulation will cause mass unemployment and stifle innovation, citing a think-tank report and several industry executives. It presents these consequences as near-certain outcomes while largely omitting regulatory rationale, international precedent, and independent economic analysis.',
  provenanceVersion: 'v1.2.0-beta',
  modelVersion: 'FSocials-Analysis-Engine 0.9',
  policyVersion: 'Content Policy 2025-A',
  reviewStatus: 'Unreviewed — AI only',

  claims: [
    {
      id: 'clm-001',
      text: 'The proposed regulation will eliminate between 2.4 and 4.1 million technology sector jobs within 36 months of enactment.',
      type: 'predictive',
      verifiability: 'partly-verifiable',
      evidenceStrength: 'weak',
      evidenceLabel: 'Mixed evidence',
      citationCount: 1,
      span: '"…eliminate between 2.4 and 4.1 million technology sector jobs…"',
      evidenceNotes: 'The figure originates from a single industry-funded think-tank report (TechFutures Institute, 2024). Two peer-reviewed economic studies and the Congressional Budget Office have not confirmed this range. Independent modelers cite 300k–800k job transitions — not eliminations — over 5–10 years.',
      citations: [
        {
          id: 'cit-001a',
          title: 'Economic Impact of the Digital Markets Act Framework',
          outlet: 'TechFutures Institute',
          url: '#',
          publishedDate: 'March 2024',
          relevance: 'Primary source for job-loss figures — funded by industry coalition',
        },
        {
          id: 'cit-001b',
          title: 'Technology Employment Projections 2025–2030',
          outlet: 'Congressional Budget Office',
          url: '#',
          publishedDate: 'January 2025',
          relevance: 'Does not confirm article\'s figure; projects smaller, phased transitions',
        },
      ],
    },
    {
      id: 'clm-002',
      text: 'The United States will fall behind China in AI development if the bill passes.',
      type: 'causal',
      verifiability: 'partly-verifiable',
      evidenceStrength: 'insufficient',
      evidenceLabel: 'No sufficient source found',
      citationCount: 0,
      span: '"…fall behind China in AI development…"',
      evidenceNotes: 'No citation is provided in the article for this claim. Comparative AI development metrics (compute investment, published research, patent filings) are mixed; no cited source supports a direct causal link between this regulation and US–China competitive standing.',
      citations: [],
    },
    {
      id: 'clm-003',
      text: 'Senator Marlowe stated: "This bill is a gift to foreign competitors and a death sentence for American startups."',
      type: 'quote',
      verifiability: 'verifiable',
      evidenceStrength: 'strong',
      evidenceLabel: 'Supported by cited source',
      citationCount: 2,
      span: '"This bill is a gift to foreign competitors and a death sentence for American startups."',
      evidenceNotes: 'The quote is confirmed in floor remarks (Congressional Record, June 9, 2025) and a press release from Senator Marlowe\'s office. The quote is accurately attributed. It represents one legislative perspective among a range of positions in the legislative record.',
      citations: [
        {
          id: 'cit-003a',
          title: 'Congressional Record — Senate Floor Debate, June 9, 2025',
          outlet: 'U.S. Congress',
          url: '#',
          publishedDate: 'June 9, 2025',
          relevance: 'Primary source — confirms quote verbatim',
        },
        {
          id: 'cit-003b',
          title: 'Senator Marlowe Press Release on Digital Markets Regulation',
          outlet: 'Office of Senator Marlowe',
          url: '#',
          publishedDate: 'June 9, 2025',
          relevance: 'Confirms quote; legislative advocacy context',
        },
      ],
    },
    {
      id: 'clm-004',
      text: 'Every major economist agrees this regulation is harmful to growth.',
      type: 'factual',
      verifiability: 'verifiable',
      evidenceStrength: 'insufficient',
      evidenceLabel: 'Context needed',
      citationCount: 0,
      span: '"Every major economist agrees…"',
      evidenceNotes: 'This is a universal claim. Economic opinion on technology regulation is substantively divided. A 2025 IGM Forum survey of economists shows a split: 31% expect net negative effects, 28% net positive, 41% uncertain or mixed. The article cites no individual economists by name.',
      citations: [],
    },
    {
      id: 'clm-005',
      text: 'The regulation introduces criminal penalties for algorithm design decisions.',
      type: 'factual',
      verifiability: 'verifiable',
      evidenceStrength: 'moderate',
      evidenceLabel: 'Mixed evidence',
      citationCount: 1,
      span: '"…criminal penalties for algorithm design decisions…"',
      evidenceNotes: 'The bill text (Section 14-B) includes civil liability for certain algorithmic outputs under defined conditions. Legal scholars debate whether this could extend to individual engineers. The "criminal penalties" characterization is disputed; the bill text uses civil enforcement language.',
      citations: [
        {
          id: 'cit-005a',
          title: 'Digital Markets Accountability Act — Full Bill Text, S. 1847',
          outlet: 'U.S. Senate Committee on Commerce',
          url: '#',
          publishedDate: 'May 2025',
          relevance: 'Primary legislative source — Section 14-B covers enforcement provisions',
        },
      ],
    },
  ],

  framingSignals: [
    {
      id: 'frm-001',
      type: 'Emotionally loaded contrast',
      description: 'The article consistently frames the debate as "ordinary innovators and workers" versus an unnamed regulatory apparatus, without specifying which legislators, agencies, or evidence the regulation is based on.',
      span: '"…crushing the dreams of everyday entrepreneurs while bureaucrats in Washington decide which ideas are allowed…"',
      whyShown: 'This pattern of in-group/out-group contrast can heighten emotional response and reduce receptivity to regulatory rationale, independent of the underlying policy merits.',
      intensity: 'high',
    },
    {
      id: 'frm-002',
      type: 'Outcome certainty framing',
      description: 'Predictive claims about job loss and competitive decline are presented as near-certain outcomes ("will eliminate," "will fall behind") rather than as projected scenarios with ranges of uncertainty.',
      span: '"The regulation WILL destroy millions of jobs…" / "…will fall behind China…"',
      whyShown: 'Certainty language in predictive economic claims may underrepresent the genuine uncertainty in economic forecasting, making contested projections appear more settled than the evidence supports.',
      intensity: 'medium',
    },
    {
      id: 'frm-003',
      type: 'Source concentration',
      description: 'The article draws primarily from two source categories: industry-funded research and legislators opposed to the bill. Regulatory agency positions, independent economists, and consumer-advocacy perspectives are not cited.',
      span: 'Article-wide pattern — 7 of 8 named sources share opposition to the bill',
      whyShown: 'A narrow source range in policy reporting may not reflect the full distribution of expert opinion, which can affect how readers assess the overall debate.',
      intensity: 'medium',
    },
    {
      id: 'frm-004',
      type: 'Metaphor escalation',
      description: 'The article uses mortality metaphors ("death sentence," "collapse," "destroy") to describe regulatory effects that economists describe in more graduated terms (transitions, adjustments, competitive shifts).',
      span: '"…a death sentence for American startups…" / "…collapse innovation…"',
      whyShown: 'Escalated metaphors can shift reader perception of severity beyond what cited evidence supports, affecting policy judgment.',
      intensity: 'high',
    },
  ],

  contextItems: [
    {
      id: 'ctx-001',
      headline: 'EU Digital Markets Act: Two Years Later — What the Data Shows',
      outlet: 'Reuters Technology',
      angle: 'empirical / comparative',
      snippet: 'An analysis of two years of EU Digital Markets Act enforcement finds mixed effects on tech employment: large platform hiring declined modestly while challenger startup hiring increased in regulated categories. Overall sector employment remained within 2% of pre-regulation baselines.',
      url: '#',
      publishedDate: 'April 2025',
    },
    {
      id: 'ctx-002',
      headline: 'Consumer Advocates Argue Tech Regulation Protects Small Business Competition',
      outlet: 'The American Prospect',
      angle: 'policy / competitive markets',
      snippet: 'Consumer and small-business groups supporting the bill argue that current platform dominance suppresses competition and that regulation creates market entry opportunities. Their economic models project net job creation in challenger segments over 10 years.',
      url: '#',
      publishedDate: 'June 2025',
    },
    {
      id: 'ctx-003',
      headline: 'What Does the Bill Actually Say? A Section-by-Section Guide',
      outlet: 'TechPolicy.press',
      angle: 'legal / legislative',
      snippet: 'A non-partisan breakdown of the Digital Markets Accountability Act finds that enforcement provisions focus on large platforms above specific revenue thresholds. Provisions affecting smaller companies and startups are more limited than some industry commentary suggests.',
      url: '#',
      publishedDate: 'May 2025',
    },
    {
      id: 'ctx-004',
      headline: 'Economists Split on Digital Platform Regulation Effects',
      outlet: 'IGM Forum / Chicago Booth',
      angle: 'economic / academic',
      snippet: 'An IGM Forum survey of leading economists finds no consensus on net economic effects of digital platform regulation: 31% expect net negative growth effects, 28% net positive, 41% cite too much uncertainty to assess directional effect at this time.',
      url: '#',
      publishedDate: 'February 2025',
    },
  ],

  bridgingSources: [
    {
      id: 'brs-001',
      title: 'How Europe Regulated Big Tech — And What Happened Next',
      outlet: 'Financial Times',
      tier: 'primary',
      tierLabel: 'Established outlet',
      whyIncluded: 'Provides empirical data from comparable regulatory implementation in the EU, offering evidence-based context for projected US outcomes.',
      frameDifference: 'Economic / comparative policy angle — focuses on measured outcomes rather than projections.',
      evidenceQuality: 'high',
      angle: 'Economic & comparative policy',
      url: '#',
      publishedDate: 'March 2025',
    },
    {
      id: 'brs-002',
      title: 'The Case for Algorithmic Accountability: Why Regulation Is Overdue',
      outlet: 'MIT Technology Review',
      tier: 'specialist',
      tierLabel: 'Specialist / technical',
      whyIncluded: 'Provides technical and consumer-harm rationale for the regulation — the primary case not represented in the analyzed article.',
      frameDifference: 'Technical / consumer-impact angle — focuses on documented harms that motivated the bill.',
      evidenceQuality: 'high',
      angle: 'Technical & consumer-impact',
      url: '#',
      publishedDate: 'April 2025',
    },
    {
      id: 'brs-003',
      title: 'Small Business Owners Divided on Tech Platform Rules',
      outlet: 'Wall Street Journal',
      tier: 'primary',
      tierLabel: 'Established outlet',
      whyIncluded: 'Captures a range of small-business perspectives, including those who see current platform power as harmful to their operations — a constituency the article does not include.',
      frameDifference: 'Local-impact / small-business angle — shows internal disagreement within the "innovation economy" framing.',
      evidenceQuality: 'medium',
      angle: 'Local impact & small business',
      url: '#',
      publishedDate: 'June 2025',
    },
    {
      id: 'brs-004',
      title: 'Civil Liberties Groups Weigh In: Algorithmic Transparency Rules',
      outlet: 'Electronic Frontier Foundation',
      tier: 'specialist',
      tierLabel: 'Specialist / civil liberties',
      whyIncluded: 'Represents civil-liberties framing of algorithmic accountability — a perspective absent from the analyzed article\'s source set.',
      frameDifference: 'Civil-liberties / rights angle — centers transparency and user autonomy rather than economic competition.',
      evidenceQuality: 'medium',
      angle: 'Civil liberties & rights',
      url: '#',
      publishedDate: 'May 2025',
    },
    {
      id: 'brs-005',
      title: 'US–China AI Competition: What the Data Actually Shows',
      outlet: 'Georgetown Center for Security and Emerging Technology',
      tier: 'specialist',
      tierLabel: 'Research institution',
      whyIncluded: 'Provides independent analysis of US–China AI competitive metrics, directly relevant to the article\'s unsourced competitiveness claim.',
      frameDifference: 'Scientific / national-security angle — uses measured indicators rather than projective rhetoric.',
      evidenceQuality: 'high',
      angle: 'Scientific & strategic',
      url: '#',
      publishedDate: 'January 2025',
    },
  ],
};

export const claimTypeColors: Record<string, string> = {
  factual: 'text-sky-300 bg-sky-950/50 border-sky-800/40',
  causal: 'text-violet-300 bg-violet-950/50 border-violet-800/40',
  predictive: 'text-amber-300 bg-amber-950/50 border-amber-800/40',
  opinion: 'text-slate-300 bg-slate-800/50 border-slate-700/40',
  quote: 'text-teal-300 bg-teal-950/50 border-teal-800/40',
};

export const verifiabilityColors: Record<string, string> = {
  'verifiable': 'text-teal-300 bg-teal-950/40 border-teal-800/30',
  'partly-verifiable': 'text-amber-300 bg-amber-950/40 border-amber-800/30',
  'opinion': 'text-slate-300 bg-slate-800/40 border-slate-700/30',
  'unclear': 'text-zinc-400 bg-zinc-800/40 border-zinc-700/30',
};

export const evidenceLabelColors: Record<string, string> = {
  'Supported by cited source': 'text-teal-300',
  'Mixed evidence': 'text-amber-300',
  'Context needed': 'text-sky-300',
  'No sufficient source found': 'text-zinc-400',
};

export const evidenceStrengthBar: Record<string, { width: string; color: string }> = {
  strong: { width: 'w-4/4', color: 'bg-teal-500/60' },
  moderate: { width: 'w-3/4', color: 'bg-amber-500/60' },
  weak: { width: 'w-2/4', color: 'bg-amber-600/50' },
  insufficient: { width: 'w-1/4', color: 'bg-zinc-600/60' },
};

export const framingIntensityConfig: Record<string, { label: string; color: string; dot: string }> = {
  low: { label: 'Low', color: 'text-zinc-400', dot: 'bg-zinc-500' },
  medium: { label: 'Moderate', color: 'text-amber-300', dot: 'bg-amber-500' },
  high: { label: 'Notable', color: 'text-orange-300', dot: 'bg-orange-500' },
};

export const sourceTierColors: Record<string, string> = {
  primary: 'text-sky-300 bg-sky-950/40 border-sky-800/30',
  secondary: 'text-slate-300 bg-slate-800/40 border-slate-700/30',
  specialist: 'text-violet-300 bg-violet-950/40 border-violet-800/30',
};

export const evidenceQualityConfig: Record<string, { label: string; color: string }> = {
  high: { label: 'High evidence quality', color: 'text-teal-300' },
  medium: { label: 'Medium evidence quality', color: 'text-amber-300' },
  mixed: { label: 'Mixed evidence quality', color: 'text-zinc-400' },
};
