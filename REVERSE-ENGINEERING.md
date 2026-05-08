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

### `chrome-cookies-secure` and `SASESSION`

The MCP reads Chrome cookies for `manager.infomaniak.com` to obtain a working session. Specifically:

- `SASESSION` — the user's manager session cookie. Sent as `Cookie: SASESSION=...`.
- `MANAGER-XSRF-TOKEN` — the Laravel CSRF cookie. URL-decoded and sent as `X-XSRF-TOKEN: ...` for non-GET requests.

Cookies are read on demand by the package, never persisted to disk. The user is in control: signing out of the manager invalidates the cookies and the MCP will report `Authorization required` until the user signs back in.

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

This list will grow as the MCP gains tools. Every newly used endpoint should be added here.

## Stability disclaimer

Undocumented endpoints can change without notice. We commit to:

- Pinning known good behavior in tests (so we detect breakage early).
- Recording in `CHANGELOG.md` any time a discovered endpoint stops working.
- Switching to documented alternatives whenever Infomaniak ships them.

If you are building a critical workflow on this MCP, please read the `BREAKING CHANGES` section of `CHANGELOG.md` before each upgrade.
