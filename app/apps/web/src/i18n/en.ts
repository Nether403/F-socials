// Canonical English Message_Catalog for f-Socials.
// Every UI_Chrome String_Key lives here; the Dutch catalog (nl.ts) is typed against
// this shape so a missing/extra key is a tsc error. Values may contain {placeholder}
// tokens for runtime substitution. No value may state a verdict on truthfulness or
// attach a reliability rating to a creator/author/person/channel.

export const en = {
  // -- Home -------------------------------------------------------------------
  'home.heading': 'Inspect before you react.',
  'home.description':
    'Paste a YouTube link, article URL, or transcript. We show how the content is built — its claims, framing, omissions, and other credible angles — so you can decide what to think.',
  'home.placeholder': 'Paste a YouTube link, article URL, or transcript…',
  'home.analyze': 'Analyze',
  'home.neutralityHint': 'It assesses claims and cites sources — it never declares "true" or "false".',
  'home.examplesHeading': 'Or try an example',
  'home.example.deepsea.title': 'Deep-sea mining monologue',
  'home.example.deepsea.blurb': 'A persuasive clip arguing seabed mining is "impact-free".',
  'home.example.conspiracy.title': 'Conspiracy-laden rant',
  'home.example.conspiracy.blurb': 'Mixes well-known false claims with charged rhetoric.',

  // -- Loading ----------------------------------------------------------------
  'loading.analyzing': 'Analyzing — {status}',
  'loading.step.transcript': 'Acquiring transcript',
  'loading.step.claims': 'Extracting claims & framing',
  'loading.step.evidence': 'Checking evidence',
  'loading.step.perspectives': 'Finding other perspectives',
  'loading.step.assembling': 'Assembling report',

  // -- Error ------------------------------------------------------------------
  'error.retry': 'Retry',
  'error.back': 'Back',

  // -- Report: section titles -------------------------------------------------
  'report.backAnalyzeOwn': 'Analyze your own',
  'report.backAnalyzeAnother': 'Analyze another',
  'report.defaultTitle': 'Analysis report',
  'report.section.summary': 'Summary',
  'report.section.claims': 'Claim Ledger',
  'report.section.framing': 'Framing Signals',
  'report.section.context': 'Useful Context',
  'report.section.perspectives': 'Other Angles',
  'report.section.issueFrame': 'Issue-Frame Position',

  // -- Report: counts ---------------------------------------------------------
  'report.counts.claims': '{n} claims',
  'report.counts.framingSignals': '{n} framing signals',

  // -- Report: controls -------------------------------------------------------
  'report.save': 'Save',
  'report.save.saving': 'Saving…',
  'report.save.saved': 'Saved',
  'report.save.error': 'The save did not complete. Please try again.',
  'report.share': 'Share',
  'report.share.copied': 'Copied',
  'report.flag': 'Flag this technique',
  'report.flag.flagging': 'Flagging…',
  'report.flag.error': 'That action was not recorded. Please try again.',
  'report.dispute': 'Dispute this analysis',

  // -- Report: status banners -------------------------------------------------
  'report.status.needsReview':
    'This analysis is held for human review. Showing it transparently rather than hiding it.',
  'report.status.needsReviewWithReasons':
    'This analysis is held for human review: {reasons}. Showing it transparently rather than hiding it.',

  // -- Report: empty states ---------------------------------------------------
  'report.empty.claims': 'No claims were extracted.',
  'report.empty.framing': 'No framing signals detected.',
  'report.empty.context': 'No notable omissions flagged.',
  'report.empty.perspectives': 'No bridging perspectives found.',
  'report.empty.summary': 'No summary available for this analysis.',
  'report.empty.transcript': 'Transcript not available.',

  // -- Report: provenance labels ----------------------------------------------
  'report.provenance.model': 'Model: {model}',
  'report.provenance.analysisVersion': 'Analysis v{version}',
  'report.provenance.sourcePolicyVersion': 'Source policy {version}',
  'report.provenance.updated': 'Updated {date}',
  'report.provenance.disputes': '{n} disputes',
  'report.provenance.methodology': 'Methodology',

  // -- Report: claim detail ---------------------------------------------------
  'report.claim.whatWasSaid': 'What was said',
  'report.claim.whyThisIsHere': 'Why this is here',
  'report.claim.sources': 'Sources',
  'report.claim.sourcesNone': 'Sources — none found (treat with caution)',
  'report.claim.supports': 'supports',
  'report.claim.contradicts': 'contradicts',

  // -- Report: framing --------------------------------------------------------
  'report.framing.severity': '{severity} severity',
  'report.framing.topSignal': 'Most important framing signal',

  // -- Report: perspectives ---------------------------------------------------
  'report.perspectives.whyIncluded': 'Why included',
  'report.perspectives.readAngle': 'Read this angle',

  // -- Report: issue frame ----------------------------------------------------
  'report.issueFrame.heading': 'Where it sits (descriptive, not a verdict)',
  'report.issueFrame.economic.low': 'State / collective',
  'report.issueFrame.economic.high': 'Market / individual',
  'report.issueFrame.governance.low': 'Libertarian',
  'report.issueFrame.governance.high': 'Authoritarian',
  'report.issueFrame.centered': 'centered between {low} and {high}',
  'report.issueFrame.slightly': 'slightly toward {pole}',
  'report.issueFrame.moderately': 'moderately toward {pole}',
  'report.issueFrame.strongly': 'strongly toward {pole}',

  // -- Report: display-label maps — evidence strength -------------------------
  'report.strength.strong': 'Well-sourced',
  'report.strength.moderate': 'Sourced',
  'report.strength.weak': 'Lightly sourced',
  'report.strength.none': 'No external review',

  // -- Report: display-label maps — verifiability -----------------------------
  'report.verifiability.verifiable': 'Verifiable',
  'report.verifiability.partially_verifiable': 'Partly verifiable',
  'report.verifiability.opinion': 'Opinion',
  'report.verifiability.unverifiable': 'Unverifiable',

  // -- Report: display-label maps — source tier (sources only, never a person) -
  'report.tier.tier1_primary': 'Tier 1 · Primary',
  'report.tier.tier2_institutional': 'Tier 2 · Institutional',
  'report.tier.tier3_viewpoint': 'Tier 3 · Viewpoint',
  'report.tier.excluded': 'Excluded',

  // -- Report: divergence -----------------------------------------------------
  'report.divergence': '{word} divergence ({pct}%)',
  'report.divergence.low': 'low',
  'report.divergence.moderate': 'moderate',
  'report.divergence.high': 'high',

  // -- Report: readiness display labels ---------------------------------------
  'report.readiness.ready': 'ready',
  'report.readiness.needs_review': 'needs review',

  // -- Report: account unavailable banner -------------------------------------
  'report.accountUnavailable':
    'Account features are unavailable right now, so this report cannot be saved here.',

  // -- Methodology ------------------------------------------------------------
  'methodology.back': 'Back',
  'methodology.heading': 'How f-Socials works',
  'methodology.subtitle': 'A plain-language explanation of our method.',
  'methodology.unavailable':
    'The methodology page is unavailable right now. Your report is still here.',

  // -- Dispute / Flag ---------------------------------------------------------
  'dispute.title': 'Dispute this analysis',
  'dispute.close': 'Close dispute form',
  'dispute.received': 'Thanks — your dispute was received and will be reviewed.',
  'dispute.closeBtn': 'Close',
  'dispute.note':
    'Tell us what you think is wrong with this analysis. Disputes are recorded anonymously for later human review.',
  'dispute.label': 'Your reason',
  'dispute.placeholder': 'What did we get wrong?',
  'dispute.cancel': 'Cancel',
  'dispute.submit': 'Submit dispute',
  'dispute.submitting': 'Submitting…',

  // -- Sign-in ----------------------------------------------------------------
  'signIn.heading': 'Account',
  'signIn.unavailable':
    'Account features are unavailable right now. You can still analyze content, open reports, and read the methodology.',
  'signIn.tabSignIn': 'Sign in',
  'signIn.tabSignUp': 'Create account',
  'signIn.email': 'Email',
  'signIn.password': 'Password',
  'signIn.submitSignIn': 'Sign in',
  'signIn.submitSignUp': 'Create account',
  'signIn.submittingSignIn': 'Signing in…',
  'signIn.submittingSignUp': 'Creating account…',
  'signIn.groupLabel': 'Choose sign in or create account',

  // -- History ----------------------------------------------------------------
  'history.heading': 'Saved reports',
  'history.subtitle': 'The reports you have saved, most recently saved first.',
  'history.refresh': 'Refresh',
  'history.refreshLabel': 'Refresh your saved reports',
  'history.loading': 'Loading your saved reports…',
  'history.empty':
    'You have no saved reports yet. Save a report from its page and it will appear here.',
  'history.retry': 'Retry',
  'history.back': 'Back',
  'history.savedAt': 'Saved {date}',
  'history.openLabel': 'Open saved report {id}',
  'history.remove': 'Remove',
  'history.removing': 'Removing…',
  'history.removeLabel': 'Remove saved report {id}',
  'history.removeError': 'The removal did not complete. Please try again.',
  'history.loaded': 'Loaded {n} saved report{s}.',
  'history.emptyStatus': 'You have no saved reports yet.',
  'history.removeStatus': 'Report removed from your saved list.',

  // -- Workspaces (list) ------------------------------------------------------
  'workspaces.heading': 'Workspaces',
  'workspaces.subtitle':
    'Shared spaces where your group collects and discusses analyzed reports.',
  'workspaces.refresh': 'Refresh',
  'workspaces.refreshLabel': 'Refresh your workspaces',
  'workspaces.loading': 'Loading your workspaces…',
  'workspaces.unavailable':
    'Workspace features are unavailable. Sign-in is not configured in this deployment, so shared workspaces cannot be created or joined here.',
  'workspaces.empty':
    'You are not a member of any workspace yet. Create one above to start collecting and discussing reports with your group.',
  'workspaces.retry': 'Retry',
  'workspaces.back': 'Back',
  'workspaces.role.owner': 'Owner',
  'workspaces.role.member': 'Member',
  'workspaces.roleLabel': 'Your role: {role}',
  'workspaces.selected': 'Selected',
  'workspaces.openLabel': 'Open workspace {name}',
  'workspaces.create.heading': 'Create a workspace',
  'workspaces.create.placeholder': 'Workspace name',
  'workspaces.create.nameLabel': 'New workspace name',
  'workspaces.create.submit': 'Create',
  'workspaces.create.creating': 'Creating…',
  'workspaces.create.submitLabel': 'Create workspace',
  'workspaces.create.success': 'Workspace "{name}" created. You are listed as {role}.',
  'workspaces.redeem.heading': 'Join with an invite code',
  'workspaces.redeem.placeholder': 'Invite code',
  'workspaces.redeem.codeLabel': 'Invite code',
  'workspaces.redeem.submit': 'Join',
  'workspaces.redeem.joining': 'Joining…',
  'workspaces.redeem.submitLabel': 'Redeem invite',
  'workspaces.redeem.success': 'Invite redeemed. You joined the workspace.',
  'workspaces.loaded': 'Loaded {n} workspace{s}.',
  'workspaces.emptyStatus': 'You are not a member of any workspace yet.',

  // -- Workspaces (detail) ----------------------------------------------------
  'workspaces.detail.heading': 'Workspace',
  'workspaces.detail.subtitle':
    'Shared members, collections, and notes — you are {role}.',
  'workspaces.detail.subtitleNoRole': 'Shared members, collections, and notes.',
  'workspaces.detail.refresh': 'Refresh',
  'workspaces.detail.refreshLabel': 'Refresh this workspace',
  'workspaces.detail.loading': 'Loading the workspace…',
  'workspaces.detail.backLabel': 'Back to your workspaces',
  'workspaces.detail.back': 'Back',
  'workspaces.detail.retry': 'Retry',
  'workspaces.detail.forbidden':
    'You do not have access to this workspace. Ask an owner for an invite to join.',
  'workspaces.detail.members': 'Members ({n})',
  'workspaces.detail.removeMember': 'Remove',
  'workspaces.detail.removingMember': 'Removing…',
  'workspaces.detail.removeMemberLabel': 'Remove member {id}',
  'workspaces.detail.memberRemoved': 'Member removed from the workspace.',
  'workspaces.detail.collections': 'Collections ({n})',
  'workspaces.detail.collectionsEmpty': 'No collections yet. Create one to start curating reports.',
  'workspaces.detail.createCollection': 'Create',
  'workspaces.detail.creatingCollection': 'Creating…',
  'workspaces.detail.createCollectionLabel': 'Create collection',
  'workspaces.detail.collectionNameLabel': 'New collection name',
  'workspaces.detail.collectionNamePlaceholder': 'New collection name',
  'workspaces.detail.collectionCreated': 'Collection "{name}" created.',
  'workspaces.detail.collectionDeleted': 'Collection deleted.',
  'workspaces.detail.deleteCollection': 'Delete',
  'workspaces.detail.deletingCollection': 'Deleting…',
  'workspaces.detail.deleteCollectionLabel': 'Delete collection {name}',
  'workspaces.detail.addReport': 'Add',
  'workspaces.detail.addingReport': 'Adding…',
  'workspaces.detail.addReportLabel': 'Add report to {name}',
  'workspaces.detail.addReportPlaceholder': 'Report id to add',
  'workspaces.detail.addReportInputLabel': 'Report id to add to {name}',
  'workspaces.detail.reportAdded': 'Report added to the collection.',
  'workspaces.detail.reportRemoved': 'Report removed from the collection.',
  'workspaces.detail.removeReport': 'Remove',
  'workspaces.detail.removingReport': 'Removing…',
  'workspaces.detail.removeReportLabel': 'Remove report {id} from the collection',
  'workspaces.detail.addedAt': 'Added {date}',
  'workspaces.detail.notes': 'Notes',
  'workspaces.detail.showNotesLabel': 'Show notes for report {id}',
  'workspaces.detail.hideNotesLabel': 'Hide notes for report {id}',
  'workspaces.detail.noReportsInCollection': 'No reports in this collection yet.',
  'workspaces.detail.loadingReports': 'Loading reports…',
  'workspaces.detail.loadingNotes': 'Loading notes…',
  'workspaces.detail.noNotes': 'No notes yet. Be the first to add one.',
  'workspaces.detail.addNote': 'Add note',
  'workspaces.detail.addingNote': 'Adding…',
  'workspaces.detail.addNoteLabel': 'Add note',
  'workspaces.detail.addNotePlaceholder': 'Add a note for your group…',
  'workspaces.detail.addNoteInputLabel': 'Add a note to report {id}',
  'workspaces.detail.noteAdded': 'Note added.',
  'workspaces.detail.noteUpdated': 'Note updated.',
  'workspaces.detail.noteDeleted': 'Note deleted.',
  'workspaces.detail.editNote': 'Edit',
  'workspaces.detail.saveNote': 'Save',
  'workspaces.detail.savingNote': 'Saving…',
  'workspaces.detail.cancelEdit': 'Cancel',
  'workspaces.detail.deleteNote': 'Delete',
  'workspaces.detail.deletingNote': 'Deleting…',
  'workspaces.detail.deleteNoteLabel': 'Delete this note',
  'workspaces.detail.loaded': 'Loaded {members} member{ms} and {collections} collection{cs}.',

  // -- Header -----------------------------------------------------------------
  'header.signIn': 'Sign in',
  'header.signOut': 'Sign out',
  'header.savedReports': 'Saved reports',
  'header.workspaces': 'Workspaces',
  'header.toggleTheme': 'Toggle theme',
  'header.signOutWarning':
    'You are signed out on this device, but the remote session may still be active.',

  // -- Language selector ------------------------------------------------------
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.nl': 'Dutch',
} as const;

export type EnCatalog = typeof en;
