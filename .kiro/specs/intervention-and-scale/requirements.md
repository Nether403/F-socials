# Requirements Document

## Introduction

This is the final phase of the f-Socials roadmap — "Intervention & scale" — gated on trust metrics and legal review. It encompasses three individually-gated capabilities that extend the proven analysis engine onto feed surfaces, open it to institutional consumers, and offer proactive guidance to creators.

1. **Feed Friction Dial (Wedge B)** — When a reader encounters a previously-analyzed piece of content on their social media feed (via the already-shipped read-only browser extension), the system surfaces contextual friction/inoculation: the key framing signals, an evidence summary, and a "learn more" link to the full report. The intervention intensity is configurable (a "dial" from subtle to interruptive). This is framing-as-inoculation delivered on feed surfaces — context overlays, never reranking or blocking.

2. **Public/GraphQL API for institutions** — A B2B API layer allowing institutions (fact-checkers, researchers, libraries, newsrooms, educational platforms) to programmatically query the f-Socials analysis corpus. Sits on top of the normalized report graph (already shipped via `report-graph-normalization`). Rate-limited, API-key-authenticated, with query capabilities for claims, citations, perspective links, cross-report analytics, and topic/domain aggregates.

3. **Creator pre-publish coaching** — Before-publish guidance that nudges creators toward better sourcing and framing before they post. Gated on trust metrics proving the engine's assessments are reliable enough to offer proactive guidance. Framing-aware (identifies potential framing issues in a draft) and evidence-aware (flags unsupported claims), but always advisory — never blocking, never issuing a verdict or rating.

**Critical constraints:**
- f-Socials is a lens, not a judge. No verdicts, no creator labels/ratings.
- The invariant gate must not be weakened. New features satisfy it by construction.
- Source-tier classification attaches to sources/citations only, never to creators.
- Each capability is individually gated — trust metrics + legal review required before shipping each one.
- The read-only extension is a prerequisite for the Feed Friction Dial.
- The normalized report graph is the data layer for the GraphQL API's cross-report queries.
- The existing offline-first path must remain working.

## Glossary

- **Feed_Friction_Dial**: The browser extension overlay that surfaces framing signals and evidence summaries on previously-analyzed content encountered in a social media feed, with configurable intervention intensity.
- **Extension**: The read-only browser extension (shipped in a prior phase) that recognizes analyzed content URLs on feed surfaces and serves as the delivery mechanism for the Feed_Friction_Dial.
- **Friction_Overlay**: The visual element rendered by the Extension on a feed item, containing the framing signals, evidence summary, and a link to the full report.
- **Intervention_Intensity**: A reader-configurable setting (from subtle to interruptive) controlling the visual prominence and behavior of the Friction_Overlay.
- **Institutional_API**: The public, authenticated GraphQL API layer for institutional consumers to query the analysis corpus programmatically.
- **API_Key**: An opaque, revocable credential issued to an Institution for authenticating requests to the Institutional_API.
- **Institution**: An organizational consumer of the Institutional_API — fact-checkers, researchers, libraries, newsrooms, or educational platforms.
- **Rate_Limit**: A per-API_Key cap on the number of requests an Institution may issue within a time window.
- **Report_Graph**: The normalized `claims`/`citations`/`perspective_links` tables and cross-report indexes shipped by `report-graph-normalization`, serving as the data layer for cross-report queries.
- **Coaching_Engine**: The server-side module that analyzes a creator's draft text for framing issues and unsupported claims and returns advisory guidance.
- **Draft**: A text body submitted by a Creator for pre-publish coaching analysis.
- **Creator**: A person who submits a Draft for coaching; the system never rates, labels, or profiles the Creator.
- **Coaching_Response**: The advisory output returned to a Creator, containing identified framing signals and unsupported-claim flags with suggested improvements.
- **Trust_Metric**: A measurable indicator (derived from the observability instrumentation — Citation_Coverage, Model_Human_Agreement) that must exceed a defined threshold before a capability ships.
- **Trust_Gate**: The condition that a capability's required Trust_Metrics have exceeded their defined thresholds and a legal review has been completed, permitting the capability to be activated in production.
- **Invariant_Gate**: The report-readiness gate in `core/assemble.ts`; read-only for this feature and never weakened.
- **Reader**: A person using the web app or Extension, either Anonymous or Authenticated.
- **Web_App**: The React 19 + Vite web client in `app/apps/web`.
- **API**: The Express server in `app/apps/server`.
- **Repository**: The persistence interface in `infra/ports.ts`, implemented in-memory and over Postgres.

## Requirements

### Requirement 1: Trust gate enforcement

**User Story:** As a product owner, I want each capability individually gated on trust metrics and legal review, so that no intervention ships until the engine has earned the right to intervene.

#### Acceptance Criteria

1. WHEN the API receives a request for Feed_Friction_Dial functionality, THE API SHALL evaluate the Trust_Gate for Feed_Friction_Dial and SHALL serve Friction_Overlay data to the Extension only if the gate is satisfied.
2. WHEN the API receives a request for the Institutional_API functionality, THE API SHALL evaluate the Trust_Gate for the Institutional_API and SHALL accept the query only if the gate is satisfied.
3. WHEN the API receives a request for the Coaching_Engine functionality, THE API SHALL evaluate the Trust_Gate for creator coaching and SHALL return Coaching_Responses only if the gate is satisfied.
4. IF a Trust_Gate is not satisfied for a capability at the time of request evaluation, THEN THE API SHALL respond with HTTP 503 and a message indicating the capability is not yet available, and SHALL NOT serve the capability's data or functionality.
5. THE Trust_Gate for each capability SHALL require that Citation_Coverage exceeds a configured threshold in the range 0.0 to 1.0 AND that Model_Human_Agreement exceeds a configured threshold in the range 0.0 to 1.0 AND that a legal review completion flag is set to true.
6. IF a trust metric value is unavailable or undefined at evaluation time, THEN THE API SHALL treat the Trust_Gate as not satisfied for that capability.
7. THE Trust_Gate thresholds SHALL be independently configurable per capability, so that each capability may require different Citation_Coverage and Model_Human_Agreement minimums.
8. WHEN the API evaluates a Trust_Gate, THE API SHALL read the trust metric values from the observability-derived KPI store and the legal review flag from a configuration source, and SHALL NOT hard-code passing values.
9. WHEN a Trust_Gate transitions from not-satisfied to satisfied due to updated metric values or legal review completion, THE API SHALL begin serving the capability on subsequent requests without requiring a redeployment or restart.

### Requirement 2: Feed Friction Dial — overlay content delivery

**User Story:** As a Reader browsing social media with the Extension installed, I want to see contextual framing and evidence information on content that f-Socials has already analyzed, so that I am inoculated against misleading framing without leaving my feed.

#### Acceptance Criteria

1. WHEN the Extension detects a URL on a feed surface whose normalized form matches the analyzed-content URL stored for a previously-analyzed Report, THE Extension SHALL request the Friction_Overlay data from the API for that Report's identifier.
2. WHEN the API receives a Friction_Overlay request for a Report that exists and is in `ready` state, THE API SHALL respond with all of the Report's framing signals (each containing technique name, highlighted quote, and explanation), an evidence summary containing each claim with its evidence strength, and the URL to the full report view.
3. IF the API receives a Friction_Overlay request for a Report that does not exist or is not in `ready` state, THEN THE API SHALL respond with HTTP 404 and THE Extension SHALL NOT render a Friction_Overlay for that URL.
4. WHEN the API responds with Friction_Overlay data, THE API SHALL NOT include any content-truthfulness verdict, any creator-reliability rating, or any source-tier classification attached to a creator.
5. WHEN the Extension receives Friction_Overlay data, THE Extension SHALL render the Friction_Overlay on the matching feed item according to the Reader's configured Intervention_Intensity within 500 milliseconds of receiving the API response.
6. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL include a "learn more" link that opens the full report view URL (as provided in the API response) in a new browser tab.
7. IF the Extension receives an HTTP 404 or a network error for a Friction_Overlay request, THEN THE Extension SHALL silently skip that feed item without rendering any overlay or error indicator on the feed surface.

### Requirement 3: Feed Friction Dial — intervention intensity configuration

**User Story:** As a Reader, I want to control how prominently the feed friction appears, so that I can choose a level of interruption that suits my reading style.

#### Acceptance Criteria

1. THE Extension SHALL provide an Intervention_Intensity setting with exactly three levels: `subtle`, `moderate`, and `interruptive`.
2. WHILE the Intervention_Intensity is set to `subtle`, THE Extension SHALL render the Friction_Overlay as a non-blocking indicator (icon or badge) occupying at most 32×32 CSS pixels, positioned adjacent to the feed item boundary without overlapping or obscuring any feed-item content or interactive elements.
3. WHILE the Intervention_Intensity is set to `moderate`, THE Extension SHALL render the Friction_Overlay as an inline card beneath or beside the feed item showing the highest-severity framing signal (first in report-data order on tie) and the evidence summary, while leaving all feed-item interactive elements (links, buttons, media controls) clickable and operable.
4. WHILE the Intervention_Intensity is set to `interruptive`, THE Extension SHALL render the Friction_Overlay as an overlay that obscures the feed item's text and media content, requiring the Reader to dismiss or expand the overlay before the feed item content becomes visible and interactive.
5. WHEN a Reader changes the Intervention_Intensity setting, THE Extension SHALL persist the choice in the browser extension's local storage (surviving browser restarts) and SHALL apply the new level to all Friction_Overlays currently rendered on the page and to all subsequently rendered Friction_Overlays across all tabs, without requiring a page reload.
6. WHILE the Reader has not configured an Intervention_Intensity, THE Extension SHALL default to `moderate`.
7. IF the Extension cannot read or write the Intervention_Intensity setting from local storage (storage unavailable or full), THEN THE Extension SHALL fall back to `moderate` for the current session and SHALL NOT display an error that disrupts the Reader's feed browsing.
8. WHEN a Reader activates the dismiss action on an `interruptive` Friction_Overlay, THE Extension SHALL remove the overlay from the feed item and reveal the feed item's full content, and WHEN a Reader activates the expand action, THE Extension SHALL navigate to the full report view in a new tab.

### Requirement 4: Feed Friction Dial — lens neutrality on feed surfaces

**User Story:** As a Reader, I want the feed friction to surface framing and evidence without judging content or labeling creators, so that the intervention stays true to the lens principle.

#### Acceptance Criteria

1. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL NOT display any content-truthfulness verdict (such as "true", "false", "misleading", "credible", "debunked", or equivalent synonyms that assert the content's factual status).
2. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL NOT display any reliability rating, score, or label attached to a content creator, author, person, or channel.
3. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL present each framing signal as a descriptive technique name followed by its evidenced quote and its explanation, with the quote and explanation available either inline or through a single expand action, and SHALL NOT editorialize beyond the text provided by the API response.
4. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL present each claim's evidence strength using only the system-defined labels (`none`, `weak`, `moderate`, `strong`), SHALL display the label "no external review found" for claims with evidence strength `none`, and SHALL NOT append, prefix, or substitute wording that characterizes the content as true, false, or misleading.
5. WHERE the Friction_Overlay displays a source-reliability tier, THE Friction_Overlay SHALL attach that tier to a source or citation only, never to the content creator.
6. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL NOT display any aggregate score, overall rating, or composite indicator that summarizes the content's quality, accuracy, or trustworthiness as a single value or ranking.

### Requirement 5: Feed Friction Dial — Extension prerequisite and offline behavior

**User Story:** As a developer, I want the Feed Friction Dial to depend on the read-only extension being installed and to degrade gracefully when offline, so that the delivery mechanism is explicit and reliable.

#### Acceptance Criteria

1. THE Feed_Friction_Dial SHALL operate exclusively within the Extension and SHALL NOT render Friction_Overlays in the Web_App or any surface outside the Extension.
2. IF the Extension cannot reach the API (network error or timeout exceeding 5 seconds), THEN THE Extension SHALL NOT render a Friction_Overlay for the affected feed item and SHALL NOT render any error indicator visible to the Reader on the feed surface.
3. WHEN the Extension detects a URL on a feed surface, THE Extension SHALL check only previously-analyzed content by querying the API and SHALL NOT trigger new analysis pipeline runs from the feed surface.
4. WHILE the Extension is installed but the Feed_Friction_Dial Trust_Gate is not satisfied, THE Extension SHALL NOT request or render Friction_Overlays and SHALL re-evaluate the Trust_Gate status by querying the API at most once every 5 minutes.
5. WHEN the Extension regains connectivity after a network failure, THE Extension SHALL re-check any feed items currently visible in the viewport that were skipped due to the failure, within 10 seconds of connectivity restoration.
6. WHEN the Extension receives an HTTP 503 response indicating the Trust_Gate is not satisfied, THE Extension SHALL treat the response identically to the unsatisfied Trust_Gate state and SHALL NOT render a Friction_Overlay or display an error for that feed item.

### Requirement 6: Institutional API — authentication and key management

**User Story:** As an institutional administrator, I want to obtain and manage API keys, so that my organization can authenticate to the Institutional_API.

#### Acceptance Criteria

1. WHEN an Institution requests an API_Key through the administrative API endpoint, THE API SHALL generate a unique, opaque API_Key of at least 32 cryptographically random bytes (encoded as a URL-safe string), bind it to that Institution, and respond with the API_Key value exactly once in the creation response.
2. WHEN an Institution includes a valid API_Key in the `Authorization` header of a request to the Institutional_API, THE API SHALL authenticate the request and process the query.
3. IF a request to the Institutional_API arrives without an API_Key, or with an API_Key that is malformed, revoked, or does not match any issued key, THEN THE API SHALL respond with HTTP 401 and SHALL NOT execute the query.
4. WHEN an Institution revokes an API_Key, THE API SHALL reject all subsequent requests using that API_Key with HTTP 401 within 60 seconds of revocation.
5. THE API_Key SHALL be distinct from the Supabase JWT Access_Token used by individual Readers and SHALL use a separate authentication path in the API.
6. WHEN the API issues an API_Key, THE API SHALL associate the key with the Institution's identifier and any configured Rate_Limit tier.
7. IF an Institution attempts to create an API_Key when it already has 10 active (non-revoked) API_Keys, THEN THE API SHALL respond with HTTP 409 and a message indicating the active key limit has been reached, and SHALL NOT generate a new key.
8. IF an Institution requests retrieval of a previously-issued API_Key value after the creation response, THEN THE API SHALL respond with HTTP 404 for the key value, as the plaintext key is not stored or retrievable after issuance.

### Requirement 7: Institutional API — GraphQL query capabilities

**User Story:** As a researcher at an institution, I want to query claims, citations, perspectives, and cross-report analytics programmatically, so that I can integrate f-Socials data into my research workflow.

#### Acceptance Criteria

1. WHEN an authenticated Institution queries claims, THE Institutional_API SHALL return claims from the Report_Graph matching the query filters (report identifier, keyword substring match against claim text, date range on report creation date, topic matching an issueFrameLabel) with their associated evidence strengths, citation counts, and verifiability, paginated with a default page size of 50 and a maximum page size of 200.
2. WHEN an authenticated Institution queries citations for a claim, THE Institutional_API SHALL return the citations from the Report_Graph with their source URL, source name, source-tier classification, excerpt (when available), supports value (supports, contradicts, or context-only), and the claimUid they belong to.
3. WHEN an authenticated Institution queries perspective links, THE Institutional_API SHALL return the perspective links from the Report_Graph with their issueFrameLabel, divergence score, dehumanization score, source name, source-tier classification, and the reportId they belong to.
4. WHEN an authenticated Institution queries cross-report analytics, THE Institutional_API SHALL return aggregate data including claim frequency (number of reports containing a matching claim text or topic), source domain frequency (number of citations per unique source domain), and topic distribution (count of reports per issueFrameLabel), computed from the Report_Graph.
5. WHEN an authenticated Institution queries domain or topic aggregates, THE Institutional_API SHALL return summary statistics (report count, claim count, mean ratio of claims with at least one citation to total claims per report) grouped by domain or issueFrameLabel.
6. THE Institutional_API SHALL expose these query capabilities through a single GraphQL endpoint accepting standard GraphQL query syntax.
7. WHEN the Institutional_API returns query results, THE Institutional_API SHALL NOT include any content-truthfulness verdict, any creator-reliability rating, or any field that associates a reliability score with a content creator, author, person, or channel.
8. IF an authenticated Institution submits a syntactically invalid GraphQL query or requests a field that does not exist in the schema, THEN THE Institutional_API SHALL return a GraphQL errors response with a descriptive error message indicating the validation failure, and SHALL NOT execute any resolvers.
9. WHEN the Report_Graph contains no data matching the query filters, THE Institutional_API SHALL return an empty result set (empty list with a total count of zero) and SHALL NOT return an error.
10. WHEN a paginated query result exceeds the requested page size, THE Institutional_API SHALL include pagination metadata (total count, current page offset, whether a next page exists) in the response.

### Requirement 8: Institutional API — rate limiting

**User Story:** As a platform operator, I want to rate-limit institutional API usage per key, so that the system remains available and costs are controlled.

#### Acceptance Criteria

1. WHEN an authenticated Institution exceeds its Rate_Limit within the configured time window, THE Institutional_API SHALL respond with HTTP 429 and a `Retry-After` header whose value is the number of whole seconds remaining until the current window resets.
2. THE Institutional_API SHALL enforce rate limits per API_Key, not per IP address or per Institution aggregate.
3. WHEN the API processes an Institutional_API request within the Rate_Limit, THE API SHALL decrement the remaining quota for that API_Key and include an `X-RateLimit-Remaining` header with the integer count of requests still available in the current window, and an `X-RateLimit-Limit` header with the configured maximum for that API_Key.
4. THE Rate_Limit SHALL be configurable per API_Key, allowing the operator to set both the maximum number of requests and the window duration (in seconds, minimum 1 second, maximum 86 400 seconds) independently for each API_Key.
5. IF a Rate_Limit configuration is absent for an API_Key, THEN THE API SHALL apply a default rate limit of 100 requests per 60-second window for that API_Key.
6. WHEN a time window expires for a given API_Key, THE API SHALL reset the request count for that API_Key to zero and begin a new window of the configured duration.
7. IF the Institutional_API receives a request with an API_Key that has been revoked or is unrecognized, THEN THE API SHALL respond with HTTP 401 and SHALL NOT count the request against any rate-limit quota.

### Requirement 9: Institutional API — data layer integration

**User Story:** As a developer, I want the Institutional API to read from the normalized report graph, so that it leverages the existing cross-report data layer without duplicating storage.

#### Acceptance Criteria

1. THE Institutional_API SHALL read claim, citation, and perspective_link data exclusively from the Report_Graph tables (`claims`, `citations`, `perspective_links`) and their cross-report indexes, and SHALL NOT query the raw JSONB `analysis_reports.data` column for structured queries.
2. THE Institutional_API SHALL NOT write to the Report_Graph tables and SHALL treat them as read-only.
3. WHEN the Report_Graph tables are empty (no reports have been analyzed), THE Institutional_API SHALL return empty result sets for queries and SHALL NOT return an error.
4. THE Institutional_API query resolvers SHALL access data through Repository methods and SHALL NOT execute direct SQL queries in resolver code.
5. WHEN the server runs with the in-memory Repository and no database configured, THE Institutional_API SHALL resolve queries against the in-memory Report_Graph data and SHALL complete without error.

### Requirement 10: Creator pre-publish coaching — draft analysis

**User Story:** As a Creator, I want to submit a draft and receive advisory feedback on framing and evidence before I publish, so that I can improve my sourcing and framing proactively.

#### Acceptance Criteria

1. WHEN an Authenticated Creator submits a Draft of 1 to 50000 characters (after trimming leading and trailing whitespace), THE Coaching_Engine SHALL analyze the Draft for framing issues and unsupported claims and return a Coaching_Response containing at most 20 issue items within 30 seconds.
2. WHEN the Coaching_Engine identifies a framing technique in the Draft, THE Coaching_Response SHALL name the technique, quote the relevant span (at most 300 characters) from the Draft, explain why it may be perceived as a framing issue, and suggest an alternative phrasing.
3. WHEN the Coaching_Engine identifies a claim in the Draft that lacks supporting evidence, THE Coaching_Response SHALL quote the claim (at most 300 characters), explain that no supporting source was identified, and suggest adding a citation or qualifying the claim.
4. WHEN the Coaching_Engine finds no framing issues and no unsupported claims, THE Coaching_Response SHALL indicate that no issues were identified and SHALL NOT fabricate issues.
5. IF a Draft submission is empty, contains only whitespace, or exceeds 50000 characters (after trimming), THEN THE API SHALL respond with HTTP 400 through the zod validation boundary and SHALL NOT invoke the Coaching_Engine.
6. IF a coaching request arrives without a valid Access_Token, THEN THE API SHALL respond with HTTP 401 via `requireAuth` and SHALL NOT invoke the Coaching_Engine.
7. IF the Coaching_Engine fails to produce a Coaching_Response within 30 seconds or encounters an internal error, THEN THE API SHALL respond with an error indicating that coaching is temporarily unavailable and SHALL NOT return a partial or fabricated Coaching_Response.
8. WHILE an Authenticated Creator has submitted 10 or more coaching requests within a rolling 60-second window, THE API SHALL reject further coaching requests with a rate-limit error until the window resets.

### Requirement 11: Creator pre-publish coaching — advisory-only nature

**User Story:** As a Creator, I want the coaching to be purely advisory so that I am never blocked from publishing by the system and the system never judges me.

#### Acceptance Criteria

1. THE Coaching_Response SHALL be informational only and SHALL NOT contain any instruction to block, prevent, delay, or gate the Creator's publishing action.
2. THE Coaching_Response SHALL NOT assign any rating, score, label, or reliability classification to the Creator as a person, author, or channel.
3. THE Coaching_Response SHALL NOT include any content-truthfulness verdict (such as "true", "false", "misleading") on the Draft as a whole or on any individual claim within the Draft; identified issues SHALL be framed exclusively in terms of framing-technique presence or absence of supporting evidence.
4. THE Coaching_Response SHALL present each identified issue as a suggestion using advisory language (such as "consider", "you might", "this could be perceived as") and SHALL NOT use imperative or mandatory language (such as "you must", "do not", "fix this", "change this").
5. THE Coaching_Engine SHALL NOT persist the submitted Draft, the Coaching_Response, or any association between the Creator's identity and the coaching interaction beyond the HTTP response being sent to the client; this prohibition includes application logs, telemetry spans, and any durable storage, though transient in-process memory during request handling is permitted.
6. THE Coaching_Engine SHALL NOT feed the submitted Draft into the analysis pipeline or create a Report from the Draft.
7. IF the Coaching_Engine encounters an internal error during Draft analysis, THEN THE API SHALL respond with HTTP 500 and a message indicating that coaching is temporarily unavailable, SHALL NOT persist the Draft, and SHALL NOT prevent the Creator from proceeding with their publishing workflow.

### Requirement 12: Creator pre-publish coaching — trust gate dependency

**User Story:** As a product owner, I want creator coaching gated on trust metrics, so that we only offer proactive guidance when the engine's precision has been proven.

#### Acceptance Criteria

1. WHILE the Coaching_Engine Trust_Gate is not satisfied, THE API SHALL respond to coaching requests with HTTP 503 and a response body containing a message indicating that coaching is not yet available.
2. THE Coaching_Engine Trust_Gate SHALL require that Citation_Coverage exceeds a configured threshold AND that Model_Human_Agreement exceeds a configured threshold AND that a legal review completion flag for creator coaching is set to true; each threshold SHALL accept a value in the range 0.0 to 1.0 inclusive and SHALL default to 0.0 when not explicitly configured.
3. WHEN the Coaching_Engine Trust_Gate transitions from not-satisfied to satisfied, THE API SHALL begin accepting coaching requests within 60 seconds of the transition without requiring a deployment or restart.
4. THE Trust_Gate thresholds for the Coaching_Engine SHALL be configurable independently of the thresholds for the Feed_Friction_Dial and the Institutional_API.
5. IF the Coaching_Engine Trust_Gate was previously satisfied and a subsequent evaluation finds that Citation_Coverage or Model_Human_Agreement has dropped below its configured threshold, THEN THE API SHALL revert to responding with HTTP 503 to coaching requests within 60 seconds of the evaluation detecting the regression.
6. THE API SHALL re-evaluate the Coaching_Engine Trust_Gate at a configured interval of no more than 60 seconds and SHALL read the trust metric values from the observability-derived KPI store and the legal review flag from a configuration source without hard-coding passing values.

### Requirement 13: Invariant gate and analysis pipeline untouched

**User Story:** As a maintainer, I want this feature to leave the analysis pipeline and its invariant gate unchanged, so that the codified moat is preserved by construction.

#### Acceptance Criteria

1. THE feature SHALL produce a zero-byte diff on `core/assemble.ts` when compared against the branch point commit of this feature branch.
2. THE feature SHALL consume the readiness state (`ready` or `needs_review`) exactly as assigned by the Invariant_Gate and SHALL NOT recompute, override, upgrade, or downgrade it.
3. WHEN the Feed_Friction_Dial serves overlay data, the Institutional_API returns query results, or the Coaching_Engine analyzes a Draft, THE persisted analysis report row in the `analysis_reports` table — including its claims, citations, framing signals, and readiness state — SHALL remain byte-for-byte unchanged.
4. THE feature SHALL NOT add, remove, reorder, or modify any of the five pipeline stages (transcript, extraction, claim verification, perspectives, assemble+gate) defined in `pipeline/stages.ts` that produce or gate a Report.
5. THE Coaching_Engine SHALL NOT write to, modify, or create entries in the Report_Graph, the `analysis_reports` table, or any table written by the pipeline stages (`analysis_reports`, `report_graph`, `audit_records`).
6. IF a code change in this feature touches `core/assemble.ts` or `pipeline/stages.ts`, THEN the CI gate SHALL fail the build with an error indicating that the invariant-protected files were modified.

### Requirement 14: Persistence and data layer conventions

**User Story:** As a maintainer, I want new persistence to go through Repository methods and additive schema only, so that the data layer stays consistent and the offline-first path keeps working.

#### Acceptance Criteria

1. THE route handlers SHALL contain no direct database queries for API_Key, Rate_Limit, or Trust_Gate operations and SHALL perform every such read and write through Repository methods.
2. THE Repository SHALL provide the new persistence operations in both the in-memory implementation and the Postgres implementation, returning the same TypeScript return type with identical field values, field ordering, and array sort order for identical inputs.
3. WHERE a new migration changes the schema, THE migration SHALL only add schema objects, SHALL preserve every pre-existing row, and SHALL leave every pre-existing route's request and response shape unchanged.
4. THE new migration SHALL use a zero-padded three-digit numeric prefix that sorts lexically after 007 and SHALL apply in lexical filename order after the latest existing migration file.
5. THE Postgres Repository SHALL use parameterized SQL with no string interpolation of input values for every new operation.
6. WHILE the server runs with the in-memory Repository and no API keys, THE API_Key management, rate-limit tracking, and Trust_Gate evaluation operations SHALL return successful responses with default or empty values and SHALL not throw, reject, or produce error-level log output.
7. THE Institutional_API's read-only access to the Report_Graph SHALL go through existing Repository methods for claim, citation, and perspective_link queries.
8. IF the Postgres Repository encounters a database error during a new API_Key, Rate_Limit, or Trust_Gate operation, THEN THE Repository method SHALL propagate the error to the caller without silently swallowing it, and THE route handler SHALL respond with an error indication and SHALL not persist partial state.

### Requirement 15: Compass neutrality across all capabilities

**User Story:** As a Reader, Creator, or institutional consumer, I want every surface of this feature to remain a lens and not a judge, so that no intervention implies a verdict on content or a rating of a creator.

#### Acceptance Criteria

1. WHEN the Feed_Friction_Dial, the Institutional_API, or the Coaching_Engine returns data, THE response SHALL NOT include any field whose name or string value expresses a content-truthfulness verdict (including terms such as "truthVerdict", "isTrue", "isFalse", "accuracyRating", "veracity", or "isDisinformation").
2. WHEN the Feed_Friction_Dial, the Institutional_API, or the Coaching_Engine returns data, THE response SHALL NOT include any field that fuses a person-identity token (creator, author, channel, person) with a rating-dimension token (reliability, credibility, trust, tier, rating) in the same key name, nor co-locate a rating-dimension key and a person-identity key in the same response object.
3. WHERE source-reliability tiers appear in any response from the Feed_Friction_Dial, the Institutional_API, or the Coaching_Engine, THE tier SHALL be attached to a source or citation identifier only, and SHALL NOT appear in a response object that also contains a creator, author, person, or channel identifier.
4. THE Coaching_Response SHALL frame every identified issue exclusively by naming the framing technique used and quoting the relevant evidence span from the Draft, and SHALL NOT reference the Creator's publishing history, reputation, prior accuracy, or aggregate track record.
5. THE Institutional_API schema SHALL NOT expose any field, type, or query that returns a creator-reliability rating or associates a reliability metric with a person or channel.
6. THE Feed_Friction_Dial, the Institutional_API, and the Coaching_Engine SHALL NOT persist, compute, or return any per-creator profile, historical accuracy aggregate, or score derived from a creator's prior content.
7. IF a response payload from the Feed_Friction_Dial, the Institutional_API, or the Coaching_Engine fails the neutrality guard (contains a content-truthfulness verdict or a person-attached reliability dimension), THEN THE system SHALL withhold the offending payload entirely and SHALL NOT deliver it to the consumer.
8. THE neutrality guard SHALL be total over any input shape (including null, undefined, primitives, arrays, deeply nested objects, and cyclic references) and SHALL NOT throw an exception for any input.

### Requirement 16: Accessibility and web conventions for extension overlay

**User Story:** As a Reader using assistive technology, I want the feed friction overlay to be accessible, so that the inoculation benefit is inclusive.

#### Acceptance Criteria

1. WHEN the Extension renders a Friction_Overlay, THE Friction_Overlay SHALL expose an accessible name and ARIA role on every interactive element (dismiss button, learn-more link, intensity controls).
2. WHEN a Reader navigates the Friction_Overlay using only a keyboard, THE Extension SHALL make every interactive control reachable through Tab/Shift+Tab in logical reading order and activatable via Enter or Space, and SHALL render a visible focus indicator (minimum 2 css-px outline) on the currently focused control.
3. WHERE a color or icon conveys state in the Friction_Overlay, THE Extension SHALL display an adjacent visible text label that conveys the same state.
4. WHEN the Friction_Overlay appears on a feed item, THE Extension SHALL announce its presence through an ARIA live region with politeness level `polite` so assistive technologies notify the Reader without requiring focus change and without interrupting current speech output.
5. WHEN a Reader dismisses the Friction_Overlay, THE Extension SHALL return keyboard focus to the feed item that triggered the overlay within 100 milliseconds of the dismiss action completing.
6. THE Friction_Overlay SHALL maintain a minimum contrast ratio of 4.5:1 for normal text (below 18pt regular or below 14pt bold) and 3:1 for large text (at or above 18pt regular or at or above 14pt bold) against its background, consistent with WCAG 2.2 AA.
7. WHILE the Intervention_Intensity is set to `interruptive`, THE Extension SHALL constrain keyboard focus within the Friction_Overlay (Tab/Shift+Tab cycle among its interactive elements only) until the Reader dismisses or expands the overlay.
