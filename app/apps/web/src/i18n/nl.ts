// Dutch Message_Catalog for f-Socials.
// Typed against the English catalog so a missing or extra key is a tsc error.
// Values may contain {placeholder} tokens for runtime substitution.
// No value may state a verdict on truthfulness or attach a reliability rating
// to a creator/author/person/channel.

import type { EnCatalog } from './en';

export const nl: { [K in keyof EnCatalog]: string } = {
  // -- Home -------------------------------------------------------------------
  'home.heading': 'Onderzoek voordat je reageert.',
  'home.description':
    'Plak een YouTube-link, artikel-URL of transcript. We laten zien hoe de inhoud is opgebouwd — de beweringen, framing, weglatingen en andere geloofwaardige invalshoeken — zodat je zelf kunt bepalen wat je ervan vindt.',
  'home.placeholder': 'Plak een YouTube-link, artikel-URL of transcript…',
  'home.analyze': 'Analyseer',
  'home.neutralityHint': 'Het beoordeelt beweringen en citeert bronnen — het verklaart nooit iets "waar" of "onwaar".',
  'home.examplesHeading': 'Of probeer een voorbeeld',
  'home.example.deepsea.title': 'Diepzeemijnbouw-monoloog',
  'home.example.deepsea.blurb': 'Een overtuigende clip die betoogt dat zeebodemwinning "impactvrij" is.',
  'home.example.conspiracy.title': 'Complotdenkend betoog',
  'home.example.conspiracy.blurb': 'Vermengt bekende onjuiste beweringen met geladen retoriek.',

  // -- Loading ----------------------------------------------------------------
  'loading.analyzing': 'Bezig met analyseren — {status}',
  'loading.step.transcript': 'Transcript ophalen',
  'loading.step.claims': 'Beweringen en framing extraheren',
  'loading.step.evidence': 'Bewijs controleren',
  'loading.step.perspectives': 'Andere perspectieven zoeken',
  'loading.step.assembling': 'Rapport samenstellen',

  // -- Error ------------------------------------------------------------------
  'error.retry': 'Opnieuw',
  'error.back': 'Terug',

  // -- Report: section titles -------------------------------------------------
  'report.backAnalyzeOwn': 'Eigen inhoud analyseren',
  'report.backAnalyzeAnother': 'Andere inhoud analyseren',
  'report.defaultTitle': 'Analyserapport',
  'report.section.summary': 'Samenvatting',
  'report.section.claims': 'Beweringenregister',
  'report.section.framing': 'Framingsignalen',
  'report.section.context': 'Nuttige context',
  'report.section.perspectives': 'Andere invalshoeken',
  'report.section.issueFrame': 'Positie in het debat',

  // -- Report: counts ---------------------------------------------------------
  'report.counts.claims': '{n} beweringen',
  'report.counts.framingSignals': '{n} framingsignalen',

  // -- Report: controls -------------------------------------------------------
  'report.save': 'Opslaan',
  'report.save.saving': 'Opslaan…',
  'report.save.saved': 'Opgeslagen',
  'report.save.error': 'Het opslaan is niet gelukt. Probeer het opnieuw.',
  'report.share': 'Delen',
  'report.share.copied': 'Gekopieerd',
  'report.flag': 'Markeer deze techniek',
  'report.flag.flagging': 'Markeren…',
  'report.flag.error': 'Die actie is niet vastgelegd. Probeer het opnieuw.',
  'report.dispute': 'Betwist deze analyse',

  // -- Report: status banners -------------------------------------------------
  'report.status.needsReview':
    'Deze analyse wordt vastgehouden voor menselijke beoordeling. We tonen het transparant in plaats van het te verbergen.',
  'report.status.needsReviewWithReasons':
    'Deze analyse wordt vastgehouden voor menselijke beoordeling: {reasons}. We tonen het transparant in plaats van het te verbergen.',

  // -- Report: empty states ---------------------------------------------------
  'report.empty.claims': 'Er zijn geen beweringen geëxtraheerd.',
  'report.empty.framing': 'Geen framingsignalen gedetecteerd.',
  'report.empty.context': 'Geen noemenswaardige weglatingen gesignaleerd.',
  'report.empty.perspectives': 'Geen overbruggende perspectieven gevonden.',
  'report.empty.summary': 'Geen samenvatting beschikbaar voor deze analyse.',
  'report.empty.transcript': 'Transcript niet beschikbaar.',

  // -- Report: provenance labels ----------------------------------------------
  'report.provenance.model': 'Model: {model}',
  'report.provenance.analysisVersion': 'Analyse v{version}',
  'report.provenance.sourcePolicyVersion': 'Bronbeleid {version}',
  'report.provenance.updated': 'Bijgewerkt {date}',
  'report.provenance.disputes': '{n} betwistingen',
  'report.provenance.methodology': 'Methodologie',

  // -- Report: claim detail ---------------------------------------------------
  'report.claim.whatWasSaid': 'Wat er gezegd werd',
  'report.claim.whyThisIsHere': 'Waarom dit hier staat',
  'report.claim.sources': 'Bronnen',
  'report.claim.sourcesNone': 'Bronnen — geen gevonden (wees voorzichtig)',
  'report.claim.supports': 'ondersteunt',
  'report.claim.contradicts': 'weerspreekt',

  // -- Report: framing --------------------------------------------------------
  'report.framing.severity': '{severity} ernst',
  'report.framing.topSignal': 'Belangrijkste framingsignaal',

  // -- Report: perspectives ---------------------------------------------------
  'report.perspectives.whyIncluded': 'Waarom opgenomen',
  'report.perspectives.readAngle': 'Lees deze invalshoek',

  // -- Report: issue frame ----------------------------------------------------
  'report.issueFrame.heading': 'Waar het zich bevindt (beschrijvend, geen oordeel)',
  'report.issueFrame.economic.low': 'Staat / collectief',
  'report.issueFrame.economic.high': 'Markt / individueel',
  'report.issueFrame.governance.low': 'Libertair',
  'report.issueFrame.governance.high': 'Autoritair',
  'report.issueFrame.centered': 'gecentreerd tussen {low} en {high}',
  'report.issueFrame.slightly': 'licht richting {pole}',
  'report.issueFrame.moderately': 'gematigd richting {pole}',
  'report.issueFrame.strongly': 'sterk richting {pole}',

  // -- Report: display-label maps — evidence strength -------------------------
  'report.strength.strong': 'Goed onderbouwd',
  'report.strength.moderate': 'Onderbouwd',
  'report.strength.weak': 'Beperkt onderbouwd',
  'report.strength.none': 'Geen externe verificatie',

  // -- Report: display-label maps — verifiability -----------------------------
  'report.verifiability.verifiable': 'Verifieerbaar',
  'report.verifiability.partially_verifiable': 'Deels verifieerbaar',
  'report.verifiability.opinion': 'Mening',
  'report.verifiability.unverifiable': 'Niet verifieerbaar',

  // -- Report: display-label maps — source tier (sources only, never a person) -
  'report.tier.tier1_primary': 'Rang 1 · Primair',
  'report.tier.tier2_institutional': 'Rang 2 · Institutioneel',
  'report.tier.tier3_viewpoint': 'Rang 3 · Standpunt',
  'report.tier.excluded': 'Uitgesloten',

  // -- Report: divergence -----------------------------------------------------
  'report.divergence': '{word} divergentie ({pct}%)',
  'report.divergence.low': 'lage',
  'report.divergence.moderate': 'matige',
  'report.divergence.high': 'hoge',

  // -- Report: readiness display labels ---------------------------------------
  'report.readiness.ready': 'gereed',
  'report.readiness.needs_review': 'beoordeling nodig',

  // -- Report: account unavailable banner -------------------------------------
  'report.accountUnavailable':
    'Accountfuncties zijn momenteel niet beschikbaar, dus dit rapport kan hier niet worden opgeslagen.',

  // -- Methodology ------------------------------------------------------------
  'methodology.back': 'Terug',
  'methodology.heading': 'Hoe f-Socials werkt',
  'methodology.subtitle': 'Een heldere uitleg van onze methode.',
  'methodology.unavailable':
    'De methodologiepagina is momenteel niet beschikbaar. Je rapport staat er nog.',

  // -- Dispute / Flag ---------------------------------------------------------
  'dispute.title': 'Betwist deze analyse',
  'dispute.close': 'Betwistingsformulier sluiten',
  'dispute.received': 'Bedankt — je betwisting is ontvangen en wordt beoordeeld.',
  'dispute.closeBtn': 'Sluiten',
  'dispute.note':
    'Vertel ons wat er volgens jou niet klopt aan deze analyse. Betwistingen worden anoniem vastgelegd voor latere menselijke beoordeling.',
  'dispute.label': 'Je reden',
  'dispute.placeholder': 'Wat ging er mis?',
  'dispute.cancel': 'Annuleren',
  'dispute.submit': 'Betwisting indienen',
  'dispute.submitting': 'Indienen…',

  // -- Sign-in ----------------------------------------------------------------
  'signIn.heading': 'Account',
  'signIn.unavailable':
    'Accountfuncties zijn momenteel niet beschikbaar. Je kunt nog steeds inhoud analyseren, rapporten openen en de methodologie lezen.',
  'signIn.tabSignIn': 'Inloggen',
  'signIn.tabSignUp': 'Account aanmaken',
  'signIn.email': 'E-mail',
  'signIn.password': 'Wachtwoord',
  'signIn.submitSignIn': 'Inloggen',
  'signIn.submitSignUp': 'Account aanmaken',
  'signIn.submittingSignIn': 'Inloggen…',
  'signIn.submittingSignUp': 'Account aanmaken…',
  'signIn.groupLabel': 'Kies inloggen of account aanmaken',

  // -- History ----------------------------------------------------------------
  'history.heading': 'Opgeslagen rapporten',
  'history.subtitle': 'De rapporten die je hebt opgeslagen, meest recent eerst.',
  'history.refresh': 'Vernieuwen',
  'history.refreshLabel': 'Vernieuw je opgeslagen rapporten',
  'history.loading': 'Je opgeslagen rapporten laden…',
  'history.empty':
    'Je hebt nog geen opgeslagen rapporten. Sla een rapport op vanaf de rapportpagina en het verschijnt hier.',
  'history.retry': 'Opnieuw',
  'history.back': 'Terug',
  'history.savedAt': 'Opgeslagen {date}',
  'history.openLabel': 'Open opgeslagen rapport {id}',
  'history.remove': 'Verwijderen',
  'history.removing': 'Verwijderen…',
  'history.removeLabel': 'Verwijder opgeslagen rapport {id}',
  'history.removeError': 'Het verwijderen is niet gelukt. Probeer het opnieuw.',
  'history.loaded': '{n} opgeslagen rapport{s} geladen.',
  'history.emptyStatus': 'Je hebt nog geen opgeslagen rapporten.',
  'history.removeStatus': 'Rapport verwijderd uit je opgeslagen lijst.',

  // -- Workspaces (list) ------------------------------------------------------
  'workspaces.heading': 'Werkruimtes',
  'workspaces.subtitle':
    'Gedeelde ruimtes waar je groep geanalyseerde rapporten verzamelt en bespreekt.',
  'workspaces.refresh': 'Vernieuwen',
  'workspaces.refreshLabel': 'Vernieuw je werkruimtes',
  'workspaces.loading': 'Je werkruimtes laden…',
  'workspaces.unavailable':
    'Werkruimtefuncties zijn niet beschikbaar. Inloggen is niet geconfigureerd in deze installatie, dus gedeelde werkruimtes kunnen hier niet worden aangemaakt of betreden.',
  'workspaces.empty':
    'Je bent nog geen lid van een werkruimte. Maak er hierboven een aan om rapporten te verzamelen en te bespreken met je groep.',
  'workspaces.retry': 'Opnieuw',
  'workspaces.back': 'Terug',
  'workspaces.role.owner': 'Eigenaar',
  'workspaces.role.member': 'Lid',
  'workspaces.roleLabel': 'Je rol: {role}',
  'workspaces.selected': 'Geselecteerd',
  'workspaces.openLabel': 'Open werkruimte {name}',
  'workspaces.create.heading': 'Maak een werkruimte',
  'workspaces.create.placeholder': 'Naam van werkruimte',
  'workspaces.create.nameLabel': 'Naam nieuwe werkruimte',
  'workspaces.create.submit': 'Aanmaken',
  'workspaces.create.creating': 'Aanmaken…',
  'workspaces.create.submitLabel': 'Werkruimte aanmaken',
  'workspaces.create.success': 'Werkruimte "{name}" aangemaakt. Je staat als {role}.',
  'workspaces.redeem.heading': 'Deelnemen met een uitnodigingscode',
  'workspaces.redeem.placeholder': 'Uitnodigingscode',
  'workspaces.redeem.codeLabel': 'Uitnodigingscode',
  'workspaces.redeem.submit': 'Deelnemen',
  'workspaces.redeem.joining': 'Deelnemen…',
  'workspaces.redeem.submitLabel': 'Uitnodiging inwisselen',
  'workspaces.redeem.success': 'Uitnodiging ingewisseld. Je bent lid van de werkruimte.',
  'workspaces.loaded': '{n} werkruimte{s} geladen.',
  'workspaces.emptyStatus': 'Je bent nog geen lid van een werkruimte.',

  // -- Workspaces (detail) ----------------------------------------------------
  'workspaces.detail.heading': 'Werkruimte',
  'workspaces.detail.subtitle':
    'Gedeelde leden, collecties en notities — je bent {role}.',
  'workspaces.detail.subtitleNoRole': 'Gedeelde leden, collecties en notities.',
  'workspaces.detail.refresh': 'Vernieuwen',
  'workspaces.detail.refreshLabel': 'Vernieuw deze werkruimte',
  'workspaces.detail.loading': 'Werkruimte laden…',
  'workspaces.detail.backLabel': 'Terug naar je werkruimtes',
  'workspaces.detail.back': 'Terug',
  'workspaces.detail.retry': 'Opnieuw',
  'workspaces.detail.forbidden':
    'Je hebt geen toegang tot deze werkruimte. Vraag een eigenaar om een uitnodiging.',
  'workspaces.detail.members': 'Leden ({n})',
  'workspaces.detail.removeMember': 'Verwijderen',
  'workspaces.detail.removingMember': 'Verwijderen…',
  'workspaces.detail.removeMemberLabel': 'Verwijder lid {id}',
  'workspaces.detail.memberRemoved': 'Lid verwijderd uit de werkruimte.',
  'workspaces.detail.collections': 'Collecties ({n})',
  'workspaces.detail.collectionsEmpty': 'Nog geen collecties. Maak er een aan om rapporten te beheren.',
  'workspaces.detail.createCollection': 'Aanmaken',
  'workspaces.detail.creatingCollection': 'Aanmaken…',
  'workspaces.detail.createCollectionLabel': 'Collectie aanmaken',
  'workspaces.detail.collectionNameLabel': 'Naam nieuwe collectie',
  'workspaces.detail.collectionNamePlaceholder': 'Naam nieuwe collectie',
  'workspaces.detail.collectionCreated': 'Collectie "{name}" aangemaakt.',
  'workspaces.detail.collectionDeleted': 'Collectie verwijderd.',
  'workspaces.detail.deleteCollection': 'Verwijderen',
  'workspaces.detail.deletingCollection': 'Verwijderen…',
  'workspaces.detail.deleteCollectionLabel': 'Verwijder collectie {name}',
  'workspaces.detail.addReport': 'Toevoegen',
  'workspaces.detail.addingReport': 'Toevoegen…',
  'workspaces.detail.addReportLabel': 'Voeg rapport toe aan {name}',
  'workspaces.detail.addReportPlaceholder': 'Rapport-id om toe te voegen',
  'workspaces.detail.addReportInputLabel': 'Rapport-id om toe te voegen aan {name}',
  'workspaces.detail.reportAdded': 'Rapport toegevoegd aan de collectie.',
  'workspaces.detail.reportRemoved': 'Rapport verwijderd uit de collectie.',
  'workspaces.detail.removeReport': 'Verwijderen',
  'workspaces.detail.removingReport': 'Verwijderen…',
  'workspaces.detail.removeReportLabel': 'Verwijder rapport {id} uit de collectie',
  'workspaces.detail.addedAt': 'Toegevoegd {date}',
  'workspaces.detail.notes': 'Notities',
  'workspaces.detail.showNotesLabel': 'Toon notities voor rapport {id}',
  'workspaces.detail.hideNotesLabel': 'Verberg notities voor rapport {id}',
  'workspaces.detail.noReportsInCollection': 'Nog geen rapporten in deze collectie.',
  'workspaces.detail.loadingReports': 'Rapporten laden…',
  'workspaces.detail.loadingNotes': 'Notities laden…',
  'workspaces.detail.noNotes': 'Nog geen notities. Wees de eerste om er een toe te voegen.',
  'workspaces.detail.addNote': 'Notitie toevoegen',
  'workspaces.detail.addingNote': 'Toevoegen…',
  'workspaces.detail.addNoteLabel': 'Notitie toevoegen',
  'workspaces.detail.addNotePlaceholder': 'Voeg een notitie toe voor je groep…',
  'workspaces.detail.addNoteInputLabel': 'Voeg een notitie toe aan rapport {id}',
  'workspaces.detail.noteAdded': 'Notitie toegevoegd.',
  'workspaces.detail.noteUpdated': 'Notitie bijgewerkt.',
  'workspaces.detail.noteDeleted': 'Notitie verwijderd.',
  'workspaces.detail.editNote': 'Bewerken',
  'workspaces.detail.saveNote': 'Opslaan',
  'workspaces.detail.savingNote': 'Opslaan…',
  'workspaces.detail.cancelEdit': 'Annuleren',
  'workspaces.detail.deleteNote': 'Verwijderen',
  'workspaces.detail.deletingNote': 'Verwijderen…',
  'workspaces.detail.deleteNoteLabel': 'Verwijder deze notitie',
  'workspaces.detail.loaded': '{members} lid/leden en {collections} collectie{cs} geladen.',

  // -- Header -----------------------------------------------------------------
  'header.signIn': 'Inloggen',
  'header.signOut': 'Uitloggen',
  'header.savedReports': 'Opgeslagen rapporten',
  'header.workspaces': 'Werkruimtes',
  'header.toggleTheme': 'Thema wisselen',
  'header.signOutWarning':
    'Je bent uitgelogd op dit apparaat, maar de sessie op afstand kan nog actief zijn.',

  // -- Language selector ------------------------------------------------------
  'lang.label': 'Taal',
  'lang.en': 'English',
  'lang.nl': 'Nederlands',
} as const;
