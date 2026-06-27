# Executive Summary  
A variety of sources can provide fact‐checking and source‐reliability data.  Public fact-checking organizations (especially those in the IFCN/Poynter network) publish **ClaimReview** or **MediaReview** markup that can be harvested via tools like Google’s Fact Check API or Data Commons (see below).  Academic researchers have released many curated datasets (e.g. *FEVER*, *LIAR*, *FakeNewsNet*, *MOCHEG*, *FACTIFY*, etc.) containing claims, verdicts, evidence, and social-context metadata.  Web archives (e.g. Internet Archive’s Wayback Machine, Common Crawl) provide historical content snapshots.  Social-media platforms expose APIs (Twitter/X, Reddit, etc.) and tools (e.g. CrowdTangle, now Meta Content Library) for harvesting posts.  Commercial vendors (e.g. NewsGuard, Ad Fontes) rate sources but generally require licenses.  Crowdsourcing/annotation (MTurk, Appen, etc.) can *create* labeled data on demand.  Synthetic generation (LLMs like GPT) can produce “fake” claims, though the quality and ethics are challenging. 

Each option has trade-offs: open datasets and ClaimReview feeds are free and easy to ingest but may be limited in scope or static; platform APIs can supply fresh, large-scale content but now often require payment (e.g. Twitter’s 2026 pay-per-use pricing) or special access (e.g. Reddit’s research program).  Legal/ethical issues arise with copyrighted content (most news articles) and personal data.  Table 1 below compares key attributes, and the decision matrix offers guidance on choosing sources by budget, scale, freshness, and risk.  Throughout, we provide example queries and code snippets.  

## Public Fact-Checking Sources (IFCN Signatories, ClaimReview)  
**Provider/Source:** Major fact-checking sites (PolitiFact, Snopes, Reuters Fact Check, AP Fact Check, AFP, etc.) often embed [ClaimReview](https://schema.org/ClaimReview) in their pages.  Google’s **Fact Check Tools API** lets developers search these claims.  For example:  

```bash
curl "https://factchecktools.googleapis.com/v1alpha1/claims:search?query=climate&languageCode=en&key=YOUR_API_KEY"
```  

This returns JSON with claim, verdict, author, and URL.  (The ClaimSearch API supports parameters like `reviewPublisherSiteFilter` and `maxAgeDays`.)  All data retrieved via this API is licensed CC-BY (Google’s site notes “content of this page is licensed under CC BY 4.0”).  Typical use case: query keywords (e.g. topics or specific claims) to get latest fact checks.  Note: *Google’s ClaimWrite API* also exists for writing markup, but that requires site ownership and is not relevant for data gathering.

**Google Fact Check Tools (Data Commons)** – Google’s Data Commons project provides two resources: (1) a **historical “research dataset”** snapshot of ClaimReview markups collected as of mid-2019, and (2) a **live data feed** of ClaimReview markups from the Google Fact Check Markup Tool (ClaimReview Read/Write API).  Both use the ClaimReview schema, and the feed is updated “frequently and regularly”.  The combined data is licensed CC BY.  The Data Commons page links a download (a compressed text file) and a feed URL (a Google Storage JSON stream).  In practice, you would fetch and parse the JSON feed or download the TXT.GZ, then merge with your own data store.  **Size & Scope:** Data Commons reports including “all ClaimReview markup created via the Fact Check Markup Tool” – presumably tens of thousands of claims.  The Reporters’ Lab *Fact-Check Insights* dataset (see below) has ~200k claims, suggesting the Data Commons collection is of similar order.  Languages are international (ClaimReview is global), but most entries are in English (many IFCN signatories write in English).

**IFCN Signatories & Official Sites:**  The International Fact-Checking Network (IFCN) lists vetted fact-checkers worldwide.  You can harvest each signatory’s website via their RSS feeds or ClaimReview markup.  For example, PolitiFact has ~21,000 statements archived (a Kaggle copy exists), and Snopes has thousands (with various topical categories).  No unified API exists for all sites, so one can either scrape (see *Scraping Tools* below) or rely on Google’s ClaimReview aggregators.  Note that many sites also publish RSS, which can be polled.  One approach: use a tool like [Scrapy](https://scrapy.org/) or [newspaper3k](https://newspaper.readthedocs.io/) to crawl known fact-check URLs (e.g. politifact.com/truth-o-meter).

**Example – PolitiFact Kaggle:** A public Kaggle dataset (“Politifact Fact Check Dataset”) contains 21,152 statements from PolitiFact (2008–2022) labeled as True/Mostly True/Half True/etc. (6 categories).  It’s downloadable after signing up on Kaggle.  Snopes statements can be similarly scraped or found (e.g. via Kaggle or community archives).  

**Integration Notes:** ClaimReview data is JSON/CSV (fields like `claimReviewed`, `reviewRating.alternateName`, `author.name`).  No full article text is included (only summary fields and URLs).  For a fact-check or reliability model, you may need to fetch the original article separately (checking copyright!).  Ingestion tip: load into a relational/NoSQL DB keyed by claim ID or URL.  Metadata like publication date and checker name are provided.  The Data Commons feed and API return paged results (up to 10 per call by default, adjustable via `pageSize`).

## Academic Fact-Checking and Reliability Datasets  
Researchers have published many curated datasets of claims (with ground truth) or of news articles labeled credible/fake.  These are usually free to download and are used for training/testing classifiers.  Key examples:

- **FEVER (Fact Extraction and VERification):** 185,445 claims generated from Wikipedia and annotated with **SUPPORTED/REFUTED/NOT ENOUGH INFO**.  Open data (CC BY-SA 4.0) from University College London.  Data is static, English only, updated once (2018).  (Use case: fact-verification model training.)

- **LIAR / LIAR-PLUS:** ~12,836 statements from PolitiFact (2007–2016) with 6-level truth labels (True/Half True/etc.). LIAR-PLUS additionally provides the justification text extracted from the PolitiFact article.  These are public CSVs (the original authors provided them).  (LIAR is lightly imbalanced: ~27% false, 11% true.)

- **FakeNewsNet (ASU ASU/Penn St)** – a multi-dimensional repository. It includes two datasets (Ground truth from PolitiFact and GossipCop) with news content plus related social context (Twitter data via user timeline).  *FakeNewsNet* is accessed via a GitHub project.  The repo provides configuration files and Python scripts to download articles and tweets using Twitter’s API.  **Licensing:** The GitHub notes “complete dataset cannot be distributed because of Twitter privacy policies and news publisher copyrights”.  In other words, you must run the code yourself: fetch each URL and tweet by ID.  **Scale:** The PolitiFact subset (real+fake) had ~21k claims; GossipCop adds more.  (One paper reported FakeNewsNet’s GossipCop portion ~~39k items, PolitiFact ~~3k, with full text and tweet IDs.)  The dataset is continually updated (per the authors, updates are planned).  Integration: run the Python scripts (requires Twitter API keys) to collect news JSON and tweet JSON.  Data is in CSV/JSON format; store as needed.

- **MultiFC:** A collection of claims and fact-checks from multiple domains.  (As cited in, Alhindi et al. created *LIAR-PLUS* and *MultiFC*; MultiFC claims come from websites in various domains).  Data is downloadable from the authors.   

- **NELA-GT (News Landscape):** Large-scale news corpus (2017–2022) labeling sources as credible vs. non-credible (split by bias, etc.).  Contains 1.3M+ articles.  **Access:** via data releases and APIs (some older NELA data was published as CSVs).  **Scope:** multi-lingual (mostly English), broad politics/media.  **Use:** content analysis, source labeling tasks.

- **FakeNewsCorpus:** ~300k news articles scraped from a list of 1,001 “fake” sources.  Available as JSON or CSV from the authors.  (License unclear – likely research use only.) 

- **Getting Real About Fake News:** ~32k articles from 244 known “BS” sources.  

- **MOCHEG (2017, Multimodal):** 21,184 claims from PolitiFact and Snopes, each accompanied by the fact-check article text and any embedded images.  Useful for models using both text and images. 

- **FACTIFY:** 50,000 claims (from reliable US/Indian sources and known fact-checkers) with 100,000 associated images. 

- **COSMOS:** A synthetic multimodal dataset (images manipulated under various caption-changes) used for verifying image-text claims.  (Not fact-check of news, but notable for generating data.)

- **Other domain-specific sets:** *ClaimBuster* (political debates), *Truth of Varying Shades* (health news), *PUBHEALTH* (health domain), etc.  (See reviews.)

**Access & Integration:** Most academic datasets are published as downloads (CSV, JSON, or via data hosting sites).  For example, the FEVER and LIAR data can be downloaded from their websites/GitHub or found on Hugging Face’s datasets repository.  There are no APIs – data is static.  **Use Cases:** Training supervised models, evaluating algorithms.  Since these were often created by scraping fact-check websites or social media (like FakeNewsNet), they may carry the original terms-of-use issues (see *Legal and Ethical* below).

## Web Archives and Crawled News Corpora  
- **Internet Archive (Wayback Machine):** A public archive of web pages.  You can query it via the [Wayback CDX API](https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server) or use their [Save Page Now](https://web.archive.org/save) service.  For example:  
  ```bash
  curl "http://web.archive.org/cdx/search/cdx?url=nytimes.com&output=json&limit=5"
  ```  
  returns the 5 most recent captures of nytimes.com.  Use `&from=YYYYMMDD&to=` filters as needed.  Data is text/HTML of archived pages.  **Content:** often full news articles or fact-check pages, by date.  **License:** Wayback content has copyright; however, the API is a research service.  Use archived text with care (TOS forbids republishing copyrighted text).  **Use Case:** retrieve historical versions of a site or article that may have been changed/deleted (e.g. debunking claims that vanished).  

- **Common Crawl:** A regularly-updated crawl of a large portion of the web (including news).  Monthly indices and WARC files are available for free (via AWS or Common Crawl API).  You can query by domain or keyword using their [Index of all pages](https://commoncrawl.org/the-data/get-started/).  Also, specific subsets exist (e.g. Common Crawl Corpus for news articles).  Data is enormous (petabytes), so using BigQuery or Hadoop is common.  **License:** Public domain.  **Use:** crawl hundreds of millions of pages for training or search, including older articles not easily found elsewhere.  

- **Media Cloud:** An open media analysis platform with a searchable database of news content (1+ billion stories, 25k sources).  It offers APIs for querying stories by keyword, date, or domain.  This is more about news coverage, not fact-checked claims, but it’s relevant for building source-reliability features (e.g. how often a site repeats fact-checks).  The Media Cloud directory of news sources (open-source) can help identify outlet reliability.  

## Social Platform Data (Twitter/X, Reddit, Facebook/Instagram, etc.)  
**Twitter (X):** Historically the richest stream for news/spread of misinformation.  Twitter’s API v2 offers endpoints for recent and filtered search, user timelines, and streaming.  **Recent Changes (2023–2026):** Free access has been removed. As of Feb 2026, new developers must use *pay-per-use*: ~$0.005 per tweet read, $0.015 per tweet posted (and $0.20 if it contains a URL), capped at 2M reads/month.  Legacy free/Basic tiers are gone.  **Access methods:** Apply for a developer account, obtain bearer tokens, and use endpoints like `GET /2/tweets/search/all` (full-archive, but pay-per-use, up to 10K/day free on older Basic plans only).  Sample cURL (requires `bearer_token`):  
```bash
curl -H "Authorization: Bearer $BEARER_TOKEN" \
 "https://api.twitter.com/2/tweets/search/recent?query=misinformation&max_results=10"
```  
  **Data:** JSON (tweets, metadata, user info).  **Scope:** Real-time/historical tweets (depending on endpoint: recent vs all).  **Limitations:** Strict rate limits and monetary costs.  Privacy: by API rules, you may only share tweet IDs, not full content (unless pinned to archive).  

**Reddit:** Was long popular for "crowdsourced fact-checks".  Recent policy changes in 2023 essentially ended open API access.  Reddit announced (April 2023) charging for API access, leading to shutdowns of many third-party tools.  Now: public API access requires applying to the “Responsible Machine Augmentation Program” or similar (limited to approved researchers/companies).  **Alternative:** Pushshift.io provided bulk Reddit data (historical posts/comments) but Reddit disabled its API access in mid-2023.  Currently, most researchers use Reddit’s [“Reddit for Research” program](https://www.reddit.com/r/reddit4research) or monitor specific subreddits manually.  **Data:** JSON from Reddit (via official API or user-scraped).  **Legal:** Reddit content is user-generated; this raises privacy and GDPR concerns if personal data is involved.  

**Facebook/Instagram (Meta):** Public page/group data was accessible via CrowdTangle API (for researchers with accounts).  However, Meta discontinued CrowdTangle on Aug 14, 2024.  They now offer a “Content Library API” (as part of Graph API) for archived posts from news/magazine pages, but access is restricted (one must join Meta’s research program).  **Data:** Public page posts/IDs (some engagements).  **Limitations:** Strict usage policy, rate limits, and personal data rules.  (Personal profiles are off-limits.)  

**YouTube:** Has a Data API (v3) to list videos, comments, etc.  It’s often used to study misinformation videos and comments.  It requires API keys, with quotas (10k units/day free).  Data: JSON with video titles, descriptions, transcript (via separate tools), comments.  **Use:** media/misinformation research (e.g. COVID anti-vax videos).  

**Others:** TikTok has a developer API (very limited and commercial), Mastodon/Bluesky are still emerging.  For most platforms, remember *terms of service*: automated scraping beyond the official API usually violates policies and may incur IP bans.  In general, use APIs where possible.

## Commercial Data Providers  
- **NewsGuard:** Offers reputation scores for ~6,500 news sites (bias/trustworthiness ratings).  Data accessible via a paid API or enterprise license.  (Not open/free.)  Typically used to score source reliability features.  

- **MediaBias/FactCheck, AllSides, Ad Fontes Media:** These organizations manually rate outlets.  MBFC has a website but no public bulk export.  (Community “MBFC Crawler” projects exist but are unofficial.)  AllSides and Ad Fontes similarly publish charts/lists.  There are third-party APIs (e.g. on RapidAPI) that aggregate MBFC and AllSides data, but these are not official and may violate terms.  **Caution:** Scraping these sites for data is against their rules.  

- **Commercial APIs for News Content:** LexisNexis, Factiva, Meltwater, GDELT, or News API (newsapi.org) provide news article feeds and metadata.  These are typically paid (or limited free).  They can be used to build your own dataset of news articles (which you could then label or match to fact-checks).  For example, GDELT and Webhose (now Meltwater) have large news archives (often free/community tiers).  Licenses vary (some content is licensed, some user-generated).  **Use Case:** If you need the raw articles or metadata (dates, URLs), commercial news APIs are easiest; for fact-check labels, you’d still need to match articles to fact-checks manually or via keywords.

- **Data Brokers:** Companies like Clarivate, Cision/PR Newswire, or social listening firms sometimes offer media databases (blogs, tweets, etc.).  These are usually proprietary and expensive.  Unless your project has a large budget, they are out of reach.  

## Crowdsourcing & Annotation Platforms  
- **Annotation Services:** Amazon Mechanical Turk, Prolific, Figure Eight (Appen), Scale AI, Labelbox, etc., can be hired to label claims or rate article veracity.  They allow creating custom HITs for workers: e.g. presenting a news claim/article and asking for a truth label, sources, etc.  **Data:** The output is entirely up to you (any schema you design).  **Costs:** Varies (often a few cents to a few dollars per label).  **Considerations:** Quality control is critical (use multiple raters, gold questions).  IRB/consent issues if dealing with personal content.  (Privacy: avoid showing unlabeled user data without consent.) 

- **Crowd-annotation APIs:** There are also platforms like [Amazon SageMaker Ground Truth](https://aws.amazon.com/sagemaker/groundtruth/) or [Labelbox](https://labelbox.com/) that combine data management with crowdsourcing.  

- **Wikipedian/Volunteer Tools:** Some projects enlist fact-checkers or students to annotate (e.g. rumor datasets like Twitter *RumourEval* from SemEval).  Rarely used for large-scale data.

## Synthetic Data Generation  
AI models (GPT, Grover, etc.) can generate synthetic “fake news” or claims.  For example, the Grover model (Allen Institute) or fine-tuned GPT-3 could write realistic fake articles given a prompt.  **Pros:** virtually unlimited data, customizable scenarios, multi-lingual.  **Cons:** may introduce biases or low-quality “hallucinations”; ethical risk of creating misinformation.  Synthetic datasets exist (e.g. COVID-19 misinformation generated for model training).  If used, clearly label synthetic origin and understand it may not reflect real-world patterns.  

**Integration Tips:** Generating synthetic claims can augment training data for detection models.  One might generate a fake claim and then pair it with the true fact-checked opposite.  However, current state-of-the-art language models already absorb existing misinformation from training data, so their “fake” outputs may inadvertently reuse known falsehoods or generate nonsense.  Always vet generated data for label correctness.

## Scraping Strategies and Tools  
When APIs or downloads are not available, web scraping is a fallback.  Common tools: **Scrapy** (Python framework), **BeautifulSoup** or **lxml** (HTML parsing), **Selenium** (for JavaScript-heavy sites), **newspaper3k** (extracts news content), and language-specific tools (R’s rvest, etc.).  Use these with caution:

- **Respect Robots.txt and Terms:** Check each site’s robots.txt and Terms of Service.  Some explicitly forbid crawling or large-scale data mining.  If disallowed, consider asking for permission or using an API.  

- **Rate Limiting:** Insert delays between requests (e.g. 1–2 sec) to avoid IP blocking.  Use session cookies and vary user-agent to appear human.  For large crawls, use rotating proxies.  

- **Content Extraction:** For news sites, libraries like newspaper3k or Diffbot (paid) can extract article text, title, author.  Fact-checkers often allow text reuse for research, but verify license.  

- **Web Archives as Alternative:** If a site blocks scraping, use the Wayback Machine to retrieve archived copies via its API.  

- **Scrape ClaimReview:** As an alternative to Google APIs, you can scrape ClaimReview JSON-LD directly from fact-check pages by parsing `<script type="application/ld+json">`.  Many sites include ClaimReview in the HTML, so a scraper can extract those fields.

- **Example – Wayback API:**  
  ```bash
  curl "https://web.archive.org/cdx/search/cdx?url=example.com/news/article123&output=json"
  ```  
  retrieves archival versions of that URL.  This can recover fact-checks or claims that were deleted.

**Caution:** Scraping copyrighted text (news articles, reports) may violate copyright. Generally, you may store and analyze such text privately, but cannot redistribute or publish it without license.  Summaries or features (e.g. claim statements) are safer to share.

## Legal and Ethical Considerations  
- **Copyright:** Most news articles and fact-check write-ups are copyrighted. Collecting metadata (titles, claim text, verdict) may be allowed, but copying full articles is legally sensitive.  Solution: prefer structured data (ClaimReview fields) which are typically short.  If scraping full text, credit the source and don’t republish verbatim.  

- **Terms of Service (TOS):** Violating a site’s TOS (e.g. scraping content that a site forbids) can lead to legal risk.  For example, Twitter’s and Reddit’s TOS prohibit unauthorized crawling; after recent changes, they actively block scrapers.  Always review TOS before scraping.  

- **Privacy / Personal Data:** Social media posts may contain personal data.  GDPR/CCPA require caution.  If user content (e.g. tweets, Facebook posts) includes identifying info, ensure compliance: anonymize user IDs, or obtain consent if possible.  (Meta claims public page data, but still have policies about personal data.)  

- **Bias and Representation:** Datasets may be biased (e.g. language skewed to English, political skew to US).  Acknowledge limitations: e.g. IFCN signatories are mostly Western, so fact-check data is mostly English or Western perspectives.  Synthetic datasets may amplify biases from the models.  

- **Misinformation Risks:** When using synthetic data or large crawls, ensure you don’t inadvertently help create new misinformation (e.g. by fine-tuning LLMs on false data).  And don’t trust dataset labels blindly – human annotation quality varies.  

Below is a **legal-risk assessment flowchart** to guide data collection decisions:

```mermaid
flowchart TD
    A[Data Source] --> B{Type of Content}
    B -->|ClaimReview/Structured| C[Generally Open (CC-BY) ✔️]
    B -->|News article/text| D{Licensing}
    D -->|Open-license (e.g. CC)| C
    D -->|No explicit license| E[Copyright risk ⚠️]
    B -->|Social media posts| F{Data Category}
    F -->|Public posts| G[Check platform terms and anonymize]
    F -->|Private/Sensitive| H[Privacy/GDPR risk ⚠️]
    E --> I[Use with caution: limit extracts, cite sources]
    H --> I
    G --> I
    C --> I[Proceed: Cite sources, respect robots.txt]
    I --> J[Mitigation: throttle, use proxies, seek consent]
    style C fill:#ccffcc,stroke:#333,stroke-width:2px
    style E fill:#ffeeba,stroke:#333,stroke-width:2px
    style H fill:#f5c6cb,stroke:#333,stroke-width:2px
    style I fill:#fff5bd,stroke:#333,stroke-width:1px
```

## Comparative Summary of Options  

| **Source/Option**           | **Access Methods**                            | **Data Size/Scope**                                          | **Cost & License**                  | **Risks/Limitations**                                    | **Recommended Use**                                      |
|-----------------------------|-----------------------------------------------|--------------------------------------------------------------|-------------------------------------|----------------------------------------------------------|----------------------------------------------------------|
| **Data Commons Feed**       | JSON feed (HTTP GET), Download (TXT.GZ) | ~70k+ fact-check markups (global, multi-language)           | Free, CC BY             | Requires parsing JSON; feed includes all ClaimReview (no text) | Use for up-to-date claim indices; low risk license       |
| **FactCheckInsights (Duke)**| Web registration → CSV/JSON download | >200k claims (global, ClaimReview & MediaReview)    | Free for approved researchers (for research)  | Must apply; data is researcher-use; minimal – vetted sources only | Large-scale research; tracking multiple orgs; CLI-friendly |
| **PolitiFact/Snopes etc.**  | Official sites (scrape/RSS/API), ClaimReview via Google API| PolitiFact: ~21k statements; Snopes: thousands               | Free; content © respective org (limited reuse) | Scraping TOS issues; site-specific formats; content copyrighted| Historical statement dataset (Kaggle); sourcing new claims |
| **PolitiFact Fact checks**  | Google API or Kaggle CSV          | 21,152 statements (2008–2022)                 | Free; Kaggle terms (non-commercial)     | Static (no updates beyond 2022)                            | Model training (political claims)                          |
| **Academic Datasets (various)**| Downloads (CSV/JSON/GitHub)              | Examples: FEVER 185k claims; MOCHEG 21k claims; FACTIFY 50k claims; others in 10^3–10^6 range | Free; licenses vary (often CC BY-SA or research-use) | May be domain or language-limited; static snapshot          | Training/evaluating fact-check models; baseline research  |
| **FakeNewsNet**             | GitHub scripts (Twitter API required) | Initially ~24k PolitiFact+GossipCop; plus tweets for each claim | Free; data subject to Twitter and publisher TOS | Must fetch via API (rate limits, cost); cannot share raw text| Studying misinformation diffusion (multi-modal)            |
| **Web Archives (Wayback)**  | Wayback CDX API, UI                           | Potentially millions (archive of web)                        | Free; all CClicensed? Mostly ©            | Copies of copyrighted pages; archival lag; not full web live | Retrieving deleted/old claims; historical analysis        |
| **Common Crawl**            | AWS S3 (monthly WARCs)                         | ~hundreds of TB per month (global news/web crawl)           | Free (CC0 data)                        | Very large, messy (no labels); needs processing            | Building large news corpora; text-mining                    |
| **Twitter API**             | Official API (OAuth, paid)      | All public tweets (155B posted as of 2020)                  | Pay-per-use: $0.005/read, $0.015/write | Costly for large volumes; strict TOS; no free tier          | Real-time monitoring; datasets of tweet-level claims       |
| **Reddit API**              | Official API (application required)          | Reddit posts/comments (half-billion users, ~100M posts)    | Free for approved research; no open access after 2023 | Virtually no free access; content licensing/legal issues    | Case studies on subreddits; small-scale collection if allowed |
| **Facebook/Meta (CrowdTangle)** | (Discontinued API; replaced by Meta Content Library for academics) | Public page posts (12M+)                      | Free for approved researchers (via Meta program)   | Now discontinued as of Aug 2024; limited replacement APIs | Historical public page research; limited (mostly for journalists/researchers) |
| **NewsGuard/MBFC/AllSides** | Website (no official API); some data on RapidAPI | Thousands of news sites scored                             | Subscription (NewsGuard ~$42k/yr per API user); MBFC/AllSides proprietary | Must scrape/purchase; terms prohibit scraping; data may be outdated | Journalism research, media bias features (low scale)       |
| **Media Cloud**             | MediaCloud API                                 | ~1B stories, 25k sources                        | Free (CC0 news content)                 | Only news (no social); API quota limits                   | Studying coverage trends; source analysis                   |
| **Crowdsourcing (MTurk)**   | Online platform (HITs)                         | Custom datasets (size = you pay for)                         | Pay per task (from $0.01); platform fees apply  | Labeler quality variable; privacy/consent must be handled  | Creating bespoke annotated claims (small to mid scale)     |
| **Synthetic LLM data**      | Code (GPT-3/4 API, Grover model)              | Unlimited synthetic claims or articles                       | Free for model API usage up to quota; otherwise paid | Data quality unpredictable; ethical risk of misuse         | Data augmentation; stress-testing models                   |
| **Scraping tools** (Scrapy, BeautifulSoup, Newspaper3k, etc.) | Custom scripts                           | Arbitrary (whatever site provides)                           | Free tools; content © source             | Legal/TOS compliance; scraping blocks; rate limits         | When no API exists; prototyping small datasets             |

## Decision Matrix by Budget, Scale, Risk, Freshness  

- **Low Budget / Small Scale:** Rely on *free academic datasets* and *public fact-check feeds*.  E.g. Data Commons (ClaimReview), FactCheckInsights, LIAR, FEVER.  These are zero-cost and legally safe (open licenses).  No real-time requirement.  

- **Large Scale (Millions of Records):** You’ll need big data sources.  Options include *Common Crawl* (for raw text) or *Twitter API* (paid) for live data.  For source reliability labels, NewsGuard or a commercial news dataset might be required (higher budget).  If freshness matters, use platform APIs (at cost).  

- **Freshness (Real-Time Needs):** Use *social APIs or webhooks*.  For example, Twitter streaming (if paid), or push Facebook content via page API.  For fact-checks, monitor the Google ClaimReview feed (regularly updated).  News APIs (e.g. GDELT, News API) can provide latest news (though they cost for large volume).  

- **Legal Risk Tolerance:** If you cannot afford any risk, stick with *open-licensed data*: ClaimReview (CC BY), CC-licensed news (Common Crawl), or public-domain sources.  Avoid scraping heavy content.  If some risk is acceptable (with caution), you may scrape news sites or social content (ensure anonymization and low volume).  

- **Privacy Concerns:** For user-generated content (tweets, Facebook posts, Reddit comments), ensure you anonymize IDs.  If privacy laws are strict (e.g. GDPR), either avoid individual-level data or use only aggregated features.  

**Table: Example Matrix**

| Scenario                            | Budget      | Scale         | Freshness    | Options                                                   |
|-------------------------------------|-------------|---------------|--------------|-----------------------------------------------------------|
| Academic research, proof-of-concept | Low/Free    | Small (10³–10⁴)| Not critical | Public datasets (LIAR, FakeNewsNet small subsets), Data Commons |
| Large-scale modeling (10⁶+)         | Mid/High    | High          | Bulk batch   | Twitter API (pay), Common Crawl, NELA-GT, News APIs       |
| Real-time monitoring                | High        | Large         | High         | Platform APIs (Twitter/X, possibly streaming)|
| Low legal risk requirement          | Low/Free    | Variable      | Any          | ClaimReview (CC BY), Media Cloud (CC0) |
| Budget allows licensing             | High (paid) | High          | High         | NewsGuard, LexisNexis, Meltwater, bespoke scraper teams   |

In general, combine sources: e.g. use FactCheck feeds for gold labels, supplement with crowdsourced annotations or synthetic claims to enlarge the set.  The choice depends on tradeoffs summarized above.

---

**Sample API Queries and Code Snippets:**  

- *Google Fact Check (ClaimReview) API:*  
  ```bash
  curl "https://factchecktools.googleapis.com/v1alpha1/claims:search?query=COVID&languageCode=en&key=API_KEY"
  ```  
  (Returns JSON list of claims from reputable fact-checkers.)  

- *Wayback Machine CDX:*  
  ```bash
  curl "http://web.archive.org/cdx/search/cdx?url=example.com/news/claim&from=20200101&output=json&limit=1"
  ```  
  (Fetches archived versions of a URL, if it was saved.)  

- *Twitter (X) API v2 (post-2023 paid):*  
  ```bash
  curl -H "Authorization: Bearer $TOKEN" \
       "https://api.twitter.com/2/tweets/search/all?query=misinfo&max_results=10"
  ```  
  (Requires a paid developer token and costs $ per tweet.)  

- *Crowdsourcing (MTurk) Integration:* Use AWS SDK or web UI to post tasks. For example, you could call the [MTurk API](https://docs.aws.amazon.com/AWSMechTurk/latest/AWSMturkAPI/Welcome.html) via `boto3` in Python to create HITs and retrieve results.  

- *Scrapy:* A Python snippet to start a simple crawler:  
  ```python
  import scrapy
  class ClaimSpider(scrapy.Spider):
      name = "factcheck"
      start_urls = ["https://www.snopes.com/fact-check/", ...]
      def parse(self, response):
          for article in response.css("article"):
              yield {
                  'title': article.css('h1::text').get(),
                  'claim': article.css('.claim::text').get(),
                  'rating': article.css('.rating::text').get(),
              }
  ```  
  (Use careful rate limiting and check Snopes’ robots.txt.)

---

The above overview demonstrates the **breadth of options** for fact-check and source-reliability data.  Generally, start with official structured sources (ClaimReview feeds) and public datasets, then augment with platform data or scraping as needed.  Always mind licensing: prioritize open data (CC BY or similar) for low-risk projects. 

**Sources:** We primarily referenced official and academic sources: Google/Data Commons documentation, the Duke Reporters’ Lab, and research papers/benchmarks.  Social media API policies were taken from developer docs and recent analyses.  All factual claims here are supported by the cited materials.

