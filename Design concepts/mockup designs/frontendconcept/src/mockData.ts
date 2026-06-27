export interface Citation {
  id: string;
  title: string;
  url: string;
  tier: 1 | 2 | 3;
  sourceName: string;
}

export interface Claim {
  id: string;
  number: number;
  text: string;
  quote: string;
  verifiability: 'high' | 'medium' | 'low' | 'unverifiable';
  evidenceStrength: 'supported' | 'mixed' | 'weak' | 'insufficient';
  evidenceDescription: string;
  citations: Citation[];
}

export interface FramingExample {
  text: string;
  explanation: string;
  startIndex: number;
  endIndex: number;
}

export interface FramingSignal {
  id: string;
  type: 'Emotional Language' | 'Us vs. Them Framing' | 'Selective Emphasis';
  severity: 'high' | 'medium' | 'low';
  description: string;
  examples: FramingExample[];
}

export interface ContextCard {
  id: string;
  title: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
}

export interface BridgingPerspective {
  id: string;
  title: string;
  source: string;
  perspectiveTag: 'environmental' | 'policy' | 'technical' | 'community' | 'research';
  url: string;
  whyIncluded: string;
}

export interface Provenance {
  model: string;
  analysisVersion: string;
  sourcePolicyVersion: string;
  reviewStatus: 'expert-reviewed' | 'ai-generated' | 'under-dispute';
  lastUpdated: string;
  disputesCount: number;
}

export interface AnalysisReport {
  id: string;
  type: 'youtube' | 'article' | 'transcript';
  title: string;
  creator: string;
  platform: string;
  thumbnailUrl: string;
  publishDate: string;
  durationOrLength: string;
  sourceUrl: string;
  tldr: string;
  transcript: string;
  claims: Claim[];
  framingSignals: FramingSignal[];
  contextCards: ContextCard[];
  bridgingPerspectives: BridgingPerspective[];
  provenance: Provenance;
}

export interface Dispute {
  id: string;
  reportId: string;
  claimId: string;
  claimNumber: number;
  claimText: string;
  sourceUrl: string;
  explanation: string;
  timestamp: string;
  status: 'pending' | 'resolved' | 'rejected';
}

export const initialReports: AnalysisReport[] = [
  {
    id: 'mining-video',
    type: 'youtube',
    title: 'The Future of Deep-Sea Mining: Clean Energy Solution or Ecological Disaster?',
    creator: 'Apex Tech & Ecology',
    platform: 'YouTube',
    thumbnailUrl: 'https://images.unsplash.com/photo-1583212292454-1fe6229603b7?w=600&auto=format&fit=crop&q=60',
    publishDate: 'June 12, 2026',
    durationOrLength: '14:25',
    sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    tldr: 'This video explores the debate surrounding deep-sea mining for battery metals like cobalt and nickel. It argues that seafloor harvesting is necessary to meet clean energy goals but downplays potential ecological damage. Opponents argue that deep-sea ecosystems are too fragile and unexplored to risk.',
    transcript: 'We stand at a critical crossroads. Climate change is ravaging our planet, and our only escape is a complete transition to green energy. But green tech requires batteries, and batteries require cobalt, nickel, and manganese. The land-based mines in Congo are hotbeds of human rights violations and environmental devastation. Yet, four thousand meters below the Pacific Ocean, in the Clarion-Clipperton Zone, lie billions of tons of these exact metals, just sitting on the seabed as polymetallic nodules. Harvesting these nodules is virtually impact-free. There are no forests to clear, no communities to displace, and no toxic tailings. Mining companies are being held back by bureaucrats and radical environmentalists who care more about deep-sea worms than the future of humanity. If we do not mine the seabed now, we doom ourselves to global warming.',
    claims: [
      {
        id: 'mining-claim-1',
        number: 1,
        text: 'Land-based mines in Congo are hotbeds of human rights violations and environmental devastation.',
        quote: 'The land-based mines in Congo are hotbeds of human rights violations and environmental devastation.',
        verifiability: 'high',
        evidenceStrength: 'supported',
        evidenceDescription: 'Multiple reports from international bodies (UN, Amnesty International) and peer-reviewed journals document systemic human rights concerns, child labor, and acid mine drainage in the Katanga Copperbelt of the DRC.',
        citations: [
          {
            id: 'cit-m1-1',
            title: 'DRC Cobalt Mining: Human Rights & Environmental Costs',
            url: 'https://www.amnesty.org/en/documents/afr62/3183/2026/en/',
            tier: 2,
            sourceName: 'Amnesty International Report'
          },
          {
            id: 'cit-m1-2',
            title: 'Environmental footprints of cobalt supply chains',
            url: 'https://www.nature.com/articles/s41893-024-1234-x',
            tier: 1,
            sourceName: 'Nature Sustainability'
          }
        ]
      },
      {
        id: 'mining-claim-2',
        number: 2,
        text: 'Harvesting polymetallic nodules from the deep seabed is virtually impact-free.',
        quote: 'Harvesting these nodules is virtually impact-free. There are no forests to clear, no communities to displace, and no toxic tailings.',
        verifiability: 'medium',
        evidenceStrength: 'mixed',
        evidenceDescription: 'While seabed harvesting avoids land deforestation and community relocation, scientific consensus indicates it is NOT impact-free. Harvesting creates massive underwater sediment plumes, causes noise pollution, and destroys benthic habitats that take millions of years to recover.',
        citations: [
          {
            id: 'cit-m2-1',
            title: 'Scientific Synthesis on Deep-Sea Mining Impacts',
            url: 'https://www.nature.com/articles/s41561-023-01235-w',
            tier: 1,
            sourceName: 'Nature Geoscience'
          },
          {
            id: 'cit-m2-2',
            title: 'MIDAS Project: Managing Impacts of Deep-Sea Resource Exploitation',
            url: 'https://www.eu-midas.net/outputs',
            tier: 1,
            sourceName: 'European Union Research Consortium'
          },
          {
            id: 'cit-m2-3',
            title: 'Seabed Mining Impacts: Industry vs Conservation Perspectives',
            url: 'https://www.adfontesmedia.com/',
            tier: 3,
            sourceName: 'DeepSea Resources Coalition'
          }
        ]
      },
      {
        id: 'mining-claim-3',
        number: 3,
        text: 'If we do not mine the seabed now, we doom ourselves to global warming.',
        quote: 'If we do not mine the seabed now, we doom ourselves to global warming.',
        verifiability: 'low',
        evidenceStrength: 'weak',
        evidenceDescription: 'This claim presents a false dilemma. Energy transition projections show that while metals are in high demand, advancements in battery chemistry (such as Lithium Iron Phosphate - LFP, and Sodium-ion batteries) and circular economy recycling could substantially reduce reliance on deep-sea cobalt and nickel.',
        citations: [
          {
            id: 'cit-m3-1',
            title: 'Global EV Outlook 2025: Battery Tech Pathways',
            url: 'https://www.iea.org/reports/global-ev-outlook-2025',
            tier: 2,
            sourceName: 'International Energy Agency'
          },
          {
            id: 'cit-m3-2',
            title: 'Recycling and chemistry trends could bypass deep-sea minerals',
            url: 'https://www.sciencedirect.com/science/article/pii/S12345',
            tier: 1,
            sourceName: 'Resources, Conservation & Recycling Journal'
          }
        ]
      }
    ],
    framingSignals: [
      {
        id: 'mining-framing-1',
        type: 'Emotional Language',
        severity: 'medium',
        description: 'Uses emotionally charged verbs and adjectives ("ravaging", "devastation", "doom") to create a high sense of urgency and fear, encouraging fast adoption of seabed mining.',
        examples: [
          {
            text: 'Climate change is ravaging our planet, and our only escape is a complete transition',
            explanation: 'Uses high-arousal words like "ravaging" and "only escape" to prime the audience with fear and reduce critical thinking.',
            startIndex: 30,
            endIndex: 110
          },
          {
            text: 'If we do not mine the seabed now, we doom ourselves to global warming.',
            explanation: 'Presents a terrifying finality ("doom ourselves") to pressure the viewer into accepting the industry proposal.',
            startIndex: 730,
            endIndex: 800
          }
        ]
      },
      {
        id: 'mining-framing-2',
        type: 'Us vs. Them Framing',
        severity: 'high',
        description: 'Creates a sharp division between green energy proponents and conservationists, framing scientists and environmental groups as malicious blockades.',
        examples: [
          {
            text: 'held back by bureaucrats and radical environmentalists who care more about deep-sea worms than the future of humanity',
            explanation: 'Dehumanizes opposing arguments by simplifying them to "curing worms" vs "saving humanity" and labels them as "radical environmentalists".',
            startIndex: 580,
            endIndex: 698
          }
        ]
      },
      {
        id: 'mining-framing-3',
        type: 'Selective Emphasis',
        severity: 'medium',
        description: 'Emphasizes land-based issues (deforestation, child labor) while omitting the heavy environmental risks of deep-sea mining such as benthic plume drift and biodiversity loss.',
        examples: [
          {
            text: 'Harvesting these nodules is virtually impact-free. There are no forests to clear, no communities to displace, and no toxic tailings.',
            explanation: 'Mentions only the impacts that seabed mining avoids, completely omitting the novel ecological impacts unique to seabed mining (e.g., benthic ecosystem destruction).',
            startIndex: 430,
            endIndex: 560
          }
        ]
      }
    ],
    contextCards: [
      {
        id: 'mining-ctx-1',
        title: 'Clarion-Clipperton Zone (CCZ)',
        description: 'An abyssal plain stretching 4.5 million square kilometers between Hawaii and Mexico. It is estimated to contain 340 million metric tons of nickel and 270 million metric tons of cobalt, which exceeds all known land-based reserves combined.',
        sourceName: 'International Seabed Authority',
        sourceUrl: 'https://www.isa.org.jm/exploration-contracts/clarion-clipperton-zone'
      },
      {
        id: 'mining-ctx-2',
        title: 'Benthic Ecosystem Vulnerability',
        description: 'Deep-sea organisms in the CCZ live in extreme stability (stable temperatures, low nutrient levels, no light). Studies show that benthic communities disturbed by simulated mining in 1989 have still not recovered 30 years later, demonstrating low resilience.',
        sourceName: 'Royal Society Open Science',
        sourceUrl: 'https://royalsocietypublishing.org/doi/10.1098/rsos.190123'
      },
      {
        id: 'mining-ctx-3',
        title: 'LFP & Sodium-Ion Progress',
        description: 'Lithium Iron Phosphate (LFP) batteries, which require zero cobalt or nickel, have risen from 10% of the EV market in 2020 to over 40% in 2025. Sodium-ion chemistry, which uses zero lithium, cobalt, or nickel, entered mass production in early 2026.',
        sourceName: 'BloombergNEF Research',
        sourceUrl: 'https://about.bnef.com/blog/state-of-battery-technology-2026/'
      }
    ],
    bridgingPerspectives: [
      {
        id: 'mining-p-1',
        title: 'Deep-Sea Mining: The Technical Feasibility and Mineral Demand Study',
        source: 'Engineering & Mining Journal',
        perspectiveTag: 'technical',
        url: 'https://www.e-mj.com/features/deep-sea-nodule-recovery/',
        whyIncluded: 'Provides detailed engineering data on deep-sea suction lifts, nodule collectors, and metal extraction efficiencies, illustrating the raw technical and commercial case for mining.'
      },
      {
        id: 'mining-p-2',
        title: 'The Circular Alternative: Can Recycling Meet Our Clean Metal Needs?',
        source: 'Resource Conservation Policy Institute',
        perspectiveTag: 'policy',
        url: 'https://www.rcp-institute.org/recycling-vs-extraction/',
        whyIncluded: 'Analyzes regulatory pathways for mandating closed-loop battery recycling in Europe and North America, offering a policy roadmap that minimizes new mineral extraction.'
      },
      {
        id: 'mining-p-3',
        title: 'Protecting the Abyssal Commons: Environmental Governance in International Waters',
        source: 'Marine Policy Journal',
        perspectiveTag: 'environmental',
        url: 'https://www.sciencedirect.com/journal/marine-policy',
        whyIncluded: 'Discusses the legal mandates of the International Seabed Authority (ISA) and the push for a precautionary moratorium supported by 25+ nations, exploring environmental safety standards.'
      }
    ],
    provenance: {
      model: 'Gemini 3.5 Flash',
      analysisVersion: '1.0.2',
      sourcePolicyVersion: 'v1.1 (April 2026)',
      reviewStatus: 'ai-generated',
      lastUpdated: 'June 25, 2026',
      disputesCount: 0
    }
  },
  {
    id: 'transit-article',
    type: 'article',
    title: 'Evaluating the Real-World Impact of City-Wide Free Public Transit',
    creator: 'Urban Development Forum',
    platform: 'Medium',
    thumbnailUrl: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=600&auto=format&fit=crop&q=60',
    publishDate: 'May 3, 2026',
    durationOrLength: '1,200 words',
    sourceUrl: 'https://medium.com/urban-development/transit-impact-2026',
    tldr: 'An analytical piece claiming that city-wide free public transit schemes are an economic black hole. The article states that fares are necessary to fund system maintenance and expansions, and that eliminating fares does not actually convince car drivers to switch, only shifting walkers and cyclists to buses.',
    transcript: 'Fares are the lifeblood of public transit. In recent years, progressive city councils have pushed free-transit schemes under the guise of equity and climate action. But these policies are economic black holes. When Tallinn and Hasselt made transit free, they saw massive deficits, prompting tax hikes. Furthermore, data reveals that removing fares fails to reduce traffic congestion. Car drivers value convenience, not cost; making buses free only lures walkers and cyclists off the sidewalks. Meanwhile, transit quality declines. Without fare revenue, cities defer maintenance, leading to delayed trains and filthy buses. If we want functional transit, we must charge riders. Free transit is a luxury we simply cannot afford.',
    claims: [
      {
        id: 'transit-claim-1',
        number: 1,
        text: 'When Tallinn and Hasselt made transit free, they saw massive deficits, prompting tax hikes.',
        quote: 'When Tallinn and Hasselt made transit free, they saw massive deficits, prompting tax hikes.',
        verifiability: 'high',
        evidenceStrength: 'mixed',
        evidenceDescription: 'While both cities had to fund transit from general tax revenues (Tallinn via an income tax allocation system), studies show they did not experience "massive deficits" leading to emergency tax hikes. Tallinn actually gained municipal revenue due to an influx of registered residents seeking free transit.',
        citations: [
          {
            id: 'cit-t1-1',
            title: 'The Tallinn Free Transit Experiment: A Decadal Evaluation',
            url: 'https://www.sciencedirect.com/science/article/pii/S096585641731112X',
            tier: 1,
            sourceName: 'Transportation Research Part A'
          },
          {
            id: 'cit-t1-2',
            title: 'Funding Mechanisms for Fare-Free Public Transport',
            url: 'https://www.uitp.org/publications/fare-free-transport-funding/',
            tier: 2,
            sourceName: 'International Association of Public Transport (UITP)'
          }
        ]
      },
      {
        id: 'transit-claim-2',
        number: 2,
        text: 'Removing fares only lures walkers and cyclists off sidewalks, failing to reduce traffic.',
        quote: 'making buses free only lures walkers and cyclists off the sidewalks. Furthermore, data reveals that removing fares fails to reduce traffic congestion.',
        verifiability: 'high',
        evidenceStrength: 'supported',
        evidenceDescription: 'Transportation research generally corroborates that fare-free transit primarily attracts short-distance walkers, cyclists, and existing transit users rather than car owners, who are more sensitive to route frequency, speed, and reliability.',
        citations: [
          {
            id: 'cit-t2-1',
            title: 'Effects of Fare-Free Transit on Mode Split and Congestion',
            url: 'https://trid.trb.org/view/1435213',
            tier: 1,
            sourceName: 'Transportation Research Board (TRB)'
          },
          {
            id: 'cit-t2-2',
            title: 'Fare-Free Public Transport: Global Review of Evidence',
            url: 'https://www.sciencedirect.com/science/article/abs/pii/S0967070X2100067X',
            tier: 1,
            sourceName: 'Transport Reviews Journal'
          }
        ]
      },
      {
        id: 'transit-claim-3',
        number: 3,
        text: 'Without fare revenue, cities defer maintenance, leading to delayed trains and filthy buses.',
        quote: 'Without fare revenue, cities defer maintenance, leading to delayed trains and filthy buses.',
        verifiability: 'medium',
        evidenceStrength: 'weak',
        evidenceDescription: 'Transit quality depends on the alternative funding source. In cities where fare revenue was replaced with dedicated sales taxes (e.g. Dunkirk, France) or employer payroll taxes, transit frequency and maintenance quality actually increased, contradicting the claim that fare removal inevitably degrades quality.',
        citations: [
          {
            id: 'cit-t3-1',
            title: 'Case Study: Dunkirk Free Transit and System Expansion',
            url: 'https://www.dunkirk-tourism.com/free-bus-system-impacts',
            tier: 2,
            sourceName: 'Villes de France Urban Report'
          }
        ]
      }
    ],
    framingSignals: [
      {
        id: 'transit-framing-1',
        type: 'Emotional Language',
        severity: 'low',
        description: 'Uses alarmist financial terminology ("lifeblood", "economic black holes", "filthy") to create skepticism about the fiscal viability of public transit projects.',
        examples: [
          {
            text: 'Fares are the lifeblood of public transit.',
            explanation: 'Uses a biological metaphor ("lifeblood") to frame fare charging as essential for survival, rather than one of several policy options.',
            startIndex: 0,
            endIndex: 40
          },
          {
            text: 'these policies are economic black holes.',
            explanation: 'Uses a hyperbole ("economic black holes") to describe municipal budgets, implying irreversible loss of money.',
            startIndex: 160,
            endIndex: 210
          }
        ]
      },
      {
        id: 'transit-framing-2',
        type: 'Selective Emphasis',
        severity: 'high',
        description: 'Focuses strictly on the immediate cost of transit operations, omitting the indirect economic benefits of free transit (e.g., increased local shopping, reduced road wear, and household savings).',
        examples: [
          {
            text: 'Without fare revenue, cities defer maintenance, leading to delayed trains and filthy buses. If we want functional transit, we must charge riders.',
            explanation: 'Omitted factor: Free transit reduces administrative and security costs (ticket machines, gates, fare enforcement, court processing), which can offset up to 15% of fare box losses.',
            startIndex: 530,
            endIndex: 690
          }
        ]
      }
    ],
    contextCards: [
      {
        id: 'transit-ctx-1',
        title: 'Tallinn Passenger Metrics',
        description: 'Tallinn, Estonia made all public transit free for registered residents in 2013. In the first year, public transport usage increased by 14%, and private car trips decreased by 3% city-wide.',
        sourceName: 'Tallinn City Government',
        sourceUrl: 'https://www.tallinn.ee/en/active-mobility/fare-free-public-transport'
      },
      {
        id: 'transit-ctx-2',
        title: 'Farebox Recovery Ratio',
        description: 'The percentage of transit operating expenses covered by passenger fares. In the US, the average is 36%, meaning 64% is already subsidized by government funding. In some cities, the ratio is below 10%, making fare collection costs almost equal to revenue.',
        sourceName: 'Federal Transit Administration (FTA)',
        sourceUrl: 'https://www.transit.dot.gov/ntd/data-product/2025-national-transit-database'
      },
      {
        id: 'transit-ctx-3',
        title: 'Dunkirk, France Transit Jump',
        description: 'In 2018, Dunkirk (population 200,000) became the largest French city to make buses free. Transit passenger volumes jumped by 85% on weekdays and 125% on weekends, with 48% of new riders saying they previously traveled by car.',
        sourceName: 'L’Observatoire de la Gratuité',
        sourceUrl: 'https://www.observatoire-gratuite-dunkerque.fr/'
      }
    ],
    bridgingPerspectives: [
      {
        id: 'transit-p-1',
        title: 'Free Transit as a Climate Weapon: The Case for dunkirk',
        source: 'The Environmentalist Journal',
        perspectiveTag: 'environmental',
        url: 'https://www.theenvironmentalist.org/dunkirk-bus-success/',
        whyIncluded: 'Examines the positive emissions reductions and shifts in passenger habits in medium-sized European cities, highlighting the environmental benefits.'
      },
      {
        id: 'transit-p-2',
        title: 'Mass Transit Financing: Structuring Sustainable Dedicated Taxes',
        source: 'Journal of Urban Economics',
        perspectiveTag: 'research',
        url: 'https://www.sciencedirect.com/journal/journal-of-urban-economics',
        whyIncluded: 'An academic study on the fiscal mechanics of employer payroll levies and commercial parking taxes to substitute fares without service degradation.'
      },
      {
        id: 'transit-p-3',
        title: 'The Mobility Equity Gap: Why Free Transit Matters for Low-Income Workers',
        source: 'Community Development Coalition',
        perspectiveTag: 'community',
        url: 'https://www.communitydev.org/mobility-equity-report/',
        whyIncluded: 'Highlights the social impact, detailing how fare removal improves job access, healthcare access, and financial stability for marginalized communities.'
      }
    ],
    provenance: {
      model: 'Gemini 2.5 Pro',
      analysisVersion: '1.2.0',
      sourcePolicyVersion: 'v1.1 (April 2026)',
      reviewStatus: 'expert-reviewed',
      lastUpdated: 'May 10, 2026',
      disputesCount: 1
    }
  },
  {
    id: 'energy-subsidy',
    type: 'transcript',
    title: 'Pasted Transcript: TV Debate on Solar Subsidies',
    creator: 'User Transcript Paste',
    platform: 'Pasted Transcript',
    thumbnailUrl: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=600&auto=format&fit=crop&q=60',
    publishDate: 'June 26, 2026',
    durationOrLength: '340 words',
    sourceUrl: '',
    tldr: 'A raw transcript submitted by a user from a live TV debate. The speaker claims that state subsidies for residential solar panels are a redistribution of wealth from poor apartment tenants to wealthy homeowners, while producing unstable power grids.',
    transcript: 'We need to talk honestly about solar subsidies. They are a massive scam. The state is taking tax dollars from low-income renters who live in apartment blocks and handing those dollars to wealthy suburban elites who can afford a five-hundred-thousand-dollar home. These rich homeowners get free electricity and tax credits, while the poor renters get stuck with rising grid fees to cover the cost of the wires. Furthermore, solar panels are completely unreliable. When the sun goes down, the grid relies entirely on fossil fuels anyway. We are paying billionaires to destabilize our electrical infrastructure.',
    claims: [
      {
        id: 'subsidy-claim-1',
        number: 1,
        text: 'State solar subsidies redistribute wealth from low-income renters to wealthy suburban homeowners.',
        quote: 'The state is taking tax dollars from low-income renters who live in apartment blocks and handing those dollars to wealthy suburban elites who can afford a five-hundred-thousand-dollar home.',
        verifiability: 'high',
        evidenceStrength: 'mixed',
        evidenceDescription: 'Economic studies show that early solar subsidies did exhibit regressive traits (higher uptake among high-income homeowners). However, recent legislation (e.g. US IRA, EU Social Climate Fund) includes targeted incentives for low-income housing solar, and community solar programs that allow renters to purchase shares of off-site solar arrays.',
        citations: [
          {
            id: 'cit-s1-1',
            title: 'Income Distributional Effects of Residential Solar Subsidies',
            url: 'https://www.sciencedirect.com/science/article/pii/S014098831930112X',
            tier: 1,
            sourceName: 'Energy Economics Journal'
          },
          {
            id: 'cit-s1-2',
            title: 'Evaluating Solar Access for All under the Inflation Reduction Act',
            url: 'https://www.nrel.gov/docs/fy24osti/86241.pdf',
            tier: 1,
            sourceName: 'National Renewable Energy Laboratory (NREL)'
          }
        ]
      },
      {
        id: 'subsidy-claim-2',
        number: 2,
        text: 'Solar homeowners pay less, pushing grid maintenance costs onto non-solar renters.',
        quote: 'These rich homeowners get free electricity and tax credits, while the poor renters get stuck with rising grid fees to cover the cost of the wires.',
        verifiability: 'high',
        evidenceStrength: 'mixed',
        evidenceDescription: 'Often called the "cost shift" debate. While Net Energy Metering (NEM) can reduce the grid contributions of solar owners, several states (like California under NEM 3.0) have restructured tariffs to include fixed grid connection charges for solar owners to mitigate this shift.',
        citations: [
          {
            id: 'cit-s2-1',
            title: 'The Grid Cost-Shift: Quantifying the Impact of NEM Policies',
            url: 'https://lbl.gov/publications/net-metering-cost-shift-utility-bills',
            tier: 1,
            sourceName: 'Lawrence Berkeley National Laboratory'
          }
        ]
      },
      {
        id: 'subsidy-claim-3',
        number: 3,
        text: 'When the sun goes down, the grid relies entirely on fossil fuels.',
        quote: 'When the sun goes down, the grid relies entirely on fossil fuels anyway.',
        verifiability: 'high',
        evidenceStrength: 'weak',
        evidenceDescription: 'While solar generation drops at night, grids increasingly rely on grid-scale battery storage, pumped hydro, nuclear power, and wind energy. In California, grid batteries regularly become the largest source of supply during evening peak hours, debunking the claim of "entirely fossil fuels".',
        citations: [
          {
            id: 'cit-s3-1',
            title: 'California Grid Dashboard: Battery Dispatch Records',
            url: 'https://www.caiso.com/Pages/default.aspx',
            tier: 2,
            sourceName: 'California ISO Real-Time Grid Data'
          },
          {
            id: 'cit-s3-2',
            title: 'Decarbonizing the Evening Peak: The Role of Energy Storage',
            url: 'https://www.sandia.gov/ess-ssl/decarbonizing-peak/',
            tier: 1,
            sourceName: 'Sandia National Laboratories'
          }
        ]
      }
    ],
    framingSignals: [
      {
        id: 'subsidy-framing-1',
        type: 'Emotional Language',
        severity: 'high',
        description: 'Uses intense rhetoric ("massive scam", "billionaires", "destabilize") to invoke resentment and anger towards green energy incentives.',
        examples: [
          {
            text: 'They are a massive scam.',
            explanation: 'Uses a legal/criminal charge ("scam") to color policy disagreements, triggering high-arousal hostility.',
            startIndex: 60,
            endIndex: 85
          },
          {
            text: 'We are paying billionaires to destabilize our electrical infrastructure.',
            explanation: 'Uses conspiracy-tinted framing ("paying billionaires") to make the policy sound corrupt and hazardous.',
            startIndex: 400,
            endIndex: 470
          }
        ]
      },
      {
        id: 'subsidy-framing-2',
        type: 'Us vs. Them Framing',
        severity: 'high',
        description: 'Frames solar policy as a zero-sum war between "low-income renters" and "wealthy suburban elites".',
        examples: [
          {
            text: 'taking tax dollars from low-income renters who live in apartment blocks and handing those dollars to wealthy suburban elites',
            explanation: 'Divides society into two polarized classes, generating animosity between urban tenants and suburban homeowners.',
            startIndex: 90,
            endIndex: 220
          }
        ]
      }
    ],
    contextCards: [
      {
        id: 'subsidy-ctx-1',
        title: 'Regressivity Mitigation',
        description: 'The EPA launched the $7 billion "Solar for All" program in 2024, providing grants to state, tribal, and municipal programs to enable residential solar for over 900,000 low-income households.',
        sourceName: 'US Environmental Protection Agency',
        sourceUrl: 'https://www.epa.gov/greenbuilding/solar-all-program'
      },
      {
        id: 'subsidy-ctx-2',
        title: 'Utility-Scale Storage Boom',
        description: 'Global grid-scale battery storage capacity grew by 140% in 2025 alone. Storage projects are now actively replacing natural gas peaker plants due to faster dispatch times and declining battery cell prices.',
        sourceName: 'International Energy Agency',
        sourceUrl: 'https://www.iea.org/reports/electricity-analysis-2026'
      }
    ],
    bridgingPerspectives: [
      {
        id: 'subsidy-p-1',
        title: 'Evaluating Net Energy Metering Reform: The California NEM 3.0 Case Study',
        source: 'UC Berkeley Energy Institute',
        perspectiveTag: 'policy',
        url: 'https://ei.haas.berkeley.edu/research/nem-3/',
        whyIncluded: 'Explores how rate design can balance solar incentives with grid cost-sharing, addressing the cost-shift argument without abandoning solar expansion.'
      },
      {
        id: 'subsidy-p-2',
        title: 'Batteries Included: How Energy Storage Solves the Solar Duck Curve',
        source: 'IEEE Power & Energy Magazine',
        perspectiveTag: 'technical',
        url: 'https://ieeexplore.ieee.org/xpl/RecentIssue.jsp?punumber=8014',
        whyIncluded: 'Technical paper on how hybrid solar-storage plants and virtual power plants (VPPs) stabilize grid frequencies during solar dips.'
      }
    ],
    provenance: {
      model: 'Gemini 3.5 Flash',
      analysisVersion: '1.0.2',
      sourcePolicyVersion: 'v1.1 (April 2026)',
      reviewStatus: 'ai-generated',
      lastUpdated: 'June 26, 2026',
      disputesCount: 0
    }
  }
];

export const initialDisputes: Dispute[] = [
  {
    id: 'disp-1',
    reportId: 'transit-article',
    claimId: 'transit-claim-1',
    claimNumber: 1,
    claimText: 'When Tallinn and Hasselt made transit free, they saw massive deficits, prompting tax hikes.',
    sourceUrl: 'https://www.tallinn.ee/en/news/free-transit-income-analysis',
    explanation: 'Tallinn did not run a deficit because of free transit. In fact, more than 20,000 new residents registered in Tallinn to qualify for free transport, which brought in substantial additional personal income tax revenue, creating a net positive budget effect for the city. Please update the evidence rating.',
    timestamp: '2026-06-25T14:32:00Z',
    status: 'pending'
  }
];
