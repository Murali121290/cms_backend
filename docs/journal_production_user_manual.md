# Journal Production: User Manual

This manual covers how to start the Journal Production module (for whoever runs the servers) and how to take an article from upload to proof (for production staff).

> **Current limits.** Read these before you start:
> - **"Mark fixed" is your sign-off.** It doesn't change the text. Only **Apply fix** and your own edits change the manuscript, and only after you **Save**.
> - **Stage 7 (Final Delivery) can't build or send the delivery package yet.** Proceed simply completes the article.
> - **InDesign generation (Stage 4) needs the InDesign server's journal endpoint** and a journal template (section 2.4).

---

## Part 1: Starting the system (administrators)

The journal module is part of the CMS. It runs in the same Docker stack: `cms_backend`, `cms_db`, `cms_redis` and `cms_nginx`.

### 1.1 After pulling new code

Run these from the repository folder (`D:\cms_backend`).

1. **Apply database changes:**
   ```bash
   docker exec cms_backend alembic upgrade head
   ```
   You should end on `0034_add_journal_workflows (head)`. Check with:
   ```bash
   docker exec cms_backend alembic current
   ```

2. **Restart the backend** so it loads the new code:
   ```bash
   docker restart cms_backend
   ```
   The container mounts `app/` from the repository, so no image rebuild is needed.

3. **Build the frontend.** Nginx serves the built files from `frontend/dist`:
   ```bash
   cd frontend
   npm install
   npm run build
   ```

4. **Open the app** at `http://localhost:8080` and sign in. The port is the one `cms_nginx` publishes; it's 8080 on this machine. **Journal Production** is in the left sidebar.

**Check it worked:** the Journal Production page opens with no error. If it shows "Could not load journal clients", the backend is still running old code. Repeat step 2.

### 1.2 Running for development

Instead of steps 3–4, you can run the frontend with live reload:

```bash
cd frontend
npm run dev      # http://localhost:5173
```

The dev server sends `/api` calls to `VITE_DEV_PROXY_TARGET` (default `http://127.0.0.1:8000`). The Docker backend doesn't publish port 8000 on this machine, and `peoplehub_backend` already uses that port. So either:
- run the backend locally (`python -m uvicorn app.main:app --reload --port 8000`), or
- set `VITE_DEV_PROXY_TARGET=http://localhost:8080` in `frontend/.env` to go through nginx.

### 1.3 Optional server settings (`.env`)

| Setting | What it does | Default |
|---|---|---|
| `JATS_XSLT_URL` | Windows XSLT server for Stage 3 (XML Conversion). When it's empty, or the server fails, the built-in converter is used. | empty |
| `JATS_XSLT_NAME` | XSLT file name sent to that server | `docx_to_jats.xslt` |
| `INDESIGN_SERVER_URL` | InDesign server, shared with the book workflow | `http://10.1.6.108:5555` |
| `JOURNAL_INDESIGN_ENDPOINT` | Journal endpoint on the InDesign server | `/convert-jats-to-indesign` |

Restart `cms_backend` after changing `.env`.

> The XSLT and InDesign request formats are still assumptions that need confirming with the Windows team. See `jats/servers.py`.

### 1.4 Running the tests

```bash
python -m pytest tests/test_journals_api.py tests/test_journal_stage1_checks.py tests/test_journal_stage4_7.py tests/test_journal_workflows.py -q
```

All 33 tests should pass. They fake the Crossref, XSLT and InDesign servers, so they need no network.

---

## Part 2: Setting up a publisher and journal

### 2.1 Add a client (publisher)

1. Open **Journal Production** from the sidebar.
2. Click **New client**.
3. Enter the **Client code** (for example `ELSA-01`), the **Publisher name**, and the **JATS version**, then click **Create client**.

The client appears as a card showing its number of journals, active articles and delayed articles.

### 2.2 Add a journal

1. Click the client's card.
2. Click **New journal**.
3. Fill in:
   - **Journal code** and **Journal title** (required)
   - **ISSN (print)** and/or **ISSN (online)**, in the form `1234-567X`. At least one is required, because JATS XML needs an ISSN.
   - **Journal manager**, **Volume** and **Issue** (optional)
4. Choose the **Workflow**. The stage chips show which stages are included; skipped stages are crossed out.

   | Workflow | Stages | Use for |
   |---|---|---|
   | Full production (default) | 1–8 | Normal articles |
   | XML only (no typesetting) | 1, 2, 3, 4, 8 | The publisher typesets |
   | Fast track (no language edit) | 1, 2, 4, 5, 6, 7, 8 | Manuscripts that arrive already copy-edited |
5. Click **Create journal**. The journal's article page opens.

The workflow can't be changed after articles have been uploaded, because each article's stages are fixed when it's created.

### 2.3 Journal settings: design pack, style sheet, grammar sheet

Open the journal and click **Settings**. You can also use the gear icon on the client's journal list, or a warning chip on the journal page such as "No InDesign template". There are three tabs:

- **Design pack:**
  - Upload the **InDesign template**, **fonts**, **library**, **logo** and **preview CSS**.
  - Every upload is a new version (v1, v2…).
  - The first template becomes active. Later ones wait until you click **Make active**, so a new template can't change articles by accident.
  - For fonts, the newest version of each font is active.
  - Generate InDesign (Stage 4) sends the active template, fonts and library to InDesign.
- **Style sheet:**
  - the structuring tag set, the abstract word limit, and the Word character style → JATS mapping
  - citation form (`[1]`, `(1)` or detect), reference style, and Crossref DOI checks
  - art rules: accepted formats, minimum ppi, placed width, and the file-naming pattern (e.g. `fig{n}.tif`)
  - The JSON panel shows exactly what's saved. **Save as vN** creates a new version and makes it active.
- **Grammar sheet:**
  - US/UK English, the rule switches, and a preferred-terms list. Import terms from a `.csv` with `find,replace,note` columns.
  - Saved and versioned the same way. The Language Editing check (Stage 2) reads it.

Each tab lists its versions. **Make active** switches back to an older one; nothing is deleted.

### 2.4 Before using Generate InDesign (Stage 4)

- `INDESIGN_SERVER_URL` must be reachable, and the server must provide the journal endpoint (section 1.3).
- The journal needs an active InDesign template: **Settings → Design pack**.
- The article's figures need art files: see section 3.5 below.

### 2.5 Where files are stored, and versions

Everything is under `D:\cms_backend\data\cms_runtime_data\uploads\journals\`, which is `/opt/cms_runtime/data/uploads/journals/` inside the container. This folder is mounted from the host, so it survives rebuilding the container.

```
journals\<CLIENT>\<JOURNAL>\
  design\template\v1\ v2\ …           InDesign templates, one folder per version
  design\font\<font>_v1\ …            fonts, per font and version
  incoming\<batch>\                   files as they were uploaded
  articles\article_<id>\
    original\                         manuscript as uploaded (never changed)
    edited\<name>_structured.docx     working copy: structured, then edited in the editor
    xhtml\ xml\ indesign\ proof\      stage outputs, one file per version: <name>_v3.xhtml
    art\fig2_v1.tif, fig2_v2.tif      art, one file per version of each figure
```

- **Files are never overwritten.** A new upload or new output is saved as the next version (`_v2`, `_v3`…), and the database records the version number.
- **Current version:** the highest-numbered file (for design files, the one marked active) is the current one. Older versions stay available to download or re-activate.
- **Articles uploaded before this change** keep their files where they were; only new files go to the new folder.

---

## Part 3: Working on articles

### 3.1 Upload articles

1. Open the journal.
2. Click **Upload articles**.
3. Drop or choose files:
   - **.docx**: one manuscript, which becomes one article.
   - **.zip**: one article package (manuscript plus figures and supplementary files), which becomes one article. The manuscript is the .docx whose name contains "manuscript" or "main", or else the first .docx found.
4. Click **Upload**.

The result lists each file under **Added** or **Not added**, with the reason. Common reasons:
- another article already has this DOI
- the ZIP contains no .docx
- the file isn't a .docx or .zip

The title, DOI, authors, abstract and keywords are read from the manuscript. New articles start at the first stage of the journal's workflow.

### 3.2 The article list

The journal page works like a book's chapter list:
- **Summary tiles:** Articles, In progress, Completed, Delayed.
- **Stage rail:** each stage in the workflow, with the number of articles at it. Click a stage to show only those articles, and click it again to clear the filter.
- **Search:** by title, DOI or author.
- **Table columns:**
  - current stage, with an **open errors** count underneath when there are any
  - a progress bar with one segment per workflow stage: blue is done, amber is current, grey is to do
  - assignee, due date and status
- **Delayed** articles have a red tint. An article is delayed when it's past its due date and not completed.

Each row has two actions:
- **Open**: opens the article workspace (section 3.3).
- **Proceed**: completes the current stage and moves the article to the next stage in its workflow. If the move is refused, the dialog says why and lists any blocking errors.

### 3.3 The article workspace

Top bar:
- the article title and DOI, and a back link to the journal
- a stage-specific action: **Process references** / **Reference status** during Pre-Editing (once the References step is open), **Convert to JATS XML** at Stage 3, **Generate InDesign** and **Check InDesign status** at Stage 4, and **Download proof PDF** from Stage 5 on
- **Complete \<stage\>**, which does the same as Proceed. For Pre-Editing it stays disabled until all four steps are finished.

The workflow has 7 stages: **1 Pre-Editing**, 2 Language Editing, 3 XML Conversion, 4 Generate InDesign, 5 InDesign Final QC, 6 View Proof, 7 Final Delivery. Technical editing is no longer a separate stage; it is the last Pre-Editing step.

Below the top bar is the article's workflow, with done, current and upcoming stages. The workspace is laid out like the book review pages.

**Left: Pre-Editing steps and the findings checklist.** During Pre-Editing the four steps are listed at the top (section 3.4). Below them is every open finding from every check, with a search box, check filters (ALL, Structuring, References…), and All / Errors / Warnings / Hints tabs. Each card shows the check, rule code, paragraph number, title, and the text around the problem with the problem highlighted. Click a card to jump to it in the editor. The buttons are:
- **Apply fix**: makes the suggested change in the text, as a tracked change when TC is on.
- **Retag in Styles**: jumps to the paragraph and opens the Styles panel.
- **Mark fixed**: records that you dealt with it yourself.
- **Sign off**: for QC and proof items.
- **Go to**: jumps to the paragraph.
- **Ignore**: warnings and hints only. Errors can't be ignored.

**Centre: the editor.** It's the same WYSIWYG editor as the book pages:
- **Formatting:** fonts, bold/italic, super/subscript, lists, tables, links, equations.
- **Editing tools:** find and replace, and track changes (**TC ON/OFF**, accept/reject).
- **Style tags:** each paragraph's tag is shown beside it (ATL, AU, ABS, H1, TXT, REF-N…).
- **Highlighting:** findings are highlighted in the text, and clicking a highlight selects its card.
- **Save edits to DOCX:** writes your edits into the article's working copy of the manuscript, keeping paragraph styles and tracked changes, and re-runs the checks of the Pre-Editing steps that have run. The findings list then updates. The original upload is never changed.

**Right panel**, with two tabs:
- **Checks:** error, warning and hint counts, each check's status, and the journal's style and grammar sheets.
- **Styles:** the PARA and CHAR style panels, the same as the book structuring review. Put the cursor in a paragraph and choose a style to retag it, then save.

### 3.4 Stage by stage

**Stage 1: Pre-Editing (four steps, finished one by one)**

Pre-Editing is done as four steps in a fixed order. A step unlocks only when the step before it is **finished**:

| Step | What it does | Check |
|---|---|---|
| 1. Structuring | Auto-structures the manuscript into the working copy and converts it to XHTML | Structuring |
| 2. Reference validation | Adds `bib_*` styles to the reference list and `cite_bib` to in-text citations (text unchanged, hyperlinks removed), then validates | Reference validation |
| 3. IA rules | Runs the IA rules selected in Journal settings → IA rules (the same rules as the book Technical page) | IA rules |
| 4. Technical checks | Figure/table callouts, equation numbering, keywords | Technical checks |

**Structuring starts by itself.** It runs in the background as soon as an article is uploaded, and again when the editor opens an article it never ran on. While it runs, the editor shows "Structuring the manuscript…". The other steps start only when you finish the one before.

For each step:
1. Work through its findings in the editor (the findings list shows the selected step's check): retag paragraphs, apply fixes or edit the text, then **Save edits to DOCX**. Saving re-runs the checks of every step that has run.
2. When the step has **no open errors**, click **Finish & run next**. Open warnings must be marked fixed or ignored first, or accepted all at once with **Accept N warnings & finish** (recorded as a sign-off).
3. The next step runs straight away.

- **Reopen / auto-reopen:** **Reopen** puts a finished step back in progress. A save that gives a finished step new errors reopens it by itself. Either way, the steps after it lock until it is finished again; they keep their finished state and come back once it is.
- **Completing the stage:** **Complete Pre-Editing** is enabled when all four steps are ✓.
- **Re-running:** **Re-run** in a step re-runs it on the working copy and keeps your saved edits. To start again from the uploaded manuscript and throw away your edits, an administrator can call `POST /api/v2/journals/articles/<ID>/pre-editing/structuring/run?restructure=true`.

What the checks look for:
- **Structuring:**
  - numbered headings typed as normal text
  - skipped heading levels
  - unmapped Word character styles
  - captions not styled as captions
  - untagged paragraphs
  - abstract length
- **Reference validation:**
  - citations with no matching reference
  - references with no year
  - uncited references
  - citation order
  - malformed DOIs
  - DOIs that don't match Crossref, with the corrected DOI suggested

  Both numbered forms, `[1]` and `(1)`, are recognised; the style sheet's Citation form can fix one. Only REF-N / REF-U paragraphs between `<ref-open>` and `<ref-close>` (or under the References heading) count as references.
- **IA rules:** only the rules selected for the journal. With none selected, the step shows one error that links to Journal settings → IA rules. Mark it fixed if the journal uses no IA rules.
- **Technical checks:**
  - figure callout wording ("Fig. 1" vs "Figure 1")
  - figures or tables never mentioned in the text
  - keyword count
  - **equation numbering** (an error)
  - units, "percent" and number ranges, only when the IA selection doesn't already cover them

**Reference processing (optional).** **Process references** / **Reference status** run the full reference engine and keep a **Reference report**. By default this runs locally; to use the PPH server, set `references.engine` to `pph` in the style sheet. The XML conversion turns the `bib_*` references into structured JATS `<element-citation>` markup.

**Stage 2: Language Editing.** When an article enters Language Editing, the **Language editing** check runs automatically, using the grammar sheet:
- the US or UK profile rules
- the preferred terms
- the switches: serial comma, "data" as plural, concise phrasing, spelling out one to nine

Language findings are warnings or hints; they never block the stage.

After Pre-Editing, saving in the editor re-runs every check up to the current stage.

**Book review pages.** In the article workspace, **Book review: Structuring / Technical / Language** opens the book team's own review pages on this article's working copy.
- **Their Save changes the journal working copy.** When you come back, the workspace shows "changed in a book review page": click **Refresh**.
- **The Technical page uses the journal's IA rules** (Journal settings → IA rules), the same selection the IA rules step uses.
- **Behind the scenes**, each journal has a hidden book project (`JRNL-<code>`) that doesn't appear in book lists.

**Stage 3: XML Conversion**
1. Click **Convert to JATS XML**. This uses the XSLT server when one is configured, and the built-in converter otherwise.
2. The **XML & DTD validation** check runs automatically against the JATS 1.3 DTD. An error caused by an earlier problem names it. For example, `Reference to missing ID "bib12"` comes from the Pre-Editing reference issue "Citation [12] has no matching reference".
3. When there are no errors, click **Complete XML Conversion**.

**Stage 4: Generate InDesign**
1. Click **Generate InDesign**. The job runs in the background and can take several minutes.
2. Click **Check InDesign status**. When it shows "InDesign generated: …", the layout and proof PDF are saved and the InDesign Final QC and proof sign-offs have been created. If it shows "InDesign generation failed: …", fix the cause and generate again.
3. Click **Complete Generate InDesign**.

**Stage 5: InDesign Final QC**
- The **InDesign final QC** check lists 8 items to sign off, plus anything the server's preflight found (overset text, missing fonts, low-resolution images):
  - overset text
  - fonts
  - image resolution
  - running heads and folios
  - figure and table placement
  - clean breaks
  - equations
  - references
- Check each one in the layout and click **Sign off**. When every item is signed off, click **Complete**.

**Stage 6: View Proof**
1. Click **Download proof PDF** and review it with the author and editor.
2. When it's approved, **Sign off** the "Proof awaiting approval" item under **Proof approval**, then click **Complete**.

**Stage 7: Final Delivery.** The delivery package isn't built yet. **Complete** marks the article Completed.

### 3.5 Article art files

Open the **Files** tab in the article workspace's right panel, or click **Files** on the article's row in the journal list.

- **Figure cards:** one per figure cited in the article, shown as **Ready**, **Needs attention**, **Blocking** or **No file**. Figure numbers come from the JATS XML, or from "Figure N" captions before conversion.
- **Uploading:** drop or choose files. A file named like `fig2.tif` or `Figure 2 final.png` is linked to Figure 2 automatically. If Figure 2 already has a file, the upload becomes its next version.
- **Each file shows** its format, pixel size and resolution at the template's column width, then the style sheet's checks: format accepted, minimum ppi, and naming.
- **Linked to:** change which figure a file belongs to.
- **Rename:** saves a copy named to the journal's pattern (e.g. `fig2.tif`) as a new version. The original file is kept.
- **Download:** saves the current version.
- The JATS XML and the InDesign package use the file linked to each figure.

### 3.6 When "Proceed" is refused

| Message | What to do |
|---|---|
| "Run pre-editing to convert the manuscript to XHTML…" | Open the article; Structuring runs by itself (or click **Run structuring**) |
| "Pre-Editing step N (…) is not finished" | Open the article and finish that step (section 3.4) |
| "Convert the article to JATS XML…" | Click **Convert to JATS XML** (Stage 3) |
| "Generate the InDesign layout…" | Click **Generate InDesign**, then **Check InDesign status** until it succeeds |
| "Generate a proof PDF…" | Generate InDesign again; the proof comes from the same job |
| "N open error(s) must be fixed before leaving …" | Open the article; the errors are listed under the checks. Fix or accept each error. |

---

## Part 4: Troubleshooting

| Problem | Cause and fix |
|---|---|
| Journal pages show "Could not load…" | The backend is running old code, or the migration hasn't run. Run section 1.1 steps 1 and 2. |
| New pages don't appear | The frontend wasn't rebuilt. Run `npm run build` in `frontend/`. |
| "No manuscript DOCX is attached to this article" | The upload had no .docx. Upload the manuscript again as a .docx or a .zip containing one. |
| Reference check shows "Crossref lookup failed for N reference(s)" | Crossref couldn't be reached. Try again later; the other reference checks still ran. |
| "The journal style sheet has no InDesign template" | Set `indesign_template` in the journal's style sheet (section 2.3). |
| "InDesign generation failed: INDESIGN_SERVER_URL is not configured" | Set it in `.env` and restart `cms_backend`. |
| `<journal-meta> has content in the wrong order or missing required parts` | The journal has no ISSN. It can only be set when the journal is created, so ask an administrator to add it. |

**Where files are kept:** see section 2.5, under `D:\cms_backend\data\cms_runtime_data\uploads\journals\`. That folder is on the host, so rebuilding the container is safe. Articles uploaded before 29 Sep 2026 still have files under `/app/uploads/journals/` inside the container, which isn't mounted. Re-upload them if you need to rebuild the container.
