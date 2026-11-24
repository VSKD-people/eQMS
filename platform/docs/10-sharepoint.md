# 10 · SharePoint as the file store

PJ Walters decided on 24 November 2026 that SharePoint is where the files live and that authors keep writing in Word.
VeQMS is the master record: it holds the locked PDF of every version, the approvals, the signatures and the audit
trail. SharePoint holds the working Word files and a published copy of each Effective version.

## Two libraries on one site

| Library | Holds | Who writes |
|---|---|---|
| **Drafts** | One Word file per document, edited version after version | Authors (in Word), and VeQMS when it creates a new document's file |
| **Controlled** | The locked PDF of every Effective version, with columns: document number, version, status, effective date, SHA-256 | VeQMS only. Everyone else reads |

Superseded files stay in the controlled library, marked Superseded; nothing is deleted.

## How a document moves

1. **New document:** VeQMS creates the Word file in the Drafts library from the template's headings, with a footer
   showing the document number, version and "Page X of Y" (Word fields). A change request opens with it.
2. **Writing:** the author edits the Word file. "Open in Word" on the document page goes to it. VeQMS keeps only
   the change summary.
3. **Submit:** VeQMS asks SharePoint to convert the Word file to PDF, adds the signature page (one Adobe Sign field
   per signer), hashes it and locks it. It records the Word file's change tag (`cTag`) before and after the conversion
   and refuses if they differ. The author checks the PDF (footer, version, document ID, dates) and submits. If the
   Word file has changed since the PDF was made, submit is refused and the PDF has to be made again.
4. **Review, approval, signing:** on the locked PDF, as in [06 · Adobe Sign](06-adobe-sign.md).
5. **Effective:** the version is marked "waiting to publish". The API's publisher (every minute, and straight after
   a signature completes) and the SharePoint job (every 15 minutes) upload the locked PDF to the controlled library,
   set its columns, and mark the previous version's file Superseded. A failure is retried; after 5 attempts the
   version goes to `dead_letters`, QA gets an integrity alert, and a Quality Manager can publish it again from
   Administration. The version is Effective in VeQMS whether or not the copy has reached SharePoint.

## Watching the libraries

- **Delta sync** (`veqms-sharepoint` job, every 15 minutes, Bicep parameter `sharePointSyncCron`; also "Sync now" in
  Administration → SharePoint). Each run is a row in `sync_runs` with the token to resume from; a failed run leaves
  the last good token in place, so the next run starts there.
  - **Controlled library:** any change not made by the VeQMS app (`lastModifiedBy.application.id` ≠
    `SHAREPOINT_APP_ID`), and any deletion of a published file, raises an **integrity alert**: a row in
    `integrity_alerts`, an audit entry and a notification to every Quality Manager. It never becomes a version.
  - **Drafts library:** a document's "last edited" moves on. If the Word file changed after its PDF was made (and the
    document is still a draft), the PDF is cleared so the author makes it again. A deleted Word file raises an alert.
- **Nightly hash check** (the daily job): every published Effective file is downloaded and its SHA-256 compared with
  the version's hash (the locked PDF's). A mismatch or a missing file raises an alert.
- A Quality Manager resolves each alert with a note saying what was found and done. Alerts can't be edited or deleted,
  and a resolved alert is final (database rules, tested in the invariants).

## Settings

| Setting | Meaning |
|---|---|
| `SHAREPOINT_MODE` | `live` (Microsoft Graph) or `mock` (a folder under `LOCAL_STORAGE_DIR`; development and UAT only). Production must be `live` |
| `SHAREPOINT_SITE_ID` | The site's Graph ID (`contoso.sharepoint.com,<guid>,<guid>`) |
| `SHAREPOINT_DRAFTS_DRIVE_ID`, `SHAREPOINT_CONTROLLED_DRIVE_ID` | The two libraries' drive IDs |
| `SHAREPOINT_APP_ID` | The ID Graph reports for VeQMS's own changes. In Azure, the API's managed identity client ID (set by the Bicep) |
| `SHAREPOINT_COLUMNS` | The controlled library's column internal names, as JSON: `number`, `version`, `status`, `effective`, `sha256`. The defaults are placeholders until the library exists |
| `SHAREPOINT_IMPORT_MAP` | Today's library columns for the one-off import, as JSON: `number`, `title`, `type`, `version`, `owner` (email), `classification`, `process`, `effective`. **The real column names are needed** |

One SharePoint site per deployment, like the Entra tenant. A deployment serving several VeQMS tenants would move
these IDs into `settings`.

## Setting it up

1. Create the site and the two libraries. In the controlled library, add the five columns, give everyone read and
   nobody else write, and keep versioning on.
2. Give the API's managed identity the Microsoft Graph **application** permission `Sites.Selected` (admin consent),
   then grant it `write` on this one site: `POST /sites/{site-id}/permissions` with the role `write` and the
   identity's application ID. That call needs a higher-privileged app or admin (a search result says
   `Sites.FullControl.All`; **verify**). `Sites.Selected` then covers both libraries and nothing else.
3. Find the site and drive IDs (`GET /sites/{hostname}:/{site-path}`, then `GET /sites/{site-id}/drives`), and set the
   Bicep parameters `sharepointMode`, `sharepointSiteId`, `sharepointDraftsDriveId`, `sharepointControlledDriveId`
   and `sharepointColumns`.
4. Deploy, then in Administration → SharePoint press **Sync now**: the first run of each library only records a
   starting point.

## Importing today's library

`apps/api/src/jobs/import-sharepoint.ts` reads every PDF in the controlled library and its columns, maps them with
`SHAREPOINT_IMPORT_MAP`, and imports each document as one Effective version (`migrated_from = 'SharePoint'`) pointing
at the existing file. Without `--apply` it only prints a report: how many files, how many map cleanly, and every file
it can't map with the reason (bad number or version, unknown type or owner, duplicate, already in VeQMS). See
[08 · Migration](08-migration.md).

## Verify before go-live

None of the live Graph calls has run against SharePoint. Each is marked `verify` in
`apps/api/src/integrations/sharepoint.ts`. Microsoft's documentation site couldn't be reached from the build
environment; a web search confirmed the main endpoints but not the details below.

- [ ] Conversion: `GET /drives/{id}/items/{id}/content?format=pdf` converts .docx with app-only permissions, and the
      size limit. One search result says files over **2 MB** can't be converted; if so, large documents need another
      route (for example the author saves as PDF from Word and uploads it).
- [ ] The redirect to the converted or downloaded file is followed without the bearer token.
- [ ] Simple upload `PUT /drives/{id}/root:/{name}:/content?@microsoft.graph.conflictBehavior=fail` (limit 250 MB per
      current docs; older answers say 4 MB). Upload sessions aren't built.
- [ ] Columns: `GET /drives/{id}/list`, `GET /drives/{id}/items/{id}/listItem`, then
      `PATCH /sites/{site}/lists/{list}/items/{item}/fields` with internal names.
- [ ] Delta: `token=latest` for a starting point, `@odata.nextLink` paging, `@odata.deltaLink` as the next token,
      deleted items carry `deleted`, and **column changes appear in delta** (they must, or an outside edit of the
      columns alone would go unseen).
- [ ] `lastModifiedBy.application.id` equals the managed identity's client ID for VeQMS's own writes.
- [ ] Throttling: 429 and 503 with `Retry-After` in seconds.
- [ ] The Word file VeQMS creates opens in Word Online (it was checked in LibreOffice only).

Pages a web search pointed to (Microsoft Learn; found by search, not read in full from here):
[convert to other formats](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format?view=graph-rest-1.0),
[upload small files](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0),
[update listItem](https://learn.microsoft.com/en-us/graph/api/listitem-update?view=graph-rest-1.0),
[driveItem delta](https://learn.microsoft.com/en-us/graph/api/driveitem-delta?view=graph-rest-1.0),
[create site permission](https://learn.microsoft.com/en-us/graph/api/site-post-permissions?view=graph-rest-1.0),
[selected permissions overview](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).
