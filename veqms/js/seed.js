/* Sample data for the prototype. Every date is relative to the day the demo is first opened,
   so "overdue", "due this week" and "upcoming" always make sense. Sample records, for layout only. */
(function (Q) {
  'use strict';
  var D = function (n, h, m) { return Q.dayIso(n, h == null ? 10 : h, m || 0); };

  function blocks() { // blocks('h','Title','p','Text',...)
    var out = [];
    for (var i = 0; i < arguments.length; i += 2) out.push({ t: arguments[i], x: arguments[i + 1] });
    return out;
  }

  Q.seed = function () {
    var S = {
      version: 9,
      seededAt: new Date().toISOString(),
      session: { userId: 'u-vic', signedInAt: D(0, 8, 2) },
      counters: { POL: 10, SOP: 21, WI: 4, FRM: 8, REG: 3, PLN: 2, SOA: 2, SPEC: 1, CR: 17, QE: 17, CAPA: 9, OBS: 23, PR: 37, TR: 5, TPL: 9, RULE: 15, SIG: 120, ACT: 60 },
      seen: {},
      ui: {}
    };

    // ---------------- People, roles, groups ----------------
    S.users = [
      { id: 'u-vic', name: 'Victoria E.', initials: 'VE', email: 'victoria@veqms.example', roles: ['qm', 'approver', 'process'], title: 'HR Administrator · Support Owner', clearance: 'Restricted', status: 'Active', site: 'London', manager: null, groups: ['All staff', 'Managers'] },
      { id: 'u-sam', name: 'Jim Speir', initials: 'JS', email: 'jim.speir@veqms.example', roles: ['author', 'reviewer'], title: 'IT Operations Lead', clearance: 'Confidential', status: 'Active', site: 'London', manager: 'u-tom', groups: ['All staff', 'IT team'] },
      { id: 'u-priya', name: 'Carrie Foreman', initials: 'CF', email: 'carrie.foreman@veqms.example', roles: ['reviewer', 'author'], title: 'Information Security Analyst', clearance: 'Restricted', status: 'Active', site: 'London', manager: 'u-vic', groups: ['All staff', 'IT team'] },
      { id: 'u-tom', name: 'PJ Walters', initials: 'PW', email: 'pj.walters@veqms.example', roles: ['approver', 'process'], title: 'Head of IT', clearance: 'Restricted', status: 'Active', site: 'London', manager: null, groups: ['All staff', 'IT team', 'Managers'] },
      { id: 'u-grace', name: 'Louise Harvey', initials: 'LH', email: 'louise.harvey@veqms.example', roles: ['process', 'reviewer', 'author'], title: 'Operations Manager', clearance: 'Confidential', status: 'Active', site: 'Manila', manager: 'u-vic', groups: ['All staff', 'Managers', 'Support team'] },
      { id: 'u-daniel', name: 'Daniel Greenwood', initials: 'DG', email: 'daniel.greenwood@veqms.example', roles: ['employee'], title: 'Customer Support Agent', clearance: 'Internal', status: 'Active', site: 'Manila', manager: 'u-grace', groups: ['All staff', 'Support team'] },
      { id: 'u-hannah', name: 'Lucy Parkin', initials: 'LP', email: 'lucy.parkin@veqms.example', roles: ['admin'], title: 'System Administrator', clearance: 'Confidential', status: 'Active', site: 'London', manager: 'u-tom', groups: ['All staff', 'IT team'] },
      { id: 'u-aud', name: 'Fraser Scott', initials: 'FS', email: 'fraser.scott@auditors.example', roles: ['auditor'], title: 'External ISMS auditor', clearance: 'Confidential', status: 'Active', site: 'External', manager: null, groups: [], accessUntil: D(12, 23, 59) },
      { id: 'u-omar', name: 'Omar Haddad', initials: 'OH', email: 'omar.haddad@veqms.example', roles: ['reviewer', 'author'], title: 'Network Engineer', clearance: 'Confidential', status: 'Active', site: 'London', manager: 'u-tom', groups: ['All staff', 'IT team'] },
      { id: 'u-mia', name: 'Mia Santos', initials: 'MS', email: 'mia.santos@veqms.example', roles: ['employee', 'author'], title: 'HR Coordinator', clearance: 'Confidential', status: 'Active', site: 'Manila', manager: 'u-grace', groups: ['All staff', 'Support team'] },
      { id: 'u-lena', name: 'Lena Novak', initials: 'LN', email: 'lena.novak@veqms.example', roles: ['employee'], title: 'Finance Officer', clearance: 'Internal', status: 'Active', site: 'London', manager: 'u-vic', groups: ['All staff'] },
      { id: 'u-jake', name: 'Jake Turner', initials: 'JT', email: 'jake.turner@veqms.example', roles: ['employee'], title: 'Developer', clearance: 'Internal', status: 'Active', site: 'London', manager: 'u-tom', groups: ['All staff', 'IT team'] },
      { id: 'u-ruth', name: 'Ruth Adeyemi', initials: 'RA', email: 'ruth.adeyemi@veqms.example', roles: ['employee'], title: 'Office Manager', clearance: 'Internal', status: 'Active', site: 'London', manager: 'u-grace', groups: ['All staff'] },
      { id: 'u-mark', name: 'Mark Davies', initials: 'MD', email: 'mark.davies@veqms.example', roles: ['employee'], title: 'Developer (left)', clearance: 'Internal', status: 'Left', leftOn: D(-40), site: 'London', manager: 'u-tom', groups: [] }
    ];
    S.groups = [
      { name: 'All staff', desc: 'Everyone with an active account' },
      { name: 'IT team', desc: 'IT operations, security and development' },
      { name: 'Managers', desc: 'People managers and process owners' },
      { name: 'Support team', desc: 'Customer support, Manila' }
    ];

    // ---------------- Templates ----------------
    S.templates = [
      { id: 'TPL-POL', name: 'Policy', kind: 'Document', docType: 'Policy', version: '1.2', state: 'Effective', updated: D(-80), sections: ['1. Purpose', '2. Scope', '3. Policy statements', '4. Roles and responsibilities', '5. Exceptions', '6. Review'] },
      { id: 'TPL-SOP', name: 'Procedure (SOP)', kind: 'Document', docType: 'Procedure', version: '2.0', state: 'Effective', updated: D(-120), sections: ['1. Purpose', '2. Scope', '3. Roles', '4. Procedure', '5. Records', '6. Related documents'] },
      { id: 'TPL-WI', name: 'Work instruction', kind: 'Document', docType: 'Work instruction', version: '1.0', state: 'Effective', updated: D(-200), sections: ['1. When to use this', '2. Steps', '3. Checks'] },
      { id: 'TPL-FRM', name: 'Form', kind: 'Document', docType: 'Form', version: '1.1', state: 'Effective', updated: D(-150), sections: ['1. Requester', '2. Request', '3. Approval'] },
      { id: 'TPL-REG', name: 'Register', kind: 'Document', docType: 'Register', version: '1.0', state: 'Effective', updated: D(-210), sections: ['1. Purpose', '2. Register', '3. Ownership'] },
      { id: 'TPL-CR', name: 'Change request', kind: 'Change request', version: '1.0', state: 'Effective', updated: D(-60), sections: ['Description', 'Reason', 'Expected impact', 'Impacted processes'] },
      { id: 'TPL-CAPA', name: 'CAPA', kind: 'CAPA', version: '1.1', state: 'Effective', updated: D(-45), sections: ['5 Whys', 'Fishbone', 'Risk assessment', 'Effectiveness check'] },
      { id: 'TPL-QE', name: 'Quality event', kind: 'Quality event', version: '1.0', state: 'Effective', updated: D(-90), sections: ['What happened', 'Immediate containment', 'Assessment'] },
      { id: 'TPL-POL2', name: 'Policy (short form)', kind: 'Document', docType: 'Policy', version: '0.2', state: 'Draft', updated: D(-3), sections: ['1. Purpose', '2. Policy statements', '3. Review'] }
    ];

    // ---------------- Documents ----------------
    var POL004_v1 = blocks(
      'h', '1. Purpose', 'p', 'This policy sets out how VeQMS grants, reviews and removes access to information and systems.',
      'h', '2. Scope', 'p', 'It applies to all staff, contractors and systems that store or process VeQMS information.',
      'h', '3. Granting access', 'p', 'Line managers request access through the IT service desk. IT grants the access requested.',
      'h', '4. Reviewing access', 'p', 'System owners review access to their systems once a year.',
      'h', '5. Removing access', 'p', 'HR tells IT when someone leaves. IT removes access within five working days.',
      'h', '6. Privileged access', 'p', 'Administrator accounts are used only for administration tasks.'
    );
    var POL004_v2 = blocks(
      'h', '1. Purpose', 'p', 'This policy sets out how VeQMS grants, reviews and removes access to information and systems.',
      'h', '2. Scope', 'p', 'It applies to all staff, contractors, suppliers with system access, and every system that stores or processes VeQMS information.',
      'h', '3. Granting access', 'p', 'Line managers request access using form FRM-007. The system owner approves the request before IT grants it. Access follows least privilege: people get only what their role needs.',
      'h', '4. Reviewing access', 'p', 'System owners review access to their systems every quarter, using the access review report. Changes found in the review are made within 10 working days.',
      'h', '5. Removing access', 'p', 'Leavers lose access within 60 minutes of HR recording their leaving date. For urgent leavers, an administrator uses revoke-now, which ends access at once.',
      'h', '6. Privileged access', 'p', 'Administrator accounts are separate from day-to-day accounts, use phishing-resistant MFA, and are reviewed every month.',
      'h', '7. Exceptions', 'p', 'Exceptions need written approval from the Head of IT and are recorded in the risk register (REG-001).'
    );
    var SOP012_v2 = blocks(
      'h', '1. Purpose', 'p', 'Make sure VeQMS data can be restored after loss or corruption.',
      'h', '2. Backup schedule', 'p', 'Databases and file storage are backed up every night. Backups are encrypted.',
      'h', '3. Roles', 'p', 'IT Operations runs the backups.',
      'h', '4. Restore testing', 'p', 'A restore test runs once a year.',
      'h', '5. Records', 'p', 'Backup reports are kept for 1 year.'
    );
    var SOP012_v3 = blocks(
      'h', '1. Purpose', 'p', 'Make sure VeQMS data can be restored after loss, corruption or ransomware.',
      'h', '2. Backup schedule', 'p', 'Databases are backed up continuously with point-in-time restore. File storage is backed up every night. Backups are encrypted and copied to a second region.',
      'h', '3. Roles', 'p', 'IT Operations runs the backups. The Head of IT checks the backup report every week.',
      'h', '4. Restore testing', 'p', 'A restore test runs every quarter in the test environment. The result, the time taken and any problems are recorded as evidence.',
      'h', '5. Targets', 'p', 'Recovery point objective: 1 hour. Recovery time objective: 1 business day.',
      'h', '6. Records', 'p', 'Backup reports and restore test records are kept for 3 years.'
    );
    function simple(title, purpose, extra) {
      return blocks('h', '1. Purpose', 'p', purpose, 'h', '2. Scope', 'p', 'Applies to all VeQMS staff, contractors and systems in the ISMS scope.', 'h', '3. Requirements', 'p', extra, 'h', '4. Review', 'p', 'The owner reviews this document at least every 12 months, or sooner after a significant change.');
    }

    function ver(v, kind, state, summary, created, createdBy, content, approvedAt, sigs) {
      var o = { v: v, kind: kind, state: state, summary: summary, created: created, createdBy: createdBy, content: content, approvedAt: approvedAt || null, signatures: sigs || [] };
      o.hash = Q.sha256(Q.canon(content));
      return o;
    }
    function sig(id, user, meaning, at, verObj) {
      return { id: 'SIG-' + id, user: user, meaning: meaning, at: at, authAt: new Date(new Date(at).getTime() - 41000).toISOString(), hash: verObj ? verObj.hash : null, statement: null };
    }
    function withSigs(v, list) { v.signatures = list.map(function (s) { s.hash = v.hash; return s; }); return v; }

    var docs = {};
    function doc(o) { docs[o.id] = o; return o; }

    doc({
      id: 'POL-001', docType: 'Policy', title: 'Information Security Policy', state: 'Effective', classification: 'Internal',
      owner: 'u-vic', author: 'u-vic', process: 'ISMS · Governance', template: 'TPL-POL', tags: ['A.5.1', 'Clause 5.2'],
      created: D(-700), modified: D(-160), effective: D(-160), route: 'sequential', trainingRule: 'TR-01',
      periodic: { months: 12, notice: 60, approval: true },
      reviewers: [{ u: 'u-priya', status: 'Reviewed', at: D(-170) }], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-161) }],
      versions: [
        ver('2.0', 'major', 'Superseded', 'Aligned with ISO/IEC 27001:2022 clause structure.', D(-700), 'u-vic', simple('', 'Set direction and support for information security at VeQMS.', 'Top management sets information security objectives each year.'), D(-690)),
        withSigs(ver('3.0', 'major', 'Effective', 'Added objectives for 2026 and named the Quality Manager as ISMS lead.', D(-175), 'u-vic',
          simple('', 'Set direction and support for information security at VeQMS, in line with ISO/IEC 27001:2022.', 'Information security objectives are set each year and measured. The Quality Manager leads the ISMS. Every person must protect the information they handle and report incidents at once.'), D(-161)),
          [sig(101, 'u-priya', 'Reviewed', D(-170, 11, 20)), sig(102, 'u-tom', 'Approved', D(-161, 9, 5))])
      ],
      comments: []
    });
    doc({
      id: 'POL-002', docType: 'Policy', title: 'Cryptography Policy', state: 'Obsolete', classification: 'Internal',
      owner: 'u-priya', author: 'u-priya', process: 'ISMS · Cryptography', template: 'TPL-POL', tags: ['A.8.24'],
      created: D(-900), modified: D(-120), effective: null, route: 'sequential', obsoleteReason: 'Merged into SOP-019 Key Management Procedure.',
      periodic: null, reviewers: [], approvers: [],
      versions: [ver('1.0', 'major', 'Obsolete', 'First issue.', D(-900), 'u-priya', simple('', 'Set rules for the use of cryptography.', 'Use TLS 1.2 or later in transit and AES-256 at rest.'), D(-890))],
      comments: []
    });
    var pol004v1 = withSigs(ver('1.0', 'major', 'Effective', 'First issue.', D(-400), 'u-sam', POL004_v1, D(-390)), [sig(88, 'u-tom', 'Approved', D(-390, 14, 2))]);
    var pol004v2 = ver('2.0', 'major', 'In approval', 'Quarterly access reviews replace annual ones. Leavers lose access within 60 minutes, with revoke-now for urgent cases. Access requests now need system-owner approval through FRM-007. Added privileged-access and exceptions sections.', D(-14, 9, 18), 'u-sam', POL004_v2);
    doc({
      id: 'POL-004', docType: 'Policy', title: 'Access Control Policy', state: 'In approval', classification: 'Internal',
      owner: 'u-sam', author: 'u-sam', process: 'ISMS · Access control', template: 'TPL-POL', tags: ['A.5.15', 'A.8.3'],
      created: D(-400), modified: D(-6, 15, 42), effective: D(-390), route: 'sequential', trainingRule: 'TR-01', approvalDue: D(-2),
      periodic: { months: 12, notice: 60, approval: true },
      reviewers: [{ u: 'u-priya', status: 'Reviewed', at: D(-11, 10, 5) }, { u: 'u-omar', status: 'Reviewed', at: D(-6, 15, 42) }],
      approvers: [{ u: 'u-vic', status: 'Your turn' }, { u: 'u-tom', status: 'Waiting' }],
      versions: [pol004v1, pol004v2],
      comments: [
        { id: 'c1', u: 'u-priya', at: D(-11, 9, 50), block: 9, text: 'Should we say who presses revoke-now? Suggest "a System Administrator".', resolved: true, reply: 'Done in section 5.' },
        { id: 'c2', u: 'u-omar', at: D(-7, 16, 10), block: 11, text: 'Monthly review of admin accounts — who signs off? Worth naming the Head of IT.', resolved: true, reply: 'Covered by the access review report.' },
        { id: 'c3', u: 'u-priya', at: D(-10, 14, 2), block: 5, text: 'FRM-007 needs a field for the system owner. Raised CR-012 to update it.', resolved: true },
        { id: 'c4', u: 'u-omar', at: D(-6, 15, 40), block: 9, text: 'Can HR record the leaving date in advance for planned leavers? Then access ends on the last day, not 60 minutes after.', resolved: false }
      ]
    });
    doc({
      id: 'POL-003', docType: 'Policy', title: 'Information Classification Policy', state: 'In approval', classification: 'Internal',
      owner: 'u-vic', author: 'u-vic', process: 'ISMS · Information handling', template: 'TPL-POL', tags: ['A.5.12', 'A.5.13'],
      created: D(-300), modified: D(-1, 11, 0), effective: D(-290), route: 'parallel', trainingRule: 'TR-01', approvalDue: D(4),
      periodic: { months: 12, notice: 60, approval: true },
      reviewers: [{ u: 'u-priya', status: 'Reviewed', at: D(-1, 10, 40) }],
      approvers: [{ u: 'u-vic', status: 'Your turn' }, { u: 'u-tom', status: 'Your turn' }],
      versions: [
        withSigs(ver('1.0', 'major', 'Effective', 'First issue.', D(-300), 'u-vic', simple('', 'Label information so everyone knows how to handle it.', 'Four classes: Public, Internal, Confidential, Restricted. The owner sets the class when the information is created.'), D(-290)), [sig(30, 'u-tom', 'Approved', D(-290))]),
        ver('1.1', 'minor', 'In approval', 'Added handling rules for printing and downloads per class.', D(-4), 'u-vic', simple('', 'Label information so everyone knows how to handle it.', 'Four classes: Public, Internal, Confidential, Restricted. Confidential may not be printed. Restricted may be downloaded only by people with Restricted clearance; every attempt is logged.'))
      ],
      comments: []
    });
    doc({
      id: 'POL-009', docType: 'Policy', title: 'Acceptable Use Policy', state: 'Effective', classification: 'Internal',
      owner: 'u-vic', author: 'u-priya', process: 'ISMS · People', template: 'TPL-POL', tags: ['A.5.10'],
      created: D(-500), modified: D(-60), effective: D(-60), route: 'sequential', trainingRule: 'TR-01',
      periodic: { months: 12, notice: 60, approval: true },
      reviewers: [{ u: 'u-sam', status: 'Reviewed', at: D(-66) }], approvers: [{ u: 'u-vic', status: 'Signed', at: D(-61) }],
      versions: [
        ver('1.1', 'minor', 'Superseded', 'Clarified personal use of email.', D(-300), 'u-priya', simple('', 'Set out acceptable use of VeQMS systems.', 'Limited personal use is allowed outside working hours.'), D(-295)),
        withSigs(ver('1.2', 'minor', 'Effective', 'Added rules for AI tools: no Confidential or Restricted data in public AI tools.', D(-70), 'u-priya', simple('', 'Set out acceptable use of VeQMS systems, devices and AI tools.', 'Limited personal use is allowed outside working hours. Do not put Confidential or Restricted information into public AI tools. Report lost devices to IT at once.'), D(-61)), [sig(95, 'u-sam', 'Reviewed', D(-66, 10)), sig(96, 'u-vic', 'Approved', D(-61, 9, 30))])
      ],
      comments: []
    });
    var sop12v2 = withSigs(ver('2.1', 'minor', 'Superseded', 'Updated contact list.', D(-300), 'u-sam', SOP012_v2, D(-298)), [sig(70, 'u-tom', 'Approved', D(-298))]);
    var sop12v3 = withSigs(ver('3.0', 'major', 'Effective', 'Point-in-time restore for databases, copies to a second region, quarterly restore tests, and RPO/RTO targets.', D(-30), 'u-sam', SOP012_v3, D(-16, 11, 2)), [sig(110, 'u-priya', 'Reviewed', D(-22, 10)), sig(111, 'u-tom', 'Approved', D(-17, 16, 40)), sig(112, 'u-vic', 'Approved', D(-16, 11, 2))]);
    sop12v2.state = 'Superseded';
    doc({
      id: 'SOP-012', docType: 'Procedure', title: 'Backup and Restore Procedure', state: 'Effective', classification: 'Internal',
      owner: 'u-sam', author: 'u-sam', process: 'ISMS · Continuity', template: 'TPL-SOP', tags: ['A.8.13', 'A.5.30'],
      created: D(-600), modified: D(-16), effective: D(-16), route: 'sequential', trainingRule: 'TR-01',
      periodic: { months: 12, notice: 60, approval: true },
      reviewers: [{ u: 'u-priya', status: 'Reviewed', at: D(-22) }], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-17) }, { u: 'u-vic', status: 'Signed', at: D(-16) }],
      versions: [sop12v2, sop12v3], comments: []
    });
    doc({
      id: 'SOP-014', docType: 'Procedure', title: 'Joiner, Mover and Leaver Procedure', state: 'Effective', classification: 'Internal',
      owner: 'u-mia', author: 'u-mia', process: 'ISMS · People', template: 'TPL-SOP', tags: ['A.5.18', 'A.6.5'],
      created: D(-420), modified: D(-200), effective: D(-200), route: 'sequential', trainingRule: 'TR-03',
      periodic: { months: 12, notice: 60, approval: true }, reviewers: [], approvers: [{ u: 'u-vic', status: 'Signed', at: D(-200) }],
      versions: [withSigs(ver('1.4', 'minor', 'Effective', 'Added equipment return checklist.', D(-205), 'u-mia', simple('', 'Make sure people get the right access when they join, move or leave.', 'HR records start and leaving dates in the HR system. Managers confirm access needs on day one. Equipment is returned on the last day.'), D(-200)), [sig(60, 'u-vic', 'Approved', D(-200))])],
      comments: []
    });
    doc({
      id: 'SOP-018', docType: 'Procedure', title: 'Patch Management', state: 'Effective', classification: 'Internal',
      owner: 'u-omar', author: 'u-omar', process: 'ISMS · Vulnerability mgmt', template: 'TPL-SOP', tags: ['A.8.8'],
      created: D(-380), modified: D(-90), effective: D(-90), route: 'sequential', trainingRule: 'TR-02',
      periodic: { months: 12, notice: 60, approval: true }, reviewers: [], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-90) }],
      versions: [withSigs(ver('1.1', 'minor', 'Effective', 'Patch windows moved to Tuesday evenings.', D(-95), 'u-omar', simple('', 'Keep systems patched against known vulnerabilities.', 'Critical patches within 7 days, high within 30 days. Servers are patched on Tuesday evenings. Missed patches are reported to the Head of IT.'), D(-90)), [sig(77, 'u-tom', 'Approved', D(-90))])],
      comments: []
    });
    doc({
      id: 'SOP-020', docType: 'Procedure', title: 'Supplier Security Review', state: 'In review', classification: 'Internal',
      owner: 'u-grace', author: 'u-grace', process: 'ISMS · Supplier management', template: 'TPL-SOP', tags: ['A.5.19', 'A.5.21'],
      created: D(-9), modified: D(-3), effective: null, route: 'sequential', reviewRoute: 'parallel', trainingRule: 'TR-03', reviewDue: D(1), expectedApproval: D(9),
      periodic: { months: 12, notice: 60, approval: true },
      reviewers: [{ u: 'u-priya', status: 'Pending' }, { u: 'u-sam', status: 'Reviewed', at: D(-2, 11, 15) }],
      approvers: [{ u: 'u-vic', status: 'Waiting' }],
      versions: [ver('1.0', 'major', 'In review', 'First issue: how we assess suppliers before and during a contract.', D(-9), 'u-grace', blocks(
        'h', '1. Purpose', 'p', 'Make sure suppliers who handle VeQMS information protect it to our standard.',
        'h', '2. Before a contract', 'p', 'The contract owner completes a supplier security questionnaire. Suppliers handling Confidential or Restricted data need ISO/IEC 27001 certification or a SOC 2 report.',
        'h', '3. In the contract', 'p', 'Contracts include security, breach notification and right-to-audit clauses.',
        'h', '4. During the contract', 'p', 'High-risk suppliers are reviewed every year. Findings are raised as quality events.',
        'h', '5. Records', 'p', 'The supplier register records each assessment and its outcome.'))],
      comments: [{ id: 'c5', u: 'u-sam', at: D(-2, 11, 10), block: 3, text: 'Add DocuSign as the route for supplier sign-off of the questionnaire?', resolved: false }]
    });
    doc({
      id: 'REG-001', docType: 'Register', title: 'Information Security Risk Register', state: 'Effective', classification: 'Confidential',
      owner: 'u-vic', author: 'u-vic', process: 'ISMS · Risk', template: 'TPL-REG', tags: ['Clause 6.1.2', 'Clause 8.2'],
      created: D(-600), modified: D(-35), effective: D(-35), route: 'sequential', trainingRule: null,
      periodic: { months: 6, notice: 30, approval: true }, reviewers: [], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-35) }],
      versions: [withSigs(ver('5.0', 'major', 'Effective', 'Added supplier and AI-tool risks; re-scored after the internal audit.', D(-40), 'u-vic', blocks('h', '1. Purpose', 'p', 'Record information security risks, their owners, scores and treatment.', 'h', '2. Top risks', 'p', 'R-03 Ransomware on file server (high, treated by SOP-012 and SOP-018). R-07 Leaver access not removed (medium, treated by POL-004). R-11 Supplier data breach (medium, treated by SOP-020).', 'h', '3. Ownership', 'p', 'Each risk has a named owner who reviews it at least every 6 months.'), D(-35)), [sig(84, 'u-tom', 'Approved', D(-35))])],
      comments: []
    });
    doc({
      id: 'REG-002', docType: 'Register', title: 'Asset Inventory', state: 'Effective', classification: 'Internal',
      owner: 'u-sam', author: 'u-sam', process: 'ISMS · Asset management', template: 'TPL-REG', tags: ['A.5.9'],
      created: D(-700), modified: D(-370), effective: D(-370), route: 'sequential', trainingRule: null,
      periodic: { months: 12, notice: 60, approval: true }, reviewers: [], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-370) }],
      versions: [withSigs(ver('4.2', 'minor', 'Effective', 'Added the new firewall pair.', D(-372), 'u-sam', blocks('h', '1. Purpose', 'p', 'List the information assets in the ISMS scope and their owners.', 'h', '2. Register', 'p', 'Servers, network devices, laptops, cloud services and key data sets, each with an owner and classification.', 'h', '3. Ownership', 'p', 'IT Operations keeps the register current; owners confirm their entries every year.'), D(-370)), [sig(50, 'u-tom', 'Approved', D(-370))])],
      comments: []
    });
    doc({
      id: 'SOA-001', docType: 'Statement of Applicability', title: 'Statement of Applicability', state: 'Effective', classification: 'Confidential',
      owner: 'u-vic', author: 'u-vic', process: 'ISMS · Governance', template: 'TPL-REG', tags: ['Clause 6.1.3'],
      created: D(-500), modified: D(-15), effective: D(-15), route: 'sequential', trainingRule: null,
      periodic: { months: 12, notice: 60, approval: true }, reviewers: [], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-15) }],
      versions: [withSigs(ver('2.1', 'minor', 'Effective', 'Marked A.8.30 applicable (AI-assisted development treated as outsourced).', D(-18), 'u-vic', blocks('h', '1. Purpose', 'p', 'State which Annex A controls apply, why, and how they are implemented.', 'h', '2. Summary', 'p', '93 controls considered; 88 applicable; 5 excluded with justification.', 'h', '3. Changes in this version', 'p', 'A.8.30 Outsourced development is now applicable.'), D(-15)), [sig(115, 'u-tom', 'Approved', D(-15))])],
      comments: []
    });
    doc({
      id: 'PLN-001', docType: 'Plan', title: 'Incident Response Plan', state: 'Effective', classification: 'Restricted',
      owner: 'u-tom', author: 'u-priya', process: 'ISMS · Incident management', template: 'TPL-SOP', tags: ['A.5.24', 'A.5.26'],
      created: D(-300), modified: D(-120), effective: D(-120), route: 'sequential', trainingRule: null, namedAccess: ['u-sam', 'u-priya', 'u-tom', 'u-vic'],
      periodic: { months: 12, notice: 60, approval: true }, reviewers: [{ u: 'u-sam', status: 'Reviewed', at: D(-125) }], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-120) }],
      versions: [withSigs(ver('2.0', 'major', 'Effective', 'Added ransomware playbook and out-of-hours call tree.', D(-130), 'u-priya', blocks('h', '1. Purpose', 'p', 'How VeQMS detects, contains and recovers from security incidents.', 'h', '2. Call tree', 'p', '[Restricted: names and personal phone numbers of the incident team.]', 'h', '3. Ransomware playbook', 'p', 'Isolate affected hosts, preserve evidence from the anchored audit log, restore from backup per SOP-012.'), D(-120)), [sig(80, 'u-sam', 'Reviewed', D(-125)), sig(81, 'u-tom', 'Approved', D(-120))])],
      comments: []
    });
    doc({
      id: 'FRM-007', docType: 'Form', title: 'Access Request Form', state: 'Effective', classification: 'Internal',
      owner: 'u-sam', author: 'u-sam', process: 'ISMS · Access control', template: 'TPL-FRM', tags: ['A.5.18'],
      created: D(-500), modified: D(-240), effective: D(-240), route: 'sequential', trainingRule: null,
      periodic: { months: 24, notice: 60, approval: false }, reviewers: [], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-240) }],
      versions: [withSigs(ver('1.3', 'minor', 'Effective', 'Added system owner field.', D(-245), 'u-sam', blocks('h', '1. Requester', 'p', 'Name, role, manager.', 'h', '2. Request', 'p', 'System, access level, reason, end date if temporary.', 'h', '3. Approval', 'p', 'Manager, then system owner.'), D(-240)), [sig(40, 'u-tom', 'Approved', D(-240))])],
      comments: []
    });
    doc({
      id: 'WI-003', docType: 'Work instruction', title: 'New Starter Account Setup', state: 'Draft', classification: 'Internal',
      owner: 'u-sam', author: 'u-sam', process: 'ISMS · Access control', template: 'TPL-WI', tags: ['A.5.16'],
      created: D(-5), modified: D(-1), effective: null, route: 'parallel', trainingRule: 'TR-02', checkedOut: { u: 'u-sam', at: D(-1, 16, 20) },
      periodic: { months: 12, notice: 60, approval: false },
      reviewers: [{ u: 'u-priya', status: 'Not started' }, { u: 'u-omar', status: 'Not started' }], approvers: [{ u: 'u-tom', status: 'Waiting' }],
      versions: [ver('0.3', 'minor', 'Draft', 'Working draft.', D(-5), 'u-sam', blocks('h', '1. When to use this', 'p', 'When HR confirms a new starter in the HR system.', 'h', '2. Steps', 'p', 'Create the account from the HR record (SCIM). Add the starter to the groups their manager listed on FRM-007. Enrol MFA on day one.', 'h', '3. Checks', 'p', '[To be written.]'))],
      comments: []
    });
    S.docs = docs;

    // ---------------- Training ----------------
    S.trainingRules = [
      { id: 'TR-01', name: 'All staff', desc: 'Core ISMS policies everyone reads and accepts.', groups: ['All staff'], users: [], docs: ['POL-001', 'POL-009', 'SOP-012', 'POL-004'], days: 14, retrainMonths: 12, gate: false, quiz: true, version: 3, status: 'Active', approvedBy: 'u-vic', approvedAt: D(-100), createdBy: 'u-vic' },
      { id: 'TR-02', name: 'IT team', desc: 'Technical procedures for IT operations.', groups: ['IT team'], users: [], docs: ['SOP-018', 'WI-003'], days: 14, retrainMonths: 12, gate: true, quiz: false, version: 2, status: 'Active', approvedBy: 'u-vic', approvedAt: D(-150), createdBy: 'u-vic' },
      { id: 'TR-03', name: 'Managers', desc: 'Procedures that managers run or sign off.', groups: ['Managers'], users: ['u-mia'], docs: ['SOP-020', 'SOP-014'], days: 21, retrainMonths: null, gate: true, quiz: false, version: 1, status: 'Active', approvedBy: 'u-vic', approvedAt: D(-210), createdBy: 'u-vic' },
      { id: 'TR-04', name: 'Support team (Manila)', desc: 'Handling customer data on calls and in tickets.', groups: ['Support team'], users: [], docs: ['POL-009', 'FRM-007'], days: 10, retrainMonths: 12, gate: false, quiz: true, version: 1, status: 'Pending approval', approvedBy: null, createdBy: 'u-grace', createdAt: D(-2) }
    ];
    var asg = [];
    var n = 1;
    function A(user, docId, v, rule, assigned, due, completed, extra) {
      var o = { id: 'TA-' + (n++), user: user, doc: docId, ver: v, rule: rule, assigned: assigned, due: due, completed: completed || null };
      if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
      asg.push(o); return o;
    }
    var active = S.users.filter(function (u) { return u.status === 'Active' && u.groups.indexOf('All staff') >= 0; });
    var doneSop = { 'u-sam': -14, 'u-priya': -13, 'u-tom': -12, 'u-grace': -9, 'u-omar': -10, 'u-lena': -8, 'u-hannah': -6, 'u-mia': -5 };
    active.forEach(function (u) {
      A(u.id, 'SOP-012', '3.0', 'TR-01', D(-15), D(-1), doneSop[u.id] != null ? D(doneSop[u.id], 14) : null);
      A(u.id, 'POL-009', '1.2', 'TR-01', D(-55), D(-41), u.id === 'u-daniel' || u.id === 'u-vic' ? null : D(-45 + (u.initials.charCodeAt(0) % 4), 11));
      A(u.id, 'POL-001', '3.0', 'TR-01', D(-160), D(-146), D(-150 + (u.initials.charCodeAt(1) % 5), 10));
    });
    // Victoria's yearly retraining on POL-009 and Daniel's current set
    asg.forEach(function (a) {
      if (a.doc === 'POL-009' && a.user === 'u-vic') { a.assigned = D(-9); a.due = D(20); a.reason = 'Yearly retraining'; }
      if (a.doc === 'POL-009' && a.user === 'u-daniel') { a.assigned = D(-4); a.due = D(10); }
      if (a.doc === 'SOP-012' && a.user === 'u-daniel') { a.due = D(-3); }
    });
    A('u-mark', 'POL-009', '1.1', 'TR-01', D(-310), D(-296), D(-300), { leaver: true });
    A('u-mark', 'SOP-012', '2.1', 'TR-01', D(-298), D(-284), D(-290), { leaver: true });
    ['u-sam', 'u-priya', 'u-tom', 'u-omar', 'u-jake', 'u-hannah'].forEach(function (u, i) {
      A(u, 'SOP-018', '1.1', 'TR-02', D(-90), D(-76), i === 4 ? null : D(-85 + i, 10));
    });
    ['u-vic', 'u-tom', 'u-grace', 'u-mia'].forEach(function (u, i) { A(u, 'SOP-014', '1.4', 'TR-03', D(-200), D(-179), D(-190 + i)); });
    S.assignments = asg;

    // ---------------- Change requests ----------------
    S.crs = {
      'CR-015': {
        id: 'CR-015', title: 'Move backup copies to UK West', size: 'Major', state: 'Review', classification: 'Internal', owner: 'u-tom', createdBy: 'u-tom',
        process: 'ISMS · Continuity', created: D(-8), reviewDue: D(1), route: 'parallel',
        description: 'Copy encrypted database and file backups to the UK West region instead of keeping a second copy in UK South.',
        reason: 'A regional outage in UK South would take out both the live service and its backups. Step 1 set UK West as the backup region.',
        impact: 'IT Operations (backup jobs and restore tests), the asset inventory, and the backup procedure. No change for other staff.',
        impacted: ['Backup and continuity', 'Supplier management'], items: ['SOP-012', 'REG-002'],
        reviewers: [{ u: 'u-vic', status: 'Your turn' }, { u: 'u-priya', status: 'Reviewed', at: D(-1, 15, 5) }], approvers: [{ u: 'u-vic', status: 'Waiting' }],
        actions: [
          { id: 'A-1', title: 'Update backup procedure', desc: 'Add the UK West copy and the restore-from-UK-West steps.', doc: 'SOP-012', assignee: 'u-sam', due: D(14), sig: true, status: 'Not started' },
          { id: 'A-2', title: 'Run and record a restore test', desc: 'Restore last night’s backup from UK West into test and record the time taken.', doc: null, assignee: 'u-omar', due: D(18), sig: true, status: 'Not started' },
          { id: 'A-3', title: 'Update the asset inventory', desc: 'Add the UK West storage account.', doc: 'REG-002', assignee: 'u-sam', due: D(10), sig: false, status: 'Not started' }
        ],
        attachments: [{ name: 'region-pairing-notes.pdf', size: '214 KB', scan: 'clean', by: 'u-tom', at: D(-8) }, { name: 'backup-cost-estimate.xlsx', size: '38 KB', scan: 'clean', by: 'u-tom', at: D(-8), pdf: true }],
        effectiveness: { criteria: 'A restore from UK West completes within the 1-business-day RTO.', result: null },
        signatures: []
      },
      'CR-012': {
        id: 'CR-012', title: 'Review joiner and leaver steps', size: 'Major', state: 'In execution', classification: 'Internal', owner: 'u-grace', createdBy: 'u-grace',
        process: 'ISMS · People', created: D(-40), reviewDue: D(-30), route: 'parallel',
        description: 'Tighten the leaver steps so access ends within 60 minutes, and add revoke-now for urgent leavers.',
        reason: 'QE-012: a leaver’s account stayed active for 9 days.', impact: 'HR, IT Operations and all managers.',
        impacted: ['People', 'Access control'], items: ['SOP-014', 'FRM-007'],
        reviewers: [{ u: 'u-vic', status: 'Reviewed', at: D(-33) }, { u: 'u-tom', status: 'Reviewed', at: D(-32) }], approvers: [{ u: 'u-vic', status: 'Signed', at: D(-30) }],
        actions: [
          { id: 'A-4', title: 'Update leaver checklist in SOP-014', desc: 'Add the 60-minute target and the revoke-now step.', doc: 'SOP-014', assignee: 'u-sam', due: D(3), sig: true, status: 'In progress' },
          { id: 'A-5', title: 'Add revoke-now to the HR offboarding checklist', desc: '', doc: null, assignee: 'u-mia', due: D(-5), sig: false, status: 'Done', doneAt: D(-6) },
          { id: 'A-6', title: 'Add system owner field to FRM-007', desc: '', doc: 'FRM-007', assignee: 'u-sam', due: D(12), sig: true, status: 'Not started' }
        ],
        attachments: [], effectiveness: { criteria: 'Next three leavers lose access within 60 minutes (checked in the audit trail).', result: null },
        signatures: [{ id: 'SIG-90', stage: 'Plan approved', user: 'u-vic', meaning: 'Approved', at: D(-30, 11, 3) }]
      },
      'CR-014': {
        id: 'CR-014', title: 'Update password wording in the Information Security Policy', size: 'Minor', state: 'Planning', classification: 'Internal', owner: 'u-priya', createdBy: 'u-priya',
        process: 'ISMS · Governance', created: D(-2), reviewDue: D(9), route: 'parallel',
        description: 'Replace "change your password every 90 days" with the passphrase and MFA guidance.', reason: 'Forced expiry is no longer recommended practice; MFA is enforced for everyone.',
        impact: 'Wording only.', impacted: ['Governance'], items: ['POL-001'], reviewers: [{ u: 'u-sam', status: 'Not started' }], approvers: [{ u: 'u-vic', status: 'Waiting' }],
        actions: [{ id: 'A-7', title: 'Edit POL-001 section 3', desc: '', doc: 'POL-001', assignee: 'u-priya', due: D(12), sig: false, status: 'Not started' }],
        attachments: [], effectiveness: { criteria: 'Not required for minor changes.', result: null }, signatures: []
      },
      'CR-016': {
        id: 'CR-016', title: 'Add supplier security clauses to contracts', size: 'Major', state: 'Approval', classification: 'Confidential', owner: 'u-vic', createdBy: 'u-vic',
        process: 'ISMS · Supplier management', created: D(-12), reviewDue: D(-4), approvalDue: D(2), route: 'sequential',
        description: 'Add security, breach notification and right-to-audit clauses to the standard supplier contract.', reason: 'Gap found while drafting SOP-020.',
        impact: 'Contract owners and Finance. Existing contracts updated at renewal.', impacted: ['Supplier management'], items: ['SOP-020'],
        reviewers: [{ u: 'u-grace', status: 'Reviewed', at: D(-5) }], approvers: [{ u: 'u-tom', status: 'Your turn' }],
        actions: [{ id: 'A-8', title: 'Agree clause wording with legal adviser', desc: '', doc: null, assignee: 'u-vic', due: D(20), sig: false, status: 'Not started' }, { id: 'A-9', title: 'Send updated contract to the top 5 suppliers via DocuSign', desc: 'External signers, so this goes to DocuSign.', doc: null, assignee: 'u-grace', due: D(35), sig: true, status: 'Not started', docusign: true }],
        attachments: [{ name: 'draft-clauses.docx', size: '56 KB', scan: 'clean', by: 'u-vic', at: D(-12), pdf: true }], effectiveness: { criteria: 'All top-5 supplier contracts signed with the new clauses.', result: null }, signatures: []
      },
      'CR-010': {
        id: 'CR-010', title: 'Enforce MFA on VPN', size: 'Major', state: 'Effectiveness check', classification: 'Internal', owner: 'u-tom', createdBy: 'u-tom',
        process: 'ISMS · Access control', created: D(-75), reviewDue: D(-68), effectivenessDue: D(8), route: 'parallel',
        description: 'Require MFA for every VPN connection.', reason: 'Internal audit recommendation.', impact: 'Everyone who uses VPN.', impacted: ['Access control'], items: ['POL-004'],
        reviewers: [{ u: 'u-priya', status: 'Reviewed', at: D(-70) }], approvers: [{ u: 'u-vic', status: 'Signed', at: D(-66) }],
        actions: [{ id: 'A-10', title: 'Turn on MFA for VPN', desc: '', doc: null, assignee: 'u-omar', due: D(-40), sig: true, status: 'Done', doneAt: D(-41), signedBy: 'u-omar' }, { id: 'A-11', title: 'Tell staff and update the VPN guide', desc: '', doc: null, assignee: 'u-tom', due: D(-38), sig: false, status: 'Done', doneAt: D(-39) }],
        attachments: [], effectiveness: { criteria: 'No VPN sign-ins without MFA in 30 days of logs.', result: null }, signatures: [{ id: 'SIG-70', stage: 'Plan approved', user: 'u-vic', meaning: 'Approved', at: D(-66) }]
      },
      'CR-009': {
        id: 'CR-009', title: 'Retire the legacy file share', size: 'Minor', state: 'Closed', classification: 'Internal', owner: 'u-omar', createdBy: 'u-omar',
        process: 'ISMS · Asset management', created: D(-120), reviewDue: D(-110), route: 'parallel', closedAt: D(-20),
        description: 'Switch off the old file share after moving its content.', reason: 'Unsupported operating system.', impact: 'None after migration.', impacted: ['Asset management'], items: ['REG-002'],
        reviewers: [{ u: 'u-sam', status: 'Reviewed', at: D(-112) }], approvers: [{ u: 'u-tom', status: 'Signed', at: D(-108) }],
        actions: [{ id: 'A-12', title: 'Switch off the server', desc: '', doc: null, assignee: 'u-omar', due: D(-40), sig: true, status: 'Done', doneAt: D(-42), signedBy: 'u-omar' }],
        attachments: [], effectiveness: { criteria: 'No access attempts to the old share for 14 days.', result: 'No attempts logged in 21 days.', verdict: 'Effective', by: 'u-tom', at: D(-20) },
        signatures: [{ id: 'SIG-55', stage: 'Plan approved', user: 'u-tom', meaning: 'Approved', at: D(-108) }, { id: 'SIG-66', stage: 'Completion approved', user: 'u-tom', meaning: 'Approved', at: D(-20) }]
      }
    };

    // ---------------- Observations, quality events, CAPA ----------------
    S.obs = {
      'OBS-022': { id: 'OBS-022', title: 'Visitor badge not returned at reception', details: 'A contractor left without returning their visitor badge. Reception noticed at 17:30.', area: 'Physical security', raisedBy: 'u-ruth', at: D(0, 9, 12), state: 'New', owner: 'u-grace', attachments: [], location: 'London office, reception', classification: 'Internal' },
      'OBS-021': { id: 'OBS-021', title: 'Server room door propped open', details: 'The server room door was wedged open with a box during the afternoon. Nobody was inside.', area: 'Physical security', raisedBy: 'u-ruth', at: D(-1, 14, 40), state: 'New', owner: 'u-grace', attachments: [{ name: 'IMG_2041.jpg', size: '1.8 MB', scan: 'clean' }], location: 'London office, 2nd floor', classification: 'Internal' },
      'OBS-020': { id: 'OBS-020', title: 'Confidential printouts left on the shared printer', details: 'Payroll printouts left on the 1st floor printer overnight.', area: 'Information handling', raisedBy: 'u-lena', at: D(-6, 8, 55), state: 'Escalated', owner: 'u-grace', escalatedTo: 'QE-015', attachments: [], location: '', classification: 'Internal' },
      'OBS-019': { id: 'OBS-019', title: 'Fire extinguisher inspection tag expired', details: 'Tag on the kitchen extinguisher shows last inspection 14 months ago.', area: 'Facilities', raisedBy: 'u-jake', at: D(-20, 12, 30), state: 'Closed', owner: 'u-grace', closure: { justification: 'Outside the ISMS scope. Passed to Facilities (health and safety) as ticket FAC-118.', by: 'u-grace', at: D(-19) }, attachments: [], location: '', classification: 'Internal' }
    };
    S.events = {
      'QE-011': { id: 'QE-011', type: 'Audit finding', title: 'Internal audit finding: patch missed on file server', desc: 'The October internal audit found a critical patch released 41 days earlier not installed on FS-02.', state: 'CAPA raised', severity: 'High', classification: 'Confidential', owner: 'u-tom', process: 'ISMS · Vulnerability mgmt', due: D(-20), created: D(-30), tags: ['A.8.8', 'Internal audit'], assessment: 'Breach of SOP-018 patch window. Exposure limited: FS-02 is not internet-facing.', capa: 'CAPA-007' },
      'QE-012': { id: 'QE-012', type: 'Nonconformance', title: 'Leaver account left active for 9 days', desc: 'A leaver’s account remained active 9 days after their last day.', state: 'Closed', severity: 'High', classification: 'Confidential', owner: 'u-grace', process: 'ISMS · People', due: D(-60), created: D(-70), tags: ['A.5.18'], assessment: 'No sign of use after leaving (audit trail checked).', capa: 'CAPA-004', legalHold: true },
      'QE-013': { id: 'QE-013', type: 'Security incident', title: 'Staff clicked a phishing simulation link', desc: '6 of 22 staff clicked the link in the September phishing simulation.', state: 'CAPA raised', severity: 'Low', classification: 'Internal', owner: 'u-priya', process: 'ISMS · Awareness', due: D(-50), created: D(-58), tags: ['A.6.3'], assessment: 'Simulation only; no real compromise.', capa: 'CAPA-005' },
      'QE-014': { id: 'QE-014', type: 'Nonconformance', title: 'Visitor log not completed for one day', desc: 'Visitor log blank on a Friday; reception cover was off sick.', state: 'Closed', severity: 'Low', classification: 'Internal', owner: 'u-grace', process: 'ISMS · Physical security', due: D(-25), created: D(-28), tags: ['A.7.2'], assessment: 'One-off; cover arrangement now in place.', closure: { justification: 'One-off absence. Backup reception cover added to the office rota; no systemic cause.', by: 'u-grace', at: D(-24, 10, 15), sigId: 'SIG-98' } },
      'QE-015': { id: 'QE-015', type: 'Nonconformance', title: 'Confidential printouts left on the shared printer', desc: 'From OBS-020: payroll printouts left on the 1st floor printer overnight.', state: 'Assessment', severity: 'Low', classification: 'Internal', owner: 'u-grace', process: 'ISMS · Information handling', due: D(5), created: D(-5), tags: ['A.7.7'], assessment: '', source: 'OBS-020' },
      'QE-016': { id: 'QE-016', type: 'Audit finding', title: 'Two laptops found without disk encryption', desc: 'Device compliance report shows 2 of 24 laptops without disk encryption.', state: 'CAPA raised', severity: 'High', classification: 'Confidential', owner: 'u-omar', process: 'ISMS · Endpoint', due: D(-1), created: D(-4), tags: ['A.8.1', 'A.8.24'], assessment: 'Both laptops in the office; no loss reported.', capa: 'CAPA-008' }
    };
    S.capas = {
      'CAPA-007': {
        id: 'CAPA-007', title: 'Patch missed on file server', severity: 'High', classification: 'Confidential', state: 'Execution', source: 'QE-011', owner: 'u-tom', process: 'ISMS · Vulnerability mgmt',
        route: 'High severity: QM approval', created: D(-28), effectivenessPlan: '90 days after close of actions', actionsLocked: true,
        actions: [
          { id: 'CA-1', type: 'Corrective', title: 'Apply the missed patch and confirm', assignee: 'u-omar', due: D(-20), doc: null, sig: true, status: 'Done', doneAt: D(-21), signedBy: 'u-omar' },
          { id: 'CA-2', type: 'Corrective', title: 'Scan all servers for missing patches', assignee: 'u-vic', due: D(3), doc: null, sig: true, status: 'In progress' },
          { id: 'CA-3', type: 'Preventive', title: 'Add a monthly patch report to SOP-018', assignee: 'u-omar', due: D(14), doc: 'SOP-018', sig: true, status: 'Not started' }
        ],
        whys: ['The October patch for FS-02 was not installed.', 'FS-02 was left out of the Tuesday patch run.', 'FS-02 was moved to a new server group in September and the group was not in the patch schedule.', '', ''],
        problem: 'Internal audit found a critical patch released 41 days earlier not installed on FS-02.', rootWhy: 2,
        fishbone: { People: ['Change not announced to IT Ops'], Process: ['No check that new server groups join the patch schedule'], Technology: ['Patch tool shows success per group, not per server'], Environment: [], Suppliers: [], Measurement: ['No monthly missing-patch report'] },
        risk: { likelihood: 2, impact: 3, notes: 'Critical CVE; server not internet-facing. Residual risk after actions: low.' },
        evidence: [{ name: 'patch-report.xlsx', pdf: true, scan: 'clean', by: 'u-omar', at: D(-21) }, { name: 'screenshot-console.png', pdf: true, scan: 'scanning', by: 'u-omar', at: D(0, 8, 30) }],
        effectiveness: { due: null, criteria: 'No critical patch older than 7 days on any server for 90 days.', result: null }
      },
      'CAPA-005': {
        id: 'CAPA-005', title: 'Phishing simulation follow-up', severity: 'Low', classification: 'Internal', state: 'Effectiveness check', source: 'QE-013', owner: 'u-priya', process: 'ISMS · Awareness',
        route: 'Low severity: process owner approval', created: D(-55), effectivenessPlan: '60 days after close of actions', actionsLocked: true,
        actions: [
          { id: 'CA-4', type: 'Corrective', title: 'Short training session for the 6 people who clicked', assignee: 'u-priya', due: D(-40), doc: null, sig: false, status: 'Done', doneAt: D(-42) },
          { id: 'CA-5', type: 'Preventive', title: 'Add a "Report phishing" button to email', assignee: 'u-omar', due: D(-30), doc: null, sig: true, status: 'Done', doneAt: D(-33), signedBy: 'u-omar' }
        ],
        whys: ['Staff clicked a simulated phishing link.', 'They did not spot the lookalike domain.', 'Awareness training did not cover lookalike domains.', '', ''], problem: '6 of 22 staff clicked the link in the September phishing simulation.', rootWhy: 2,
        fishbone: { People: ['New starters not yet trained'], Process: ['Training content last updated 2 years ago'], Technology: ['No external-sender banner'], Environment: [], Suppliers: [], Measurement: [] },
        risk: { likelihood: 2, impact: 2, notes: '' }, evidence: [{ name: 'training-attendance.pdf', pdf: false, scan: 'clean', by: 'u-priya', at: D(-42) }],
        effectiveness: { due: D(17), assignee: 'u-vic', criteria: 'Next simulation click rate under 10%.', result: null }
      },
      'CAPA-004': {
        id: 'CAPA-004', title: 'Leaver account left active', severity: 'High', classification: 'Confidential', state: 'Closed', source: 'QE-012', owner: 'u-grace', process: 'ISMS · People',
        route: 'High severity: QM approval', created: D(-68), closedAt: D(-10), effectivenessPlan: '30 days after close of actions', actionsLocked: true,
        actions: [{ id: 'CA-6', type: 'Corrective', title: 'Disable the account and check its use', assignee: 'u-hannah', due: D(-66), doc: null, sig: true, status: 'Done', doneAt: D(-67), signedBy: 'u-hannah' }, { id: 'CA-7', type: 'Preventive', title: 'Raise CR-012 to fix the leaver steps', assignee: 'u-grace', due: D(-45), doc: 'SOP-014', sig: false, status: 'Done', doneAt: D(-46) }],
        whys: ['A leaver’s account stayed active for 9 days.', 'IT was not told of the leaving date.', 'HR relied on an email that went to a shared inbox nobody watched.', '', ''], problem: 'Leaver account active for 9 days.', rootWhy: 2,
        fishbone: { People: [], Process: ['Leaver notice by email'], Technology: ['No SCIM link from HR'], Environment: [], Suppliers: [], Measurement: [] },
        risk: { likelihood: 2, impact: 3, notes: '' }, evidence: [],
        effectiveness: { due: D(-10), criteria: 'Next 3 leavers deprovisioned within 60 minutes.', result: '3 of 3 leavers removed within 35 minutes.', verdict: 'Effective', by: 'u-vic', at: D(-10) }
      },
      'CAPA-008': {
        id: 'CAPA-008', title: 'Laptops without disk encryption', severity: 'High', classification: 'Confidential', state: 'Planning', source: 'QE-016', owner: 'u-omar', process: 'ISMS · Endpoint',
        route: 'High severity: QM approval', created: D(-3), effectivenessPlan: '30 days after close of actions', actionsLocked: false,
        actions: [{ id: 'CA-8', type: 'Corrective', title: 'Encrypt the two laptops', assignee: 'u-omar', due: D(4), doc: null, sig: true, status: 'Not started' }],
        whys: ['', '', '', '', ''], problem: 'Device compliance report shows 2 of 24 laptops without disk encryption.', rootWhy: null,
        fishbone: { People: [], Process: [], Technology: [], Environment: [], Suppliers: [], Measurement: [] },
        risk: { likelihood: null, impact: null, notes: '' }, evidence: [], effectiveness: { due: null, criteria: '', result: null }
      }
    };

    // ---------------- Periodic reviews ----------------
    S.reviews = {
      'PR-031': { id: 'PR-031', doc: 'POL-001', reviewer: 'u-vic', due: D(2), notice: 60, approval: true, created: D(-58), state: 'Open' },
      'PR-032': { id: 'PR-032', doc: 'REG-002', reviewer: 'u-sam', due: D(-5), notice: 60, approval: true, created: D(-65), state: 'Open' },
      'PR-033': { id: 'PR-033', doc: 'SOP-018', reviewer: 'u-omar', due: D(20), notice: 60, approval: true, created: D(-40), state: 'Open' },
      'PR-034': { id: 'PR-034', doc: 'POL-009', reviewer: 'u-vic', due: D(45), notice: 60, approval: true, created: D(-15), state: 'Open' },
      'PR-036': { id: 'PR-036', doc: 'PLN-001', reviewer: 'u-tom', due: D(9), notice: 60, approval: true, created: D(-51), state: 'Open' },
      'PR-037': { id: 'PR-037', doc: 'REG-001', reviewer: 'u-vic', due: D(26), notice: 30, approval: true, created: D(-4), state: 'Open' },
      'PR-029': { id: 'PR-029', doc: 'FRM-007', reviewer: 'u-sam', due: D(-28), notice: 60, approval: false, created: D(-88), state: 'Completed', outcome: 'No update needed', completedAt: D(-30), sigId: 'SIG-92', nextDue: D(700) },
      'PR-030': { id: 'PR-030', doc: 'SOP-014', reviewer: 'u-mia', due: D(-38), notice: 60, approval: true, created: D(-98), state: 'Completed', outcome: 'Needs update', completedAt: D(-41), followUp: 'CR-012' }
    };

    // ---------------- Links (visible from both ends) ----------------
    S.links = [
      ['POL-004', 'CR-012'], ['POL-004', 'CAPA-004'], ['CR-012', 'CAPA-004'], ['CR-012', 'SOP-014'], ['CR-012', 'FRM-007'], ['QE-012', 'CAPA-004'],
      ['CR-015', 'SOP-012'], ['CR-015', 'REG-002'], ['QE-011', 'CAPA-007'], ['CAPA-007', 'SOP-018'], ['QE-013', 'CAPA-005'],
      ['OBS-020', 'QE-015'], ['CR-014', 'POL-001'], ['CR-016', 'SOP-020'], ['CR-010', 'POL-004'], ['CR-009', 'REG-002'], ['QE-016', 'CAPA-008'],
      ['PR-030', 'CR-012']
    ];

    // ---------------- Tasks (My Work) ----------------
    S.tasks = [
      { id: 'T-1', kind: 'approve-doc', record: 'POL-004', assignee: 'u-vic', due: D(-2), created: D(-6, 15, 45), status: 'open', note: 'You are approver 1 of 2 · sequential route' },
      { id: 'T-2', kind: 'training', record: 'SOP-012', assignee: 'u-vic', due: D(-1), created: D(-15), status: 'open', ref: 'SOP-012' },
      { id: 'T-3', kind: 'periodic', record: 'PR-031', assignee: 'u-vic', due: D(2), created: D(-58), status: 'open' },
      { id: 'T-4', kind: 'cr-review', record: 'CR-015', assignee: 'u-vic', due: D(1), created: D(-3), status: 'open' },
      { id: 'T-5', kind: 'capa-action', record: 'CAPA-007', assignee: 'u-vic', due: D(3), created: D(-25), status: 'open', ref: 'CA-2' },
      { id: 'T-6', kind: 'fyi', record: 'SOP-020', assignee: 'u-vic', due: D(9), created: D(-3), status: 'open', fyi: true },
      { id: 'T-7', kind: 'effectiveness', record: 'CAPA-005', assignee: 'u-vic', due: D(17), created: D(-30), status: 'open' },
      { id: 'T-8', kind: 'training', record: 'POL-009', assignee: 'u-vic', due: D(20), created: D(-9), status: 'open', ref: 'POL-009' },
      { id: 'T-9', kind: 'review-doc', record: 'SOP-020', assignee: 'u-priya', due: D(1), created: D(-3), status: 'open' },
      { id: 'T-10', kind: 'fyi', record: 'POL-004', assignee: 'u-tom', due: D(4), created: D(-6), status: 'open', fyi: true, note: 'You approve after Victoria E.' },
      { id: 'T-11', kind: 'cr-approve', record: 'CR-016', assignee: 'u-tom', due: D(2), created: D(-4), status: 'open' },
      { id: 'T-12', kind: 'cr-effectiveness', record: 'CR-010', assignee: 'u-tom', due: D(8), created: D(-36), status: 'open' },
      { id: 'T-13', kind: 'periodic', record: 'PR-036', assignee: 'u-tom', due: D(9), created: D(-51), status: 'open' },
      { id: 'T-14', kind: 'author', record: 'WI-003', assignee: 'u-sam', due: D(5), created: D(-5), status: 'open' },
      { id: 'T-15', kind: 'periodic', record: 'PR-032', assignee: 'u-sam', due: D(-5), created: D(-65), status: 'open' },
      { id: 'T-16', kind: 'cr-action', record: 'CR-012', assignee: 'u-sam', due: D(3), created: D(-30), status: 'open', ref: 'A-4' },
      { id: 'T-17', kind: 'obs-review', record: 'OBS-021', assignee: 'u-grace', due: D(2), created: D(-1), status: 'open' },
      { id: 'T-18', kind: 'obs-review', record: 'OBS-022', assignee: 'u-grace', due: D(3), created: D(0), status: 'open' },
      { id: 'T-19', kind: 'qe-assess', record: 'QE-015', assignee: 'u-grace', due: D(5), created: D(-5), status: 'open' },
      { id: 'T-20', kind: 'training', record: 'SOP-012', assignee: 'u-daniel', due: D(-3), created: D(-15), status: 'open', ref: 'SOP-012' },
      { id: 'T-21', kind: 'training', record: 'POL-009', assignee: 'u-daniel', due: D(10), created: D(-4), status: 'open', ref: 'POL-009' },
      { id: 'T-22', kind: 'capa-plan', record: 'CAPA-008', assignee: 'u-omar', due: D(4), created: D(-3), status: 'open' },
      { id: 'T-23', kind: 'capa-action', record: 'CAPA-007', assignee: 'u-omar', due: D(14), created: D(-25), status: 'open', ref: 'CA-3' },
      { id: 'T-24', kind: 'periodic', record: 'PR-033', assignee: 'u-omar', due: D(20), created: D(-40), status: 'open' },
      { id: 'T-25', kind: 'todo', record: 'ADMIN-DLQ', assignee: 'u-hannah', due: D(0), created: D(-1), status: 'open', title: '2 failed automations need a look', href: '#/admin/automations?tab=failed' },
      { id: 'T-26', kind: 'todo', record: 'ADMIN-AR', assignee: 'u-hannah', due: D(10), created: D(-20), status: 'open', title: 'Quarterly access review report (Q4)', href: '#/admin/users?tab=review' },
      { id: 'T-27', kind: 'rule-approve', record: 'TR-04', assignee: 'u-vic', due: D(5), created: D(-2), status: 'open' },
      { id: 'T-28', kind: 'training', record: 'SOP-012', assignee: 'u-jake', due: D(-1), created: D(-15), status: 'open', ref: 'SOP-012' },
      { id: 'T-29', kind: 'training', record: 'SOP-012', assignee: 'u-ruth', due: D(-1), created: D(-15), status: 'open', ref: 'SOP-012' },
      { id: 'T-30', kind: 'training', record: 'SOP-018', assignee: 'u-jake', due: D(-76), created: D(-90), status: 'open', ref: 'SOP-018' },
      { id: 'T-31', kind: 'cr-action', record: 'CR-012', assignee: 'u-sam', due: D(12), created: D(-30), status: 'open', ref: 'A-6' },
      { id: 'T-32', kind: 'approve-doc', record: 'POL-003', assignee: 'u-vic', due: D(4), created: D(-1, 10, 41), status: 'open', note: 'Parallel route · you are also the author' },
      { id: 'T-33', kind: 'approve-doc', record: 'POL-003', assignee: 'u-tom', due: D(4), created: D(-1, 10, 41), status: 'open', note: 'Parallel route' }
    ];

    // ---------------- Notifications ----------------
    S.notifications = [
      { id: 'N-1', to: 'u-vic', at: D(-6, 15, 45), kind: 'action', title: 'Your turn to approve POL-004 v2.0', body: 'Review closed with 1 open comment. You are approver 1 of 2.', record: 'POL-004', read: false, mandatory: true, channels: ['in-app', 'email', 'teams', 'push'] },
      { id: 'N-2', to: 'u-vic', at: D(0, 7, 0), kind: 'overdue', title: 'Overdue: approve POL-004 v2.0', body: 'Approval was due ' + Q.fmtShort(D(-2)) + '. The record owner has been told.', record: 'POL-004', read: false, mandatory: true, channels: ['in-app', 'email', 'teams'] },
      { id: 'N-3', to: 'u-vic', at: D(-3, 9, 2), kind: 'action', title: 'CR-015 is ready for your review', body: 'Major change · parallel review · due ' + Q.fmtDay(D(1)), record: 'CR-015', read: false, mandatory: true, channels: ['in-app', 'email', 'teams', 'push'] },
      { id: 'N-4', to: 'u-vic', at: D(-3, 9, 5), kind: 'fyi', title: 'FYI: you’ll be asked to approve SOP-020', body: 'Expected around ' + Q.fmtDay(D(9)) + ', after review.', record: 'SOP-020', read: true, channels: ['in-app'] },
      { id: 'N-5', to: 'u-vic', at: D(-2, 8, 0), kind: 'reminder', title: 'Reminder: SOP-012 training is due tomorrow', body: 'Read and confirm · Rule: All staff', record: 'SOP-012', read: true, channels: ['in-app', 'email', 'teams'] },
      { id: 'N-6', to: 'u-vic', at: D(-4, 11, 30), kind: 'info', title: 'High-severity event QE-016 raised', body: 'Two laptops found without disk encryption. CAPA-008 created.', record: 'QE-016', read: true, channels: ['in-app', 'email', 'teams'] },
      { id: 'N-7', to: 'u-vic', at: D(-2, 10, 12), kind: 'info', title: 'Training rule TR-04 needs your approval', body: 'Louise Harvey created "Support team (Manila)". Rules go live only after approval.', record: 'TR-04', read: false, channels: ['in-app', 'email'] },
      { id: 'N-8', to: 'u-vic', at: D(-5, 18, 2), kind: 'security', title: 'New sign-in from a new device', body: 'Safari on macOS, London. If this was not you, tell IT at once.', record: null, read: true, mandatory: true, channels: ['email'] },
      { id: 'N-9', to: 'u-tom', at: D(-6, 15, 45), kind: 'fyi', title: 'FYI: you’ll be asked to approve POL-004 v2.0', body: 'You approve after Victoria E. (sequential route).', record: 'POL-004', read: false, channels: ['in-app', 'email'] },
      { id: 'N-10', to: 'u-tom', at: D(-4, 9, 0), kind: 'action', title: 'Your turn to approve the plan for CR-016', body: 'Major change · due ' + Q.fmtDay(D(2)), record: 'CR-016', read: false, mandatory: true, channels: ['in-app', 'email', 'teams', 'push'] },
      { id: 'N-11', to: 'u-grace', at: D(-1, 14, 41), kind: 'action', title: 'New observation OBS-021 to review', body: 'Server room door propped open · raised by Ruth Adeyemi', record: 'OBS-021', read: false, mandatory: true, channels: ['in-app', 'email', 'teams', 'push'] },
      { id: 'N-12', to: 'u-daniel', at: D(-1, 7, 0), kind: 'overdue', title: 'Overdue: SOP-012 training', body: 'Your manager Louise Harvey has been told. Repeats every 2 days.', record: 'SOP-012', read: false, mandatory: true, channels: ['in-app', 'email', 'teams'] },
      { id: 'N-13', to: 'u-sam', at: D(-3, 7, 0), kind: 'overdue', title: 'Overdue: periodic review of REG-002', body: 'Due ' + Q.fmtShort(D(-5)) + '. Your manager has been told.', record: 'PR-032', read: false, mandatory: true, channels: ['in-app', 'email', 'teams'] },
      { id: 'N-14', to: 'u-hannah', at: D(-1, 3, 12), kind: 'info', title: '2 automations failed after 6 tries', body: 'They are in the dead-letter queue. Nothing was lost; retry when the connector is fixed.', record: null, href: '#/admin/automations?tab=failed', read: false, channels: ['in-app', 'email'] }
    ];

    // ---------------- Automation rules (defaults from section 6.3) ----------------
    function R(id, name, event, cond, actions, channels, status, extra) {
      var r = { id: id, name: name, event: event, conditions: cond, actions: actions, channels: channels, status: status, version: 1, approvedBy: status === 'Active' ? 'u-vic' : null, approvedAt: status === 'Active' ? D(-100) : null, runs: 0, lastRun: null };
      if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
      return r;
    }
    S.rules = [
      R('RULE-01', 'Task assigned', 'Task assigned', 'Any module', ['Notify task owner'], ['Email', 'Teams', 'In-app', 'Push'], 'Active', { mandatory: true, runs: 214 }),
      R('RULE-02', 'Your turn in a workflow', 'Stage reached', 'Any module · review, approve or sign', ['Notify current-stage reviewers or approvers'], ['Email', 'Teams', 'In-app', 'Push'], 'Active', { mandatory: true, runs: 96 }),
      R('RULE-03', 'FYI to later stages', 'Item entered workflow', 'Any module', ['Notify later-stage reviewers and approvers (FYI)'], ['In-app', 'Email (optional)'], 'Active', { runs: 61 }),
      R('RULE-04', 'Stage completed', 'State changed', 'Any module', ['Notify record owner', 'Notify next stage'], ['In-app', 'Email'], 'Active', { runs: 133 }),
      R('RULE-05', 'Sent back or rejected', 'Task rejected or sent back', 'Any module', ['Notify author or owner', 'Notify earlier participants with the reason'], ['Email', 'Teams', 'In-app'], 'Active', { runs: 12 }),
      R('RULE-06', 'Reminder before due date', 'Due date approaching', '3 days and 1 day before', ['Notify task owner'], ['Email', 'Teams'], 'Active', { runs: 340 }),
      R('RULE-07', 'Overdue escalation', 'Due date passed', 'Day 2, then every 2 days', ['Notify task owner', 'Notify their manager'], ['Email', 'Teams'], 'Active', { mandatory: true, runs: 47, version: 2 }),
      R('RULE-08', 'Overdue: Quality Manager step', 'Due date passed', 'After manager escalation', ['Notify Quality Manager'], ['Email', 'Teams'], 'Off', { note: 'Switch on once a Quality Manager is appointed.' }),
      R('RULE-09', 'New document effective', 'Document became effective', 'Document has a training rule', ['Assign training to everyone in matching rules', 'Notify trainees'], ['Email', 'In-app', 'Push'], 'Active', { runs: 18 }),
      R('RULE-10', 'Periodic review due', 'Periodic review due', 'At the advance-notice date', ['Create review task', 'Notify document owner'], ['Email', 'Teams'], 'Active', { runs: 22 }),
      R('RULE-11', 'High-severity event or CAPA', 'Record created', 'Quality event or CAPA · severity High', ['Notify Quality Manager and process owner', 'Post to Teams channel #quality-events'], ['Email', 'Teams channel'], 'Active', { runs: 4 }),
      R('RULE-12', 'Signature completed', 'Signature completed', 'In-app or DocuSign', ['Notify record owner'], ['In-app', 'Email'], 'Active', { runs: 88 }),
      R('RULE-13', 'Security events', 'Security event', 'New device, MFA change, role change', ['Notify affected user', 'Notify admins of privilege changes'], ['Email'], 'Active', { mandatory: true, runs: 9 }),
      R('RULE-14', 'Publish effective documents to SharePoint', 'Document became effective', 'Classification Public or Internal', ['Publish read-only watermarked PDF', 'Archive superseded version'], ['SharePoint'], 'Pending approval', { createdBy: 'u-hannah', createdAt: D(-1), version: 1, note: 'Phase 2 · Option A publish-only' })
    ];
    S.runs = [
      { id: 'RUN-1', rule: 'RULE-07', at: D(0, 7, 0), event: 'Due date passed', record: 'POL-004', result: 'Sent', detail: 'Owner + manager notified (day 2)' },
      { id: 'RUN-2', rule: 'RULE-06', at: D(-2, 8, 0), event: 'Due date approaching', record: 'SOP-012', result: 'Sent', detail: '1-day reminder to Victoria E.' },
      { id: 'RUN-3', rule: 'RULE-11', at: D(-4, 11, 30), event: 'Record created', record: 'QE-016', result: 'Partly failed', detail: 'Email sent; Teams channel post failed (connector off)' },
      { id: 'RUN-4', rule: 'RULE-02', at: D(-3, 9, 2), event: 'Stage reached', record: 'CR-015', result: 'Sent', detail: '2 reviewers notified' },
      { id: 'RUN-5', rule: 'RULE-03', at: D(-3, 9, 5), event: 'Item entered workflow', record: 'SOP-020', result: 'Sent', detail: 'FYI to Victoria E.' }
    ];
    S.deadLetter = [
      { id: 'DLQ-1', rule: 'RULE-11', at: D(-4, 11, 31), record: 'QE-016', channel: 'Teams channel', target: '#quality-events', attempts: 6, error: 'Teams connector is switched off (Phase 6).', status: 'Failed' },
      { id: 'DLQ-2', rule: 'RULE-02', at: D(-1, 3, 12), record: 'CR-015', channel: 'Teams', target: 'Victoria E.', attempts: 6, error: 'Bot is not installed for this user.', status: 'Failed' }
    ];

    // ---------------- Integrations ----------------
    S.integrations = [
      { id: 'entra', name: 'Microsoft Entra ID sign-in', mech: 'OIDC + Conditional Access; authentication context for signing', perms: 'openid, profile, offline_access; API scope', phase: 'Phase 1', on: true, health: 'ok', lastOk: D(0, 9, 58), failures: 0, queue: 0 },
      { id: 'scim', name: 'User provisioning (SCIM from Entra ID)', mech: 'Entra pushes users and groups to the SCIM endpoint (periodic cycles)', perms: 'Secret token for the SCIM endpoint; no Graph directory read', phase: 'Phase 1', on: true, health: 'ok', lastOk: D(0, 9, 40), failures: 0, queue: 0 },
      { id: 'mail', name: 'Outlook email (QMS mailbox)', mech: 'Microsoft Graph send-mail from the shared QMS mailbox', perms: 'Mail.Send (application), limited to the QMS mailbox by Exchange RBAC for Applications', phase: 'Phase 1', on: true, health: 'ok', lastOk: D(0, 10, 1), failures: 0, queue: 0 },
      { id: 'teams', name: 'Microsoft Teams bot', mech: 'Azure Bot Service; proactive messages with Adaptive Cards', perms: 'Bot installed only in QMS-related teams', phase: 'Phase 6', on: false, health: 'off', lastOk: null, failures: 2, queue: 2, note: 'Waiting on IT: custom Teams apps allowed?' },
      { id: 'sp-pub', name: 'SharePoint publishing (Option A)', mech: 'Graph drive upload to one publication library; superseded versions to an archive library', perms: 'Sites.Selected, write grant on the QMS site only', phase: 'Phase 2', on: false, health: 'off', lastOk: null, failures: 0, queue: 0 },
      { id: 'sp-imp', name: 'SharePoint import (Option B)', mech: 'One-time Graph read of the legacy library into drafts', perms: 'Sites.Selected read grant on the legacy site, revoked after migration', phase: 'Phase 2', on: false, health: 'off', lastOk: null, failures: 0, queue: 0 },
      { id: 'docusign', name: 'DocuSign eSignature', mech: 'REST API with JWT grant; Connect webhook verified with HMAC-SHA256', perms: 'Integration user limited to QMS envelopes', phase: 'Phase 6', on: false, health: 'off', lastOk: null, failures: 0, queue: 0 }
    ];

    // ---------------- Workflow definitions (versioned) ----------------
    S.workflows = [
      { id: 'WF-DOC', name: 'Document lifecycle', module: 'Documents', version: 3, status: 'Active', approvedBy: 'u-vic', states: ['Draft', 'In review', 'Review closed', 'In approval', 'Pending training', 'Effective', 'Superseded', 'Obsolete'], transitions: [
        { from: 'Draft', to: 'In review', roles: 'Author', sig: null, sod: '', sla: '—', fields: 'Change summary, reviewers, approvers' },
        { from: 'In review', to: 'Review closed', roles: 'System (all reviewers done)', sig: 'Reviewed', sod: '', sla: '5 days', fields: '' },
        { from: 'In review', to: 'Draft', roles: 'Reviewer', sig: null, sod: '', sla: '', fields: 'Reason' },
        { from: 'Review closed', to: 'In approval', roles: 'Author', sig: null, sod: '', sla: '', fields: '' },
        { from: 'In approval', to: 'Pending training', roles: 'Approver (all, in order)', sig: 'Approved', sod: 'Author cannot approve', sla: '5 days', fields: '' },
        { from: 'In approval', to: 'Draft', roles: 'Approver', sig: null, sod: '', sla: '', fields: 'Reason' },
        { from: 'Pending training', to: 'Effective', roles: 'System (training rule met)', sig: null, sod: '', sla: 'Rule time allowed', fields: '' },
        { from: 'Effective', to: 'Superseded', roles: 'System (new version effective)', sig: null, sod: '', sla: '', fields: '' },
        { from: 'Effective', to: 'Obsolete', roles: 'Quality Manager', sig: 'Approved', sod: '', sla: '', fields: 'Reason' }
      ] },
      { id: 'WF-CR', name: 'Change request', module: 'Change requests', version: 2, status: 'Active', approvedBy: 'u-vic', states: ['Planning', 'Review', 'Approval', 'In execution', 'Effectiveness check', 'Closed'], transitions: [
        { from: 'Planning', to: 'Review', roles: 'Process owner', sig: null, sod: '', sla: '', fields: 'Description, reason, impact, at least one action' },
        { from: 'Review', to: 'Approval', roles: 'System (all reviewers done)', sig: null, sod: '', sla: '5 days', fields: '' },
        { from: 'Approval', to: 'In execution', roles: 'Approver', sig: 'Approved (plan)', sod: 'Owner cannot approve own plan', sla: '5 days', fields: '' },
        { from: 'In execution', to: 'Effectiveness check', roles: 'System (all actions done)', sig: null, sod: '', sla: '', fields: '' },
        { from: 'Effectiveness check', to: 'Closed', roles: 'Approver', sig: 'Approved (completion)', sod: '', sla: '', fields: 'Result, verdict' }
      ] },
      { id: 'WF-CAPA', name: 'CAPA', module: 'Quality events and CAPA', version: 2, status: 'Active', approvedBy: 'u-vic', states: ['Planning', 'Execution', 'Effectiveness check', 'Closed'], transitions: [
        { from: 'Planning', to: 'Execution', roles: 'Process owner', sig: 'Approved (actions)', sod: '', sla: '', fields: 'At least one action; route by severity' },
        { from: 'Execution', to: 'Effectiveness check', roles: 'QM (High) or process owner (Low)', sig: 'Approved (completed actions)', sod: 'Action owner cannot approve own action', sla: '', fields: 'Root cause, evidence' },
        { from: 'Effectiveness check', to: 'Closed', roles: 'Quality Manager', sig: 'Verified', sod: '', sla: '', fields: 'Result, verdict' }
      ] },
      { id: 'WF-QE', name: 'Quality event', module: 'Quality events and CAPA', version: 1, status: 'Active', approvedBy: 'u-vic', states: ['Open', 'Assessment', 'CAPA raised', 'Closed'], transitions: [
        { from: 'Open', to: 'Assessment', roles: 'Owner', sig: null, sod: '', sla: '2 days', fields: '' },
        { from: 'Assessment', to: 'CAPA raised', roles: 'Owner', sig: null, sod: '', sla: '', fields: 'Assessment, severity' },
        { from: 'Assessment', to: 'Closed', roles: 'Owner', sig: 'Closed without CAPA', sod: '', sla: '', fields: 'Justification' }
      ] },
      { id: 'WF-DOC-4', name: 'Document lifecycle (draft v4: add legal review for contracts)', module: 'Documents', version: 4, status: 'Pending approval', approvedBy: null, states: ['Draft', 'In review', 'Legal review', 'Review closed', 'In approval', 'Pending training', 'Effective'], transitions: [] }
    ];

    // ---------------- Settings ----------------
    S.settings = {
      orgName: 'VeQMS',
      statement: 'I sign this record with the meaning “{meaning}”. I understand this electronic signature is the legally binding equivalent of my handwritten signature.',
      meanings: ['Approved', 'Reviewed', 'Authored', 'Verified', 'Completed', 'Closed without CAPA', 'No update needed'],
      classes: {
        Public: { download: true, print: true, watermark: false, desc: 'Can be shared outside VeQMS.' },
        Internal: { download: true, print: true, watermark: true, desc: 'Staff only. Downloads carry a viewer watermark.' },
        Confidential: { download: true, print: false, watermark: true, desc: 'Named groups. No printing; downloads watermarked and logged.' },
        Restricted: { download: false, print: false, watermark: true, desc: 'Named people only. Download needs Restricted clearance; every attempt is logged.' }
      },
      escalation: { firstDays: 2, repeatDays: 2, qmStep: false },
      reminders: [3, 1],
      sod: { authorCannotApprove: true, adminCannotApprove: true },
      regulated: { Documents: false, 'Change requests': false, CAPA: false, 'Quality events': false, Training: false },
      ai: { enabled: false, provider: null },
      anchorMinutes: 15,
      lastAnchor: D(0, 9, 45),
      sessionTimeout: 30,
      leaverTarget: 60,
      supportOwners: ['u-vic'],
      retention: [
        { type: 'Controlled documents and versions', keep: 'Life of the system + 10 years', after: 'Archive' },
        { type: 'Signatures and audit trail', keep: 'Life of the system + 10 years', after: 'Archive' },
        { type: 'Training records (incl. leavers)', keep: '6 years after leaving', after: 'Review, then delete' },
        { type: 'Quality events and CAPA', keep: '10 years after closure', after: 'Review, then delete' },
        { type: 'Unsubmitted drafts and temporary files', keep: '90 days', after: 'Secure deletion with log' },
        { type: 'Notification log', keep: '2 years', after: 'Secure deletion with log' }
      ],
      legalHolds: [{ record: 'QE-012', reason: 'Possible employment claim', by: 'u-vic', at: D(-60) }]
    };

    S.prefs = {};
    S.delegations = [{ id: 'DEL-1', from: 'u-tom', to: 'u-priya', start: D(20), end: D(27), scope: 'Review only', reason: 'Annual leave' }];
    S.savedViews = { 'u-vic': [{ name: 'My approvals', kinds: ['approve-doc', 'cr-approve', 'rule-approve'] }, { name: 'Training only', kinds: ['training'] }] };
    S.drafts = [];
    S.roleRequests = [{ id: 'RR-1', user: 'u-grace', role: 'approver', requestedBy: 'u-hannah', at: D(-1, 16), status: 'Waiting for second admin' }];
    S.notifLog = [];
    S.audit = [];
    S.signatures = []; // global, insert-only list (manifest pages read from here)
    return S;
  };

  // History used to seed the audit trail. Each becomes a hash-chained entry.
  Q.seedHistory = function () {
    return [
      [-400, 9, 0, 'u-sam', 'create', 'Document', 'POL-004', 'Created POL-004 from template TPL-POL'],
      [-390, 14, 2, 'u-tom', 'sign', 'Document', 'POL-004', 'Signed POL-004 v1.0 · Approved'],
      [-160, 9, 30, 'u-hannah', 'role.change', 'User', 'u-priya', 'Granted Reviewer to Carrie Foreman'],
      [-70, 11, 0, 'u-grace', 'create', 'Quality event', 'QE-012', 'Raised QE-012 Leaver account left active'],
      [-60, 10, 0, 'u-vic', 'legal-hold', 'Quality event', 'QE-012', 'Placed QE-012 on legal hold'],
      [-58, 9, 0, 'u-priya', 'create', 'Quality event', 'QE-013', 'Raised QE-013 Phishing simulation'],
      [-40, 10, 0, 'u-grace', 'create', 'Change request', 'CR-012', 'Created CR-012'],
      [-30, 11, 3, 'u-vic', 'sign', 'Change request', 'CR-012', 'Signed CR-012 plan · Approved'],
      [-30, 9, 0, 'u-tom', 'create', 'Quality event', 'QE-011', 'Raised QE-011 Internal audit finding'],
      [-28, 9, 30, 'u-tom', 'create', 'CAPA', 'CAPA-007', 'Created CAPA-007 from QE-011'],
      [-24, 10, 15, 'u-grace', 'sign', 'Quality event', 'QE-014', 'Closed QE-014 without CAPA · signed with justification'],
      [-21, 15, 0, 'u-omar', 'sign', 'CAPA', 'CAPA-007', 'Signed action CA-1 · Completed'],
      [-17, 16, 40, 'u-tom', 'sign', 'Document', 'SOP-012', 'Signed SOP-012 v3.0 · Approved'],
      [-16, 11, 2, 'u-vic', 'sign', 'Document', 'SOP-012', 'Signed SOP-012 v3.0 · Approved'],
      [-16, 11, 3, 'system', 'state', 'Document', 'SOP-012', 'SOP-012 v3.0 Effective; v2.1 Superseded'],
      [-15, 0, 5, 'system', 'automation', 'Document', 'SOP-012', 'RULE-09 assigned SOP-012 training to 13 people'],
      [-14, 9, 18, 'u-sam', 'state', 'Document', 'POL-004', 'Submitted v2.0 for review'],
      [-12, 10, 0, 'u-vic', 'create', 'Change request', 'CR-016', 'Created CR-016'],
      [-11, 10, 5, 'u-priya', 'review', 'Document', 'POL-004', 'Marked reviewed'],
      [-9, 14, 0, 'u-grace', 'create', 'Document', 'SOP-020', 'Created SOP-020 from template TPL-SOP'],
      [-8, 9, 0, 'u-tom', 'create', 'Change request', 'CR-015', 'Created CR-015'],
      [-6, 15, 42, 'u-omar', 'review', 'Document', 'POL-004', 'Closed review with 1 comment'],
      [-6, 15, 45, 'u-sam', 'state', 'Document', 'POL-004', 'Sent v2.0 for approval (sequential: Victoria E., then PJ Walters)'],
      [-6, 8, 55, 'u-lena', 'create', 'Observation', 'OBS-020', 'Raised OBS-020'],
      [-5, 9, 0, 'u-grace', 'state', 'Observation', 'OBS-020', 'Escalated OBS-020 to QE-015'],
      [-5, 18, 2, 'u-vic', 'login', 'Session', 'u-vic', 'Signed in from a new device (Safari, macOS)'],
      [-4, 11, 30, 'u-omar', 'create', 'Quality event', 'QE-016', 'Raised QE-016 (High)'],
      [-3, 9, 2, 'u-tom', 'state', 'Change request', 'CR-015', 'Submitted CR-015 for review'],
      [-3, 9, 3, 'u-tom', 'link', 'Change request', 'CR-015', 'Linked SOP-012'],
      [-3, 10, 0, 'u-omar', 'create', 'CAPA', 'CAPA-008', 'Created CAPA-008 from QE-016'],
      [-2, 10, 12, 'u-grace', 'create', 'Training rule', 'TR-04', 'Created training rule TR-04 (pending approval)'],
      [-2, 11, 15, 'u-sam', 'review', 'Document', 'SOP-020', 'Marked reviewed'],
      [-1, 14, 40, 'u-ruth', 'create', 'Observation', 'OBS-021', 'Raised OBS-021'],
      [-1, 15, 5, 'u-priya', 'review', 'Change request', 'CR-015', 'Marked reviewed'],
      [-1, 16, 0, 'u-hannah', 'role.request', 'User', 'u-grace', 'Requested Approver role for Louise Harvey (needs a second admin)'],
      [-1, 16, 20, 'u-sam', 'checkout', 'Document', 'WI-003', 'Checked out WI-003'],
      [-1, 9, 10, 'u-aud', 'read', 'Document', 'PLN-001', 'Download attempt blocked: PLN-001 is Restricted'],
      [0, 7, 0, 'system', 'automation', 'Document', 'POL-004', 'RULE-07 overdue escalation (day 2)'],
      [0, 8, 2, 'u-vic', 'login', 'Session', 'u-vic', 'Signed in (SSO + MFA)'],
      [0, 8, 30, 'u-omar', 'upload', 'CAPA', 'CAPA-007', 'Uploaded screenshot-console.png (malware scan started)'],
      [0, 9, 12, 'u-ruth', 'create', 'Observation', 'OBS-022', 'Raised OBS-022']
    ];
  };
})(window.Q);
