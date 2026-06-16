# Reverse engineering — full transparency

This document explains exactly which Infomaniak endpoints this project uses, how each one was discovered, and what guarantees (or lack thereof) you can expect about its stability.

The intent is honesty: we know that maintaining undocumented endpoints is risky, and we want users and auditors to assess that risk with all the facts.

## Position

We use:

1. **Documented public endpoints** of `api.infomaniak.com`, with a Bearer token the user generates in their own Infomaniak account. Authentication is performed against the user's own session/token; no impersonation or credential sharing happens.

2. **Undocumented public endpoints** of `api.infomaniak.com`. These are routes the Bearer token can reach (returning real data) but which are not listed at [developer.infomaniak.com](https://developer.infomaniak.com/docs/api). Several were discovered by enumerating common Laravel-style sub-routes (`?with=…`, `/users`, `/aliases`, etc.) and observing which return `200 success` with structured data.

3. **Manager-private endpoints** of `manager.infomaniak.com/proxy/...`. These are the routes the Angular [manager web app](https://manager.infomaniak.com/) calls itself. They accept the user's own Chrome session cookie (`SASESSION`) plus a CSRF token. We never read another user's cookies, never bypass any authentication mechanism — we read the cookies of the same browser the user is already logged into, on the same machine.

We do not:

- Modify any binary, certificate, or protection mechanism.
- Bypass any access control on the Infomaniak servers.
- Distribute or rehost any Infomaniak proprietary code.
- Use scraping techniques against humans (e.g. screen-scraping the rendered DOM).

If Infomaniak releases an official, documented API for the operations currently covered by manager-private endpoints, this MCP will switch to it transparently.

## Discovery techniques used

### A. Enumeration of `?with=…` parameters

Many Infomaniak endpoints accept a `with` query string to expand fields. The set of valid values is endpoint-specific and not always documented. We discovered them by sending an obviously-invalid `with=invalid_key_to_get_list`: Laravel's validator returns `validation_rule_in` with the full list of allowed values inside `error.errors[].context.values`.

Example for `GET /1/web_hostings/{id}/sites/{site_id}`:
```
?with=invalid → 422
{"context": {"values": ["ips", "applications", "application_types", "environments",
                        "advanced_params", "urls", "ssl_infos"]}}
```

This is a feature of Laravel's response, not a vulnerability. We use it to learn which fields are exposed.

### B. Reading `developer.infomaniak.com` Inertia.js navigation

The dev portal is a Vue + Inertia SPA. Hitting `/docs/api` with `X-Inertia: true` returns the full navigation as JSON (1544 endpoints across 15 categories). We use that JSON as our authoritative list of *documented* endpoints.

### C. Reading the open-source Infomaniak mobile apps

Infomaniak publishes its Android and iOS app source on GitHub:

- [`Infomaniak/android-kDrive`](https://github.com/Infomaniak/android-kDrive)
- [`Infomaniak/ios-kDrive`](https://github.com/Infomaniak/ios-kDrive)
- [`Infomaniak/android-kMail`](https://github.com/Infomaniak/android-kMail)
- [`Infomaniak/ios-kMail`](https://github.com/Infomaniak/ios-kMail)
- [`Infomaniak/android-core`](https://github.com/Infomaniak/android-core), [`Infomaniak/ios-core`](https://github.com/Infomaniak/ios-core)

The `ApiRoutes.kt` / `Endpoint.swift` files in these repos exhaustively list the URL templates the apps call. They are an excellent source of information about the real shape of the API.

### D. Inspecting the manager Angular bundle

`manager.infomaniak.com/v3/hosting/main-XXXXXX.js` is a public JavaScript bundle. It lazy-loads chunks under names like `chunk-Dofr6lSR.js`. By recursively following the chunk imports we identified the file responsible for site creation:

```js
// chunk-Dofr6lSR.js
createSite(h) {
  const { subdomain, domain, domainChoice, set_location_manually } = h;
  const Y = omit(h, ['subdomain', 'domain', 'domainChoice', 'set_location_manually']);
  return post(`${webHostingApiUrlWithHostingId}/sites`, { ...Y, force_fqdn: true });
}
```

This revealed three previously unknown facts (see `POST /sites silent success` below).

### E. Live request mirroring

When the discovery process was inconclusive, we asked the user to perform an action manually in the manager with Chrome DevTools open, then we reproduced the relevant XHR call from our code with the same headers and payload. This is the same technique a developer would use to debug their own integration with their own service.

## Notable findings

### `POST /sites` silent success

The single most important finding of this project.

`POST /1/web_hostings/{id}/sites` with `{fqdn, directory}` returns `200 success` with a `progress_id`, but the site is never created. After investigating, we found:

1. The public Bearer token does not have authorization to create web sites — but the API does **not** return `401`. It accepts the request, generates a real progress_id, and discards the work.
2. The manager-private endpoint (same path, on `manager.infomaniak.com/proxy/...`) does the real creation but requires SASESSION + CSRF.
3. The manager wizard sends three additional fields not documented anywhere: `force_fqdn: true`, `directory` prefixed with `/sites/`, and `environment` (`apache_php` or `nodejs`).

Without **all four** fields the manager-private endpoint also returns `200 success` silently without creating the site. This is documented in `src/types/infomaniak.ts → CreateSitePayloadSchema` so the user cannot accidentally trigger the silent no-op.

### The 30-scope OAuth wall

We tried OAuth as a more durable alternative to manager cookies. The discovery flow led us to the full list of OAuth scopes the manager itself uses:

```
crypt_key user_info user_password private recovery user_info_contact
user_email accounts users profile_update nas mail event video vod web
housing vps affiliation jelastic swiss-backup shop_public certificates
cloud-hd drive infomaniak website_builder public_cloud radio kchat
```

However, requesting any of these scopes from a third-party OAuth client returns `invalid_scope`. The official OIDC discovery document confirms this:

```
GET https://login.infomaniak.com/.well-known/openid-configuration
{
  "scopes_supported": ["openid", "profile", "email", "phone"]
}
```

So OAuth is unusable for write operations against the manager's own product domains. This is why the MCP falls back on the SASESSION/CSRF path that the manager web app itself uses.

### `connection_type` enum on `POST /1/web_hostings/{id}/users`

The Infomaniak public API documents this endpoint at a high level but does not list the accepted values for `connection_type`. The manager UI shows three labels (`PHP application`, `FTP only`, `Node.js application`) which we initially mapped to `apache_php / ftp / sftp / nodejs` in v0.7.0 — that was wrong.

Discovery (2026-05-08, h3 hosting on a live account):

```
POST /1/web_hostings/999999/users  body={"connection_type":"sftp", ...}
→ 422 validation_failed
   "code": "validation_rule_in",
   "context": { "attribute": "connection_type", "values": ["ftp", "ssh"] }
```

So the **API actually accepts only two values**:

| Value | Meaning | What the user can do |
|---|---|---|
| `ftp` | SFTP-only | upload / download files; **no shell** |
| `ssh` | full shell | SSH login + SFTP + can run commands |

The labels `PHP application` / `Node.js application` we saw in the UI describe the *site* environment (`apache_php` vs `nodejs`), not the user's access mode. The two concepts were conflated in our schema.

Fixed in v0.7.1.

### Database users — endpoint inventory and the recommended rotation path

The Infomaniak public API exposes the MariaDB-level user accounts attached to a web hosting under:

```
GET    /1/web_hostings/{hosting_id}/database_users          ← list, verified live
GET    /1/web_hostings/{hosting_id}/database_users/{user}   ← single user, verified live
POST   /1/web_hostings/{hosting_id}/database_users          ← creates a user
PATCH  /1/web_hostings/{hosting_id}/database_users/{user}   ← updates the user's password
DELETE /1/web_hostings/{hosting_id}/database_users/{user}   ← removes the user
```

Equivalent paths on the manager-private bundle (discovered while reading the Angular SPA on 2026-05-11) live under `manager.infomaniak.com/v3/api/proxypass_2/1/web_hostings/{hosting_id}/database_users/...` — same shape, different base URL.

The `GET` returns a clean shape:

```json
{
  "data": {
    "name": "myprefix_WP1234567",
    "applications": [{ "id": "1401330", "type": "wordpress", "name": "..." }],
    "permissions": [
      { "database": "myprefix_WP1234567", "rights": { "read": true, "write": true, "admin": true } }
    ],
    "protected": true,
    "protected_information": "My WordPress Site",
    "link": "https://h2-phpmyadmin.infomaniak.com/?pma_servername=..."
  }
}
```

#### Recommended path for WordPress DB password rotation

The MariaDB user that owns a WordPress database holds `admin` rights on that database, which means it can change its own password through a standard SQL statement without needing any platform API call. This is the path we recommend (verified in production over 58 sites on 2026-05-11):

1. SSH into the hosting (`infomaniak_create_hosting_user` with `connection_type: "ssh"` creates a temporary admin user if needed),
2. From the host, run:
   ```sql
   SET PASSWORD = PASSWORD('<new_password>');
   ```
   while authenticated as the WP user itself (`mysql -h <db_host> -u <db_user> -p<old> -e "..."`). Since the user only changes its own password, no `CREATE USER` privilege is required.
3. Update the site's `wp-config.php` with the new password (atomically, with backup),
4. Optionally `infomaniak_delete_hosting_user` to clean up if a temporary user was created.

#### Tools we ship

This MCP exposes:
- `infomaniak_list_database_users` (read-only) — inventory all DB users on a hosting.
- `infomaniak_get_database_user` (read-only) — full detail of a single user.

We intentionally do not ship a typed `reset_database_password` tool. The `PATCH` endpoint can change a password, but in its current behaviour the same call also resets the user's `applications` and `permissions` arrays to empty — which removes the database-level grants from the underlying MariaDB and renders the WordPress site unable to read its own database. Until that side effect is either fixed upstream or routed through a different endpoint, the SQL-based rotation described above is the only path we trust for production sites. The MCP keeps the door closed deliberately rather than expose a tool that can silently bring a live site down.

**Documented in CHANGELOG v0.7.2.**

### SSL certificates — public API endpoint family

Discovered on 2026-05-12 by enumerating `POST` body shapes against `/1/web_hostings/{hid}/...`. The public Bearer API exposes three certificate endpoints, all on the hosting-level resource (not on the per-site sub-resource — `/sites/{sid}/certificates` returns `method_not_found`):

```
GET    /1/web_hostings/{hid}/certificates/{site_id}
POST   /1/web_hostings/{hid}/certificates       body: {site_id, type, ...}
DELETE /1/web_hostings/{hid}/certificates/{site_id}
```

The `type` field on `POST` is constrained to `free` / `paid` / `custom` (confirmed via `validation_rule_in`). Per-type required fields, also discovered via 422:

| `type` | Required fields | Notes |
|---|---|---|
| `free`   | — | Let's Encrypt. Infomaniak runs the ACME flow. |
| `paid`   | `certificate_id` | id of a Sectigo (or similar) certificate previously purchased. |
| `custom` | a PEM payload (the validation message reads *"A certificate is required. Provide either a certificate file or a PEM certificate"*) | We pass `certificate` + `private_key` + optional `intermediate_certificate`. |

The `GET` response is in fact much richer than it first looks — `status` and the ACME identifier arrays sit alongside `type`, `sub_type`, `issuer`, `organization`, `main_fqdn`, `emitted_at`, `expired_at`, `fingerprint_sha256`, `is_valid`, `is_expired`, `is_selfsigned`. The same information also surfaces on the *site* object (`ssl_status`, `ssl_issuer`, `ssl_emitted_at`, `ssl_expired_at`) for cheap listing without hitting this endpoint per-site, but the certificate endpoint is the canonical source. (The v0.8.0 Zod schema was too narrow and only exposed a fraction of those fields — widened in v0.8.1.)

`GET /1/web_hostings/{hid}/certificates` (the collection, with no site filter) returns `401 not_authorized` even for a token that successfully reads single certificates — likely a separate `certificates:read` scope is required. We don't ship a typed `list_certificates_for_hosting` tool yet for this reason.

Implemented as `infomaniak_get_certificate`, `infomaniak_request_certificate`, `infomaniak_delete_certificate` in v0.8.0.

### Manager UI internal API base — `/v3/api/proxypass_2/1/`

While probing the manager web app's network layer (Angular SPA, `manager4-admin-v3`), we extracted the API configuration from the production bundle:

```js
apiUrl       = "/v3/api/"
apiProxy1    = `${apiUrl}proxypass_2/1/`
apiProxy2    = `${apiUrl}proxypass_2/2/`
apiUrlV1     = `${apiUrl}1/`
apiUrlV2     = `${apiUrl}2/`
apiProxy     = `${apiUrl}proxypass/`
```

So the manager web app calls its backend via `https://manager.infomaniak.com/v3/api/proxypass_2/1/<route>` — a different namespace from the `/proxy/1/...` path we had been using. Both paths route to the same backend (verified live: `GET /proxy/1/web_hostings/{hid}` and `GET /v3/api/proxypass_2/1/web_hostings/{hid}` return byte-identical responses).

We keep `/proxy/1/...` as the default in our `ManagerApiClient` for backward compatibility, but the new path is now documented as the canonical one used by the manager UI itself.

There is also a `/proxy/private/...` namespace that returns `"Not allowed to proxy this route as secured"` for any caller that does not satisfy an additional authentication check we have not yet mapped. The actions behind some of the most sensitive manager buttons (e.g. *"Modifier les droits"* on a database user) likely go through that namespace.

### `chrome-cookies-secure` and `SASESSION`

The MCP reads Chrome cookies for `manager.infomaniak.com` to obtain a working session. Specifically:

- `SASESSION` — the user's manager session cookie. Sent as `Cookie: SASESSION=...`.
- `MANAGER-XSRF-TOKEN` — the Laravel CSRF cookie. URL-decoded and sent as `X-XSRF-TOKEN: ...` for non-GET requests.

Cookies are read on demand by the package, never persisted to disk. The user is in control: signing out of the manager invalidates the cookies and the MCP will report `Authorization required` until the user signs back in.

#### Non-default Chrome profile — `CHROME_PROFILE` and `CHROME_COOKIES_PATH`

By default, `chrome-cookies-secure` reads from the `Default` profile (`~/Library/Application Support/Google/Chrome/Default/Cookies` on macOS). Many real-world setups use a named profile (e.g. `Profile 3` on a multi-account Chrome). v0.7.3 adds two environment variables to support these setups:

```
CHROME_PROFILE       e.g. "Profile 3"          — the named profile, resolved to its standard path
CHROME_COOKIES_PATH  e.g. "/tmp/chrome_profile" — the directory containing a Cookies SQLite file
```

`CHROME_COOKIES_PATH` takes precedence over `CHROME_PROFILE` when both are set. The path-form is useful when Chrome is actively running and holding a lock on its `Cookies` file (`SQLITE_CANTOPEN`) — copy the file to a temp directory and point at it instead.

These env vars are passed straight through to the `chrome-cookies-secure` `profileOrPath` argument, so the lib decides whether to interpret the value as a profile name or as a path.

### Node.js DevOps — the `/proxy/1/` namespace

The Infomaniak `hosting_3` product line (Cloud Server Node.js, service_id 57) sits in a separate management surface from the classic PHP hostings. The public Bearer API exposes essentially nothing for these products:

```
GET /1/hostings/{id}              → {"state": "Ready", "created_at": ...}   ← that's all
GET /1/hostings/{id}/<anything>   → 404 (no sub-routes)
GET /1/web_hostings/{id}          → 403 (wrong namespace for Node.js)
```

Even the Infomaniak [Terraform Provider](https://github.com/Infomaniak/terraform-provider-infomaniak) — which covers DBaaS, KaaS, and Domain/DNS — **ignores** these hostings entirely. So there is no documented path to manage Node.js apps via API.

The actual API used by the manager UI is at `manager.infomaniak.com/proxy/1/...` — different from the namespace `/v3/api/proxypass_2/1/...` used by other parts of the manager. Same auth: SASESSION cookie + MANAGER-XSRF-TOKEN as `X-XSRF-TOKEN` header on non-GET.

**How we mapped it.** Snapshot the XHR fired by the panel `https://manager.infomaniak.com/v3/hosting/{account}/hosting/{php_id}/h3/{node_id}/nodejs/{vhost_id}/data/dashboard` via Chrome DevTools, then enumerate `?with=` valid values via 422 introspection, then probe POST/PATCH actions on each handle. CSRF check happens **before** routing, so a wrong token returns 419 on *every* path — only a fresh-token probe distinguishes 404-truly-missing from 404-CSRF-stripped.

#### The `hosting_features` tree

Every Node.js hosting carries a tree of features chained via `hosting_feature_parent_id`:

```
Storage         (feature_type "Storage",      root)
Node.js         (feature_type "WebApp",       root)
  └─ VhostRoute (feature_type "VhostRoute",   parent: Node.js)   ← FQDNs + actions
       └─ TLSCertificate (feature_type "Certificate", parent: VhostRoute)
SshRoute        (feature_type "SshRoute",     root)
```

The `VhostRoute.id` is the canonical handle for every Node.js action — Infomaniak surfaces it as `feature_id` in some responses and as `vhost_route_id` in others. **All action URLs use this id**, NOT the `Node.js` WebApp id.

#### What `{id}` is in `/proxy/1/hostings/{id}/...` (re-verified 2026-06-15)

**The `{id}` in every `/proxy/1/hostings/{id}/...` path is the `site_id`** (the
hosting_3 site sitting inside the parent web_hosting), **NOT** the parent
`hosting_id`. The two are different — e.g. for Marobal, `hosting_id = 743330`
but `site_id = 106013`, and a `POST /proxy/1/hostings/743330/nodejs/.../actions/restart`
returns 403 access_denied while `POST /proxy/1/hostings/106013/nodejs/.../actions/restart`
returns 200 success.

This was discovered when the manager came back from a partial outage on 2026-06-15
— a manual restart from the UI worked while the MCP tool kept failing with 403.
The cURL capture of the manager UI's XHR revealed the correct path uses `site_id`.

Earlier versions of this MCP (v0.12.0 through v0.15.0) passed `hosting_id`
everywhere and worked by coincidence on hostings where the parent hosting id
and the inner site id happened to match. They returned 403 on all the others.
Fixed in v0.15.1 — the nodejs_* tools (except `list_nodejs_apps`) now require
`site_id` instead of `hosting_id`, discovered via `infomaniak_list_nodejs_apps`.

`list_nodejs_apps` itself was rewritten to use the public Bearer API
(`/1/web_hostings/{hosting_id}/sites`) — more resilient during Infomaniak
manager outages.

#### Endpoints (validated live, 2026-06-15)

```
# Discovery (the path id is site_id — the inner hosting_3 id, not the parent web_hosting id)
GET  /proxy/1/hostings/{site_id}                                 → minimal state
GET  /proxy/1/hostings/{site_id}?with[]=hosting_features         → list apps via tree walk
                                                                   accepted ?with[]: product |
                                                                   hosting_features | offer | feature

# App config
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}?with[]=ips,ssl,environments,storage
                                                                 → Node version, port,
                                                                   start_command, build_command,
                                                                   IPv4 + IPv6, SSL, storage
                                                                   accepted ?with[]:
                                                                   ssl | ips | environments | storage
GET  /proxy/1/hostings/{site_id}/webapp/{vhost}                       → compact runtime info

# Live state + telemetry
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/status        → {status: "Running" | "Stopped"}
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/jobs                  → recent jobs + per-job log_stream
GET  /proxy/1/hostings/{site_id}/webapp/{vhost}/stream                → {endpoint, jwt_token}
                                                                   for the LIVE stdout/stderr SSE
                                                                   on manager-logs-01.hosting-ik.com
                                                                   JWT exp ~1h, aud "msgbeam"
GET  /proxy/1/hostings/{site_id}/webapp/{vhost}/thumbnail?refresh=... → base64 JPEG screenshot

# FQDNs
GET  /proxy/1/hostings/{site_id}/vhost_route/{vhost}/aliases?with[]=domain_options
                                                                 → primary + preview FQDNs

# Mutations (CSRF required)
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/start         → {status: "Running"}
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/stop          → {status: "Stopped"} ⚠ downtime
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/restart       → {status: "Running"}
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/build         → {resource_id, status, log_stream}
                                                                   triggers build_command then
                                                                   relaunches the app

# Generic save endpoint — DO NOT USE for actions
PATCH /proxy/1/hostings/{site_id}/nodejs/{vhost}                      → always {success: true} but
                                                                   mutates nothing observable
                                                                   (generic config-save endpoint
                                                                    that silently no-ops on
                                                                    unknown fields; real
                                                                    mutations are via POST
                                                                    /actions/{name})
```

#### Things that don't exist (despite intuition)

We probed extensively for these — they all return 404:

```
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/deploy   ← no separate deploy action;
                                                              code is pushed via git/SFTP/SSH
                                                              then `build` is triggered
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/install  ← npm install is part of `build`
POST /proxy/1/hostings/{site_id}/nodejs/{vhost}/actions/reload   ← not a thing — `restart` is the
                                                              soft-restart
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/env_variables    ← env vars NOT in the API;
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/env                managed via the app's `.env`
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/variables          file over SSH
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/dependencies     ← introspect via SSH (`npm ls`)
GET  /proxy/1/hostings/{site_id}/nodejs/{vhost}/logs             ← no buffered log endpoint;
                                                              consume the live SSE stream
```

This is by design: the Infomaniak Node.js workflow is `git push → trigger build → app restarts`, with everything else (env, dependencies, file inspection) happening over SSH. Our tool surface mirrors that: `nodejs_app_action` covers the API-driven side, SSH covers everything that has no API.

#### CSRF rotation

The manager backend rotates **both** `SASESSION` and `MANAGER-XSRF-TOKEN` on **every response** (sets new values in `Set-Cookie`). Consumers must re-read the response cookies after each request, or every subsequent POST will fail 419 token_mismatch. `ManagerApiClient` handles this transparently.

## Endpoint inventory

Each row indicates: the HTTP route, whether it is documented, the auth type, and (when relevant) the source we used to confirm the parameters.

| Method | Route | Status | Auth | Source |
|---|---|---|---|---|
| GET | `/1/account` | undocumented | Bearer | live probe |
| GET | `/1/account/{id}` | undocumented | Bearer | live probe |
| GET | `/1/products?per_page=N` | documented | Bearer | dev portal |
| GET | `/1/web_hostings/{id}` | undocumented | Bearer | live probe |
| GET | `/1/web_hostings/{id}/sites` | undocumented | Bearer | live probe |
| GET | `/1/web_hostings/{id}/sites/{sid}?with=…` | undocumented | Bearer | live probe + 422 enumeration |
| POST | `/proxy/1/web_hostings/{id}/sites` | undocumented | SASESSION + CSRF | manager Angular bundle (`chunk-Dofr6lSR.js`) |
| GET | `/proxy/1/hostings/{id}?with[]=hosting_features` | undocumented | SASESSION | XHR capture + 422 enum |
| GET | `/proxy/1/hostings/{id}/nodejs/{vhost}?with[]=ips,ssl,environments,storage` | undocumented | SASESSION | XHR capture |
| GET | `/proxy/1/hostings/{id}/nodejs/{vhost}/actions/status` | undocumented | SASESSION | XHR capture |
| GET | `/proxy/1/hostings/{id}/nodejs/{vhost}/jobs` | undocumented | SASESSION | XHR capture |
| GET | `/proxy/1/hostings/{id}/webapp/{vhost}` | undocumented | SASESSION | live probe |
| GET | `/proxy/1/hostings/{id}/webapp/{vhost}/stream` | undocumented | SASESSION | XHR capture |
| GET | `/proxy/1/hostings/{id}/webapp/{vhost}/thumbnail` | undocumented | SASESSION | XHR capture |
| GET | `/proxy/1/hostings/{id}/vhost_route/{vhost}/aliases?with[]=domain_options` | undocumented | SASESSION | XHR capture |
| POST | `/proxy/1/hostings/{id}/nodejs/{vhost}/actions/{start\|stop\|restart\|build}` | undocumented | SASESSION + CSRF | live probe with fresh CSRF |

This list will grow as the MCP gains tools. Every newly used endpoint should be added here.

## Observed breaking changes

This section records the cases where an endpoint we depend on changed shape mid-flight. Useful for anyone else REing the same surface.

### 2026-06-13 — `/proxy/2/profile`: `with[]=a,b,c` no longer accepted

**Symptom**: `infomaniak_get_my_profile` and `infomaniak_get_my_security` started returning `HTTP 422 Validation failed` on the manager-private `GET /proxy/2/profile`.

**What used to work** (pre-mid-June 2026):
```
GET /proxy/2/profile?with[]=security,emails,phones    → 200 + full payload
```

**What works now**:
```
GET /proxy/2/profile?with=security,emails,phones       → 200 + full payload (security + emails + phones present)
GET /proxy/2/profile?with[]=security&with[]=emails…    → 200 but some `with` values silently dropped
GET /proxy/2/profile?with=*                             → 200 + full payload (wildcard equivalent)
```

**Verdict**: the endpoint now treats `with` as a **scalar comma-separated value**, not a Rails/PHP array. Comma-concat inside `with[]=` is rejected outright. Tested 6 variants live (with valid Chrome cookies) — only `with=` (no brackets) returns the full intended payload.

**Fix applied in v0.14.5**: the 2 affected calls in `src/tools/profile.ts` switched from `query: { "with[]": "..." }` to `query: { with: "..." }`. The other 9 `with[]=` usages in the codebase (Node.js, sites, aliases, mail, account, VPS, domain) pass a single value or a wildcard (`with[]=*`, `with[]=applications`, etc.) and still work — only profile attempted comma-concat.

**Possible explanation**: Infomaniak likely added strict parameter validation on the `/proxy/2/` namespace and the `with[]=foo,bar` shape never made it through. The `/proxy/1/` namespace appears unaffected so far.

## Stability disclaimer

Undocumented endpoints can change without notice. We commit to:

- Pinning known good behavior in tests (so we detect breakage early).
- Recording in `CHANGELOG.md` any time a discovered endpoint stops working.
- Switching to documented alternatives whenever Infomaniak ships them.

If you are building a critical workflow on this MCP, please read the `BREAKING CHANGES` section of `CHANGELOG.md` before each upgrade.
