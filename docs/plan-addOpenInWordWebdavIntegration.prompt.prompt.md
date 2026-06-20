## Plan: Add Open in Word WebDAV Integration

TL;DR - Add a WebDAV integration router and a small API endpoint that builds an ms-word: URI. Frontend gets a new "Open in Word" context-menu item which calls the endpoint and navigates to the returned ms-word URI. Reuse existing WOPI service helpers for path resolution and writes.

**Steps**
1. Discovery: confirm existing WOPI helpers and frontend menu location (done).
2. Create integration package files:
   - `/app/integrations/webdav/__init__.py` — empty module to allow imports.
   - `/app/integrations/webdav/config.py` — export `WEBDAV_BASE_URL` and `WEBDAV_TOKEN_EXPIRE_MINUTES` from env.
   - `/app/integrations/webdav/router.py` — implement WebDAV endpoints mounted at `/webdav/files/{file_id}/{mode}/{filename}` exposing OPTIONS, HEAD, GET, PROPFIND, PUT, LOCK, UNLOCK. Use JWT token from `?token=` and `jwt.decode(..., settings.SECRET_KEY, algorithms=[settings.ALGORITHM])` to authorize. Reuse `app.integrations.wopi.service` helpers: `get_file_record()` (DB lookup if present), `get_target_path()`, and `write_file_bytes()`.
     - Implement PROPFIND and LOCK response XML shapes per spec in the plan.
     - On PUT: call `wopi_service.write_file_bytes()` and if mode == "structuring" call `_regen_xhtml_background()` as background task.
3. Wire backend routers:
   - Modify `app/main.py` to include the new router: `from app.integrations.webdav import router as webdav_router` and `app.include_router(webdav_router.router, prefix="/webdav", tags=["WebDAV"])`.
4. Add API endpoint for ms-word URI:
   - Modify `app/routers/api_v2.py` to add `GET /files/{file_id}/open-in-word?mode=original` (place near existing file editor endpoints after OnlyOffice block).
   - Protect with `get_current_user_from_cookie` dependency.
   - Implementation: lookup `File` record, call `create_access_token({...}, expires_delta=timedelta(minutes=WEBDAV_TOKEN_EXPIRE_MINUTES))`, build WebDAV URL: `{WEBDAV_BASE_URL}/webdav/files/{file_id}/{mode}/{filename}?token={token}`, construct `ms_word_uri = f"ms-word:ofe|u|{webdav_url}"`, and return JSON `{"ms_word_uri": ms_word_uri, "webdav_url": webdav_url}`.
   - Import `WEBDAV_BASE_URL` and `WEBDAV_TOKEN_EXPIRE_MINUTES` from `app.integrations.webdav.config` and `create_access_token` from `app.domains.auth.security` (or existing `create_access_token` import path used in project).
5. Frontend changes (single file):
   - Edit `frontend/src/features/projects/components/FileContextMenu.tsx`:
     - Add `ExternalLink` import from `lucide-react` alongside existing icons.
     - Add `MenuWordItem` component (copy behavior spec from plan) and insert it after the "Edit in OnlyOffice" menu item.
6. Environment example:
   - Append `WEBDAV_BASE_URL` and `WEBDAV_TOKEN_EXPIRE_MINUTES` to `.env.example` (do not remove existing vars).
7. Testing and verification:
   - Unit/contract checks: ensure new imports don't break startup.
   - Manual verification steps (run locally on Windows with Word installed):
     1. `docker-compose up` — confirm app starts and new router imports OK.
     2. Call `GET /api/v2/files/{file_id}/open-in-word` with auth — expect `ms-word:ofe|u|http://...` uri.
     3. UI: right-click file → confirm menu shows "Open in Word" between OnlyOffice and Download.
     4. On Windows: clicking should open MS Word via protocol and Word should download via WebDAV, edits followed by save/close should send PUT to `/webdav/files/{file_id}/{mode}/{filename}`.
     5. Backend should call `wopi_service.write_file_bytes()` and increment file.version and archive previous version.
     6. If mode == structuring, `_regen_xhtml_background()` should be scheduled.
     7. Run `pytest tests/` and address any regressions.

**Relevant files**
- [app/integrations/wopi/service.py](app/integrations/wopi/service.py#L1-L400) — reuse `get_target_path(...)` and `write_file_bytes(...)` here.
- [app/integrations/wopi/router.py](app/integrations/wopi/router.py#L1-L400) — reference for background regen helper `_regen_xhtml_background` and WOPI patterns.
- [app/main.py](app/main.py#L1-L200) — add router include for WebDAV.
- [app/routers/api_v2.py](app/routers/api_v2.py#L1-L300) — add the open-in-word endpoint adjacent to existing editor endpoints.
- [frontend/src/features/projects/components/FileContextMenu.tsx](frontend/src/features/projects/components/FileContextMenu.tsx#L1-L800) — add `MenuWordItem` and import.
- [.env.example](.env.example#L1-L200) — add example env vars.

**Verification**
1. Start services: `docker-compose up` and watch for import/startup errors.
2. API check: `GET /api/v2/files/{file_id}/open-in-word` (authenticated) returns JSON with `ms_word_uri` beginning with `ms-word:ofe|u|http://`.
3. UI check: menu placement and label "Open in Word" and behavior (calls endpoint, navigates to ms-word URI).
4. Roundtrip: On Windows with Word, open file, edit, save/close → confirm backend receives `PUT` and `wopi_service.write_file_bytes()` is invoked, `file.version` increments, and frontend shows edits after reload.
5. Regression: run test suite `pytest tests/`.

**Decisions & Assumptions**
- Desktop Word support is Windows-only; on other OS the browser will show "no handler" — this is acceptable.
- Token-based auth for WebDAV is stateless via JWT query param; tokens expire per `WEBDAV_TOKEN_EXPIRE_MINUTES`.
- Reusing WOPI service functions maintains existing file-targeting and versioning semantics.

**Further Considerations**
1. CORS / firewall: ensure WEBDAV_BASE_URL resolves to server reachable by Windows clients (network/NAT considerations).
2. TLS: If WEBDAV_BASE_URL is HTTPS, adjust server certs to be trusted by clients to avoid Word rejecting downloads.
3. Consider adding optional audit logging for WebDAV PUT/LOCK operations.
