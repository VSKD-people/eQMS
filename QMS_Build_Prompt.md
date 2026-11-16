# Build Prompt: Electronic Quality Management System (eQMS) — Web + Mobile, ISO/IEC 27001-aligned

> **How to use this prompt:** Paste everything below the line into your AI coding tool (e.g. Claude Code). Before pasting, fill in every `[CONFIRM: …]` placeholder — they mark decisions I could not make for you. The agent is instructed to produce an architecture and plan for your approval before writing code.

---

## 1. Your role and how to work

You are a senior full-stack engineer and security architect. You are building a production-grade electronic Quality Management System (eQMS) that runs as a **responsive web app** and as **installable iOS and Android apps**.

Work in this order and **stop for my approval after each of steps 1–3**:

1. **Architecture & plan** — system diagram, tech stack confirmation, data model (ERD), workflow engine design, security architecture, and a phased delivery plan.
2. **Design system & key screens** — tokens, components, and low-fidelity layouts for: Home/My Work, Document detail, Change Request detail, CAPA detail, Training, Analytics, and the mobile equivalents.
3. **Threat model** — STRIDE-style threat model for the system and the control mapping in Section 10, flagging any requirement you cannot meet.
4. **Build** — phase by phase (Section 13), with tests, migrations, seed data, and docs for each phase.

Rules:
- Do not invent library functions or API methods. If you are unsure an API exists or how it behaves, say so and check the current official documentation before using it.
- Do not mark anything as "ISO 27001 compliant." Software cannot be certified; an organisation's ISMS is. Describe features as "supports control X" and produce evidence I can give an auditor.
- When a requirement is ambiguous, ask me rather than assume.

## 2. Product context

- **Organisation:** [CONFIRM: company name]
- **Who uses it:** [CONFIRM: approximate number of users and sites/entities]
- **Quality standard(s) the QMS must support:** [CONFIRM: e.g. ISO 9001, ISO 22000 / FSSC 22000, GMP, ISO 13485 — or none yet]
- **Information security standard:** ISO/IEC 27001:2022 (the organisation intends to run this system inside its ISMS scope).
- **Data protection law(s):** [CONFIRM: e.g. Philippines Data Privacy Act of 2012, Bahamas Data Protection Act, GDPR if EU personal data is processed]
- **Hosting region / data residency:** [CONFIRM]
- **Single sign-on provider:** [CONFIRM: we use Microsoft 365 (Outlook, Teams, SharePoint), so Microsoft Entra ID is the likely choice — confirm with IT]

The goal: one connected system where controlled documents, training, change control, periodic reviews, quality events and CAPA are linked, every action is attributable and time-stamped, and leadership can see quality performance at a glance.

## 3. Users and roles (RBAC)

Implement role-based access control with least privilege by default. Roles are configurable; ship these defaults:

| Role | Can do |
|---|---|
| System Administrator | Users, roles, settings, templates, integrations. **Cannot** approve quality records by default (segregation of duties). |
| Quality Manager | Owns workflows, configures training rules and review schedules, approves, views all analytics. |
| Document Owner / Author | Creates and edits drafts, starts reviews, handles periodic reviews for owned documents. |
| Reviewer | Comments on and reviews assigned items. |
| Approver | Approves with electronic signature. |
| Process Owner | Owns change requests, quality events, and CAPAs in their process area. |
| Employee / Trainee | Reads effective documents, completes training, raises observations. |
| Auditor (read-only) | Time-boxed, read-only access to records and audit trails. |

Access can also be restricted per record (owners, authors, named groups) and by **information classification** (Public / Internal / Confidential / Restricted).

## 4. Core modules — functional requirements

### 4.1 Home: "My Work"
- One inbox for everything assigned to the user: authoring, reviewing, approval, training, periodic review, change actions, corrective actions, preventive actions, assessments, effectiveness checks, and to-dos.
- Tabs or filters for **All / Upcoming / Overdue**, plus "Assigned to me" vs "Created by me."
- Saved views and filters per user.
- Opening a task shows the related record next to it, so the user can act without leaving the page.

### 4.2 Document Control
- Document register with ID, title, type (SOP, Work Instruction, Policy, Form, Template, Specification, etc.), state, version, tags, owner, last modified; sortable, filterable, CSV export.
- Create a document from a blank page, from an **approved template**, or by uploading DOCX / PDF / XLSX.
- Auto-numbering by document type (e.g. SOP-001), configurable.
- **Lifecycle:** Draft → In Review → Review Closed → In Approval → Approved / Pending Training → Effective → Superseded / Obsolete. Configurable per document type.
- Assign authors, reviewers, and approvers per stage, with due dates.
- Metadata: effective date, due date, quality process, tags, document type, source template, approval timestamp, last review closed.
- Check-out / check-in so two people can't edit at once.
- **Major/minor versioning** with full version history and side-by-side comparison of versions.
- A **change summary is mandatory** for every new version. Offer an optional "Draft summary with AI" button that suggests text from the diff; the user must review and edit it before saving. [CONFIRM: AI provider approved under our AI usage policy — or leave this feature out]
- Review: inline comments, redlines, "Approve" or "Send back to draft" with a reason.
- On approval, append a **signature manifest page** to the rendered PDF: signer name, meaning of the signature (e.g. "Approved"), the signature statement, UTC timestamp, and a hash of the signed content.
- Dynamic watermarks by state (e.g. "DRAFT", "FOR TRAINING", "OBSOLETE"), plus the viewer's name and date on downloaded or printed copies.
- In-browser viewer for PDF and Office files (zoom, page navigation, open in new tab).
- [CONFIRM: Phase 2 — edit in Microsoft Word through a Microsoft 365 integration? If yes, research the current Microsoft-supported integration options before you design it.]

### 4.3 Training Management
- **My Training:** the trainee's assignments; reading a document and clicking "Mark as completed" (with optional knowledge-check quiz and e-signature) creates a training record.
- **Organisation Training:** % complete, average completion time, overdue count, and a training-records table (user, document, assigned date, due date, completed date, status); CSV/PDF export for audits and management review.
- **Training Rules:** name, description, applies to groups/users, required documents, time allowed (e.g. 2 weeks), optional retraining interval (e.g. every 1 year). Rules are versioned and become active only after approval.
- When a document becomes effective or gets a new major version, automatically assign training to everyone in the matching rules. If the rule requires it, a document stays in "Pending Training" until training is complete.
- Training records for leavers stay attached to the record and are never deleted.

### 4.4 Change Control
- Change Request (CR): title, process, **Major vs Minor** classification (with help text explaining each), description/reason/expected impact, impacted processes, attachments.
- **Lifecycle:** Planning → Review → Approval → In Execution → Effectiveness Check → Closed.
- Tabs: Overview, Items to Change (linked documents), Actions, Attachments, Related Items, Effectiveness Check.
- Actions: title, description, linked document, assignee, due date, "requires signature" toggle. Approving the plan and approving completion each require e-signatures.
- Auto-generate a Change Request Plan PDF from the CR record.

### 4.5 Periodic Reviews
- Per document: review frequency, advance-notice period (e.g. 60 days), and whether approval is required.
- Reviews are auto-created on schedule. The reviewer chooses **"No update needed"** (signed and recorded, review date resets) or **"Needs update"** (starts a new draft or a CR).
- **My Reviews** and **Organisation Reviews** views showing upcoming, due-soon, overdue, and past reviews, with export.

### 4.6 Quality Events and CAPA
- **Observations:** any employee can raise one, on web or mobile, with photo or file attachments. The owner does an initial review, then either **Escalates** to a Quality Event or **Closes** it with a written justification.
- **Quality Events** (nonconformances, deviations, complaints, audit findings — types configurable): title, description, due date, quality process, tags, severity, assessment. Closing an event **without** a CAPA requires a justification and an e-signature.
- **CAPA:** created from a Quality Event (linked both ways), with a severity level (Low / High, configurable) that drives the workflow route.
  - **Lifecycle:** Planning → Execution → Effectiveness Check → Closed.
  - Corrective and preventive actions are defined only during Planning, each with type, title, assignee, due date, linked documents, and signature requirement.
  - Execution: root-cause analysis (5 Whys and fishbone templates), risk assessment, evidence uploads (any file type, converted to PDF for the record).
  - Completed actions are routed for review and approval before the effectiveness check.

### 4.7 Analytics
- Tabs: Overview, Documents, Training, Change Requests, Quality Events & CAPA, Periodic Reviews, Actions.
- Example KPIs: training due vs overdue; training cycle time; documents and versions created in the last 90 days vs the prior period; change requests by state; quality events by state; average time in each workflow state; CAPA closure on time; periodic reviews by owner and status; actions by status.
- Every chart drills down to the underlying records ("Full report") and exports.
- Respects RBAC: users see only data they are allowed to see.

### 4.8 Cross-cutting features
- **Templates library** (document, CR, CAPA, and event templates), version-controlled.
- **Global search** across records and document content, filtered by permissions.
- **Notifications:** in-app, email, Microsoft Teams, and mobile push — full requirements in Section 6.
- **Linking:** any record can link to any other (document ↔ CR ↔ event ↔ CAPA ↔ training), and every link is visible from both ends.
- **Help centre and guided onboarding:** first-run walkthroughs per module.

## 5. Workflow engine and electronic signatures

- Build a configurable state-machine workflow engine shared by all modules: states, allowed transitions, required roles per transition, required fields, signature requirement, SLA timers.
- **Electronic signatures:**
  - Re-authenticate at the moment of signing (password, or SSO step-up plus MFA). An existing session is not enough.
  - Capture signer identity, the meaning of the signature, UTC timestamp, and record hash.
  - Store signatures so they cannot be edited or detached from the record.
  - [CONFIRM: does our regulatory context also require 21 CFR Part 11 or EU GMP Annex 11? If yes, flag the additional requirements.]
- Segregation of duties: by default, the author of a record cannot approve it (configurable, and every override is logged).

## 6. Automation and notifications

Every task the system creates must be automated end to end: no one should have to remember to chase anyone.

### 6.1 Automation engine
- Build an **event → condition → action** rules engine on top of the workflow engine (Section 5).
  - **Events:** record created, state changed, task assigned, task completed, task rejected or sent back, due date approaching, due date passed, signature completed, training rule activated, periodic review due, document became effective, integration event received (e.g. DocuSign envelope completed).
  - **Conditions:** module, record type, severity, quality process, site/entity, tags, classification, assignee role.
  - **Actions:** notify (email / Teams / in-app / push), create task, reassign, escalate, move to next workflow stage, create calendar entry, publish to SharePoint, send for DocuSign signature, call a webhook.
- Admins and Quality Managers configure rules in the UI **without code**. Rules are versioned, need approval before they go live (they change how controlled processes run), and every rule execution is written to the audit trail.
- Ship sensible default rules (Section 6.3) so it works on day one.
- Reliability: rules run as background jobs with retries, a dead-letter queue, and an admin screen showing failed automations so nothing fails silently. Use an outbox pattern so a notification is never sent for a change that didn't save, and never lost for one that did.

### 6.2 Sequential "next-in-line" notifications
- When a workflow stage completes, the system **automatically notifies the people for the next stage** — e.g. author submits → reviewers notified; last reviewer finishes → approvers notified; approval done → trainees assigned and notified; training complete → document owner notified the document is effective.
- Support **parallel** (all reviewers at once) and **sequential** (approver 1, then approver 2) routing, configurable per workflow.
- People later in the chain get an **FYI** when the item enters the workflow ("You'll be asked to approve SOP-014, expected around [date]"), and an **action** notification only when it is their turn.
- When someone sends an item back or rejects it, the author and everyone already in the chain are told, with the reason.

### 6.3 Default notification matrix (configurable)

| Trigger | Who is notified | Channels |
|---|---|---|
| Task assigned (any module) | Task owner | Email + Teams + in-app + push |
| Your turn in a workflow (review / approve / sign) | Current-stage reviewers or approvers | Email + Teams + in-app + push |
| Item entered a workflow you're part of later | Later-stage reviewers/approvers | In-app (+ optional email) |
| Stage completed | Record owner; next stage (see 6.2) | In-app + email |
| Sent back / rejected | Author/owner + earlier participants | Email + Teams + in-app |
| Reminder before due date | Task owner | Email + Teams (e.g. 3 days and 1 day before — configurable) |
| Overdue | Task owner; then their manager after [CONFIRM] days; then Quality Manager after [CONFIRM] days | Email + Teams |
| New document effective / new version | Everyone in matching training rules | Email + in-app + push |
| Periodic review due | Document owner | Email + Teams, at the advance-notice date |
| High-severity quality event or CAPA created | Quality Manager + process owner + configured Teams channel | Email + Teams channel post |
| Signature completed (in-app or DocuSign) | Record owner | In-app + email |
| Security events (new device login, MFA change, role change) | The affected user; admins for privilege changes | Email |

### 6.4 Notification rules
- **Emails contain a summary and a deep link, never the document itself or Restricted content.** The recipient opens the app to read and act.
- **"Approve" buttons in email or Teams must open the app and require re-authentication.** No one-click signing from an inbox — that would break the e-signature controls in Section 5.
- Per-user preferences: channel choice, daily or weekly digest, quiet hours (respecting each user's time zone). **Mandatory notifications** (your turn to sign, overdue, security alerts) cannot be switched off.
- Delegation / out-of-office: a user can delegate tasks to a named backup for a date range; delegated actions are logged as "X on behalf of Y". [CONFIRM: can delegates sign approvals, or only review?] If Outlook out-of-office status can be read through Microsoft Graph, offer to suggest delegation automatically — verify this capability in current Microsoft docs first.
- Optional: add due dates to the assignee's Outlook calendar.
- Every notification sent is logged (recipient, channel, time, delivery status) for audit evidence that people were told.
- Email deliverability: send from our domain with SPF, DKIM and DMARC configured.

## 7. Integrations: Microsoft 365 (SharePoint, Outlook, Teams) and DocuSign

### 7.1 General integration requirements
- Build each integration as a separate, switchable connector behind a common integration layer, so one failing doesn't affect the core app.
- Use **Microsoft Graph** for SharePoint, Outlook and Teams, and the **DocuSign eSignature API** for DocuSign. Before designing each integration, check the current official documentation for supported endpoints, permissions, rate limits and licensing — do not guess.
- Register the app in Microsoft Entra ID with **the fewest Graph permissions possible**; justify each permission in the design doc. For SharePoint, prefer site-scoped access (e.g. limited to the specific QMS sites) over tenant-wide access, if Microsoft currently supports that for our scenario.
- Store all client secrets, certificates and tokens in a managed secrets vault; rotate them; never in code or config files.
- Verify every inbound webhook (signature/HMAC check, replay protection).
- Log every integration call and inbound event in the audit trail. Show integration health (last success, failures, retry queue) on an admin page.
- Retries with backoff, and a manual "retry" for failed items.

### 7.2 Outlook / email
- Send notifications from a shared QMS mailbox via Microsoft Graph or a transactional email service. [CONFIRM: which]
- Branded HTML templates per notification type, editable by admins, with plain-text fallback.
- Optional calendar entries for due dates and review meetings.

### 7.3 Microsoft Teams
- A Teams app/bot that sends **personal notifications** to users and **posts to channels** per process area (e.g. "#quality-events").
- Notifications use interactive cards showing the record, due date and an "Open in QMS" button (re-auth required for any signing — see 6.4).
- Optional: a QMS tab inside Teams showing the user's My Work.
- [CONFIRM: does our Microsoft 365 tenant allow custom Teams apps, and who in IT approves them?]

### 7.4 SharePoint
**The QMS is the system of record for controlled documents.** If people can edit controlled copies in SharePoint outside the QMS, the approval and version controls can be bypassed. Design for one of these options and ask me to choose:

- **Option A (recommended): publish-only.** When a document becomes Effective, the QMS publishes a read-only, watermarked PDF to a designated SharePoint library (with metadata: ID, version, effective date, owner). Superseded versions are removed or moved to an archive library automatically. Staff can find documents where they already work, but all editing happens in the QMS.
- **Option B: import.** One-time or ongoing import of existing documents from SharePoint into the QMS as drafts, to migrate the current document library.
- **Option C: SharePoint as storage.** The QMS stores files in SharePoint behind the scenes. Only consider this if IT requires it; explain the security, permissions and audit trade-offs first.

Also: link to SharePoint files as reference attachments on any record (link only, with access still governed by SharePoint permissions).

### 7.5 DocuSign
- Use DocuSign where a signature is needed **from people outside the QMS** (e.g. suppliers, customers, contractors, external auditors) or where a wet-ink-equivalent signed contract is required. [CONFIRM: which document types or steps should go to DocuSign]
- Internal QMS approvals stay on the built-in e-signatures (Section 5), so we don't pay per envelope for routine approvals and the signature evidence stays inside the record.
- Flow: QMS creates the envelope from the record → tracks status via DocuSign webhooks → when completed, automatically downloads the signed PDF and DocuSign's completion certificate and attaches both to the record → moves the workflow to the next stage → notifies the owner.
- Handle declined, voided and expired envelopes (notify owner, return task to them).
- [CONFIRM: DocuSign plan/account type and whether API access is included.]

## 8. UI/UX direction — make it distinct

Do **not** copy the layout, colours, or visual style of any existing eQMS product. Direction:

- **Navigation:** a slim, collapsible icon rail plus a top **command bar** with a command palette (Ctrl/Cmd + K) for search, "create new…", and jumping to records. On mobile, a bottom tab bar: Home, Tasks, Scan/Raise, Notifications, Profile.
- **Home is a "Today" view,** not a table: cards grouped by urgency (Overdue → Due this week → Upcoming), each with one primary action button.
- **Record pages use a split layout:** content on the left, a context panel on the right (details, people, links, activity). Lifecycle state appears as a **horizontal progress stepper** across the top, not as dropdown chips.
- **Prefer side drawers to modals** for create and edit forms, so the user doesn't lose context.
- **Activity timeline** on every record, combining comments, state changes, and signatures (read from the audit trail).
- **Board view** (kanban by state) as an option alongside list view for CRs, events, and CAPAs.
- **Visual identity:** [CONFIRM: brand colours, logo, and font — otherwise propose a palette that is clearly different from blue/orange SaaS defaults]. Support light and dark mode.
- **Accessibility:** WCAG 2.1 AA (contrast, keyboard navigation, focus states, screen-reader labels, touch targets of at least 44 px).
- Plain-language microcopy, helpful empty states, and confirmation steps before irreversible actions.

## 9. Mobile app scope

Mobile is for **doing tasks on the go**, not full administration:
- My Work inbox, notifications (push), approvals and reviews with e-signature.
- Read effective documents and complete training.
- Raise observations with camera photo, location, and offline draft (synced when back online).
- Quick view of CAPA and CR status.
- **Web only:** document authoring, workflow and template configuration, user administration, full analytics.

Mobile security:
- Biometric unlock only to open the app; e-signatures still require re-authentication per Section 5. [CONFIRM: whether biometrics may be accepted as part of signing]
- No unencrypted local storage of documents. Cached data uses OS secure storage and is wiped on logout or remote session revocation.
- Certificate pinning (or a documented justification for not using it), jailbreak/root detection with a configurable response, optional screenshot blocking for Restricted documents.
- [CONFIRM: will we use MDM (e.g. Intune) for company devices?]

## 10. ISO/IEC 27001:2022 — security requirements and control mapping

Context: ISO 27001 certifies the organisation's ISMS, not the software. This app must (a) **support** the relevant Annex A controls, and (b) **produce evidence** for audits. Below, "A.x.xx" refers to ISO/IEC 27001:2022 Annex A — verify each reference against our copy of the standard.

| Area | What to build | Annex A (verify) |
|---|---|---|
| Identity & authentication | SSO via OIDC/SAML; MFA enforced for all users (phishing-resistant MFA option for admins); password policy for any local accounts; account lockout; session timeout and re-auth for sensitive actions | A.5.16, A.5.17, A.8.5 |
| Access control | RBAC + record-level permissions + classification-based restrictions; least privilege by default; quarterly access-review report exportable for managers | A.5.15, A.5.18, A.8.2, A.8.3 |
| Joiners / movers / leavers | SCIM or HR-triggered provisioning; immediate deprovisioning and session revocation; records retained after leavers | A.5.18, A.6.5 |
| Audit trail & logging | Append-only, tamper-evident audit log (hash-chained) of every create/read-of-restricted/update/delete/sign/permission change/login/export, with user, UTC timestamp, before/after values, IP/device; exportable; retention configurable; synced clocks (NTP) | A.8.15, A.8.16, A.8.17 |
| Records protection | Quality records can't be hard-deleted; retention schedules; legal hold; obsolete documents archived, not removed | A.5.33 |
| Cryptography | TLS 1.2+ (prefer 1.3) in transit; AES-256 at rest; field-level encryption for sensitive personal data; keys in a managed KMS with rotation; documented crypto standard | A.8.24 |
| Classification & labelling | Classification field on documents and records; labels shown in the UI, watermarks, and file metadata | A.5.12, A.5.13 |
| Data leakage prevention | Download/print/share controls by classification; watermarking; export logging; no public links | A.8.12, A.5.14 |
| Personal data / privacy | Data minimisation; privacy notice; data-subject request support (export/correct); PII masking in logs and non-production | A.5.34, A.8.11 |
| Secure deletion | Verified deletion of non-record data at end of retention; customer-data deletion procedure | A.8.10 |
| Backup & continuity | Automated encrypted backups, off-site/cross-region copy, regular restore tests with evidence; RPO [CONFIRM] / RTO [CONFIRM]; high availability | A.8.13, A.8.14, A.5.30 |
| Secure development | Documented SDLC; threat modelling; secure coding standard (OWASP ASVS Level 2 as baseline); code review required; SAST, dependency/SCA, secrets scanning, and container scanning in CI; DAST before release | A.8.25, A.8.26, A.8.27, A.8.28, A.8.29 |
| Environments & test data | Separate dev / test / prod; no production personal data in non-prod without masking | A.8.31, A.8.33 |
| Change management (of the app) | All releases via pull request + approval + automated tests + change record; rollback plan | A.8.32 |
| Configuration & vulnerabilities | Infrastructure as code; hardened baselines; patch SLAs by severity; annual third-party penetration test | A.8.8, A.8.9 |
| Malware | Scan every uploaded file before it is stored or rendered | A.8.7 |
| Network | WAF, rate limiting, private subnets for data stores, least-privilege security groups | A.8.20, A.8.22 |
| Cloud & suppliers | Use a cloud provider with ISO 27001 certification and SOC 2 reports; document shared-responsibility split; list all sub-processors (incl. Microsoft 365, DocuSign, email service, and any AI provider) | A.5.19–A.5.23 |
| Integrations | Least-privilege Entra ID app permissions; secrets in vault with rotation; verified webhooks; integration audit log; emails/Teams messages carry links, not controlled content | A.5.14, A.5.15, A.8.24 |
| Incident management | Security event alerting; incident runbook; evidence preservation | A.5.24–A.5.28 |
| Monitoring | Centralised logs, alerting on anomalous logins, privilege changes, mass exports | A.8.16 |

**Bonus:** the app should also be able to run our ISMS documentation (policies, procedures, risk register, Statement of Applicability) as controlled documents, supporting ISO 27001 clause 7.5 (documented information).

**Evidence deliverables** (generate these as part of the build): architecture & data-flow diagrams, asset inventory of system components, threat model, control-to-feature mapping, secure SDLC procedure, backup/restore test record, access-review report template, pen-test remediation log, and an admin/user guide.

## 11. Suggested technical stack (propose alternatives if better)

- **Web:** TypeScript, React with Next.js.
- **Mobile:** React Native (Expo) sharing types, validation, and API client with web.
- **API/back end:** TypeScript (Node.js) with a typed API layer; background job queue for notifications, PDF rendering, scheduling.
- **Database:** PostgreSQL with row-level security considered for permission enforcement.
- **Files:** encrypted object storage with signed, short-lived URLs; antivirus scan on upload; server-side PDF rendering for signed/watermarked outputs.
- **Search:** Postgres full-text to start; dedicated search engine later if needed.
- **Auth:** an established identity provider (OIDC/SAML, MFA, SCIM) — do not build authentication from scratch.
- **Infra:** [CONFIRM: AWS / Azure / GCP], infrastructure as code, CI/CD with the security gates in Section 10.
- **Observability:** structured logs, metrics, tracing, uptime alerts.

## 12. Data model (starting point)

Entities: Organisation, Site/Entity, User, Group, Role, Permission, Document, DocumentVersion, Template, WorkflowDefinition, WorkflowInstance, Task/Action, Signature, Comment, Attachment, TrainingRule, TrainingAssignment, TrainingRecord, ChangeRequest, PeriodicReview, Observation, QualityEvent, CAPA, CAPAAction, EffectivenessCheck, Link (polymorphic), Notification, NotificationLog, NotificationPreference, Delegation, AutomationRule, AutomationRuleVersion, AutomationRun, IntegrationConnection, IntegrationEvent, ExternalSignatureEnvelope, AuditLogEntry, ClassificationLabel, RetentionPolicy.

Requirements: soft-delete only for quality records; every entity has created/updated by + UTC timestamps; versions are immutable once approved; AuditLogEntry is append-only at the database-permission level.

## 13. Delivery phases

1. **Foundation:** auth/SSO/MFA, RBAC, audit trail, workflow engine, e-signatures, file storage, automation engine with default rules, email + in-app notifications, design system, My Work.
2. **Document Control + Templates**, plus Microsoft Teams notifications and SharePoint publishing/import.
3. **Training Management.**
4. **Change Control + Periodic Reviews.**
5. **Observations, Quality Events, CAPA.**
6. **Analytics + DocuSign integration.**
7. **Mobile app** (start in parallel after Phase 2 if capacity allows).
8. **Hardening:** pen test, restore test, performance test, ISMS evidence pack, user acceptance testing.

## 14. Non-functional requirements

- Availability target: [CONFIRM, e.g. 99.9%].
- Performance: main pages load in under 2 seconds at [CONFIRM] concurrent users.
- Time zones: store UTC, display in each user's local time zone (users span multiple countries).
- Localisation-ready (string externalisation), English first.
- Automated tests: unit, integration, end-to-end for every workflow path including signature and rejection paths; target coverage agreed in Step 1.

## 15. Acceptance criteria (examples — extend per module)

- A document cannot become Effective without all required approval signatures, and each signature shows on the manifest page with hash and UTC timestamp.
- An author cannot approve their own document unless an admin override is configured, and the override is logged.
- Every state change, signature, permission change, and export appears in the audit trail and cannot be edited, even by an admin.
- Closing a Quality Event without a CAPA is blocked until a justification is entered and signed.
- A leaver's access is removed within [CONFIRM] minutes of deprovisioning, and their past signatures and training records remain intact.
- A Restricted document cannot be downloaded by a user without the matching clearance; the attempt is logged.
- Backups restore successfully in a test environment within the RTO.
- When an author submits a document, every assigned reviewer receives an email, Teams message and in-app task within [CONFIRM, e.g. 2] minutes; when the last reviewer finishes, the approvers are notified automatically with no manual step.
- An overdue task triggers reminders and escalates to the assignee's manager on the configured schedule; every notification is logged with delivery status.
- Clicking "Approve" in an email or Teams card opens the app and requires re-authentication before signing.
- A DocuSign envelope completed by an external signer attaches the signed PDF and completion certificate to the record and advances the workflow automatically.
- When a document becomes Effective, the read-only PDF appears in the designated SharePoint library, and the superseded version is removed or archived there.
- If an integration is down, the core QMS keeps working, failed items queue for retry, and admins are alerted.

## 16. Open questions — ask me before Step 1 if still unresolved

All `[CONFIRM]` items above, plus: expected document volume and file sizes; migration of existing documents and training records (from where, what format); budget/hosting constraints; who will own the system's support after go-live; who in IT owns the Microsoft 365 tenant and approves app registrations and Teams apps; which SharePoint option (7.4) we choose.
