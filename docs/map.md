# Source file list and general architecture

## Top-level scripts

* tdlite.ts -- main service
* remote.ts -- access management interface of the [shell](deployment.md)
* templater.ts -- serve or upload HTML templates to the website
* storutil.ts -- utility to access Azure storage from command line
* test-service.ts -- playground

## Basic libraries

* td.ts - TouchDevelop compatibility layer:
  * a few utility functions
  * Logger interface (with plugin support)
  * JSON serialization support
  * client http-request with decompression and Promise support
  * various hacks/fixes for socket handling in node.js (mostly to do with socket pooling)
* parallel.ts - utilities for parallel async/await/Promises
* cron.ts - distributed cron (scheduled, periodic tasks)
* server-auth.ts -- wraps several OAuth2 providers (FB, Google, Live, Yahoo, GitHub etc)
* restify.ts -- REST API routing; see also tdlite-routing.ts
* nodemailer.ts -- email sending using direct SMTP calls (when sendgrid not allowed)
* tdshell.ts -- send encrypted management requests to the [shell](deployment.md)
* word-password.ts -- generate 4-word passwords
* cached-store.ts -- key-value storage on top of Azure Blob Storage, cached in redis and/or in memory (see below)
* indexed-store.ts -- uses Azure Tables for indexes over cached-storage (see below)

## Interfaces to cloud services

* azure-blob-storage.ts -- using `azure-storage` npm module
* azure-table.ts -- using `azure-table-node` npm module (which uses JSON, not XML Atom API, and is thus faster)
* raygun.ts -- using `raygun` npm module and REST as fallback (utf8 issues with raygun module)
* redis.ts -- using `redis` npm module 

These just wrap regular REST calls:

* acs.ts --- Microsoft's internal Content Validation Service
* azure-search.ts
* crowdin.ts - translation service
* kraken.ts - image resizing
* librato-node.ts - performance monitoring
* loggly.ts - logging
* mbedworkshop-compiler.ts - ARM's mbed compiler
* microsoft-translator.ts
* sendgrid.ts

## Service files

* tdlite-core.ts -- general service settings, throttling, utilities, data structures
* tdlite-data.ts -- random static data (list of cultures, list of MIME types, ...)
* tdlite-html.ts -- static pieces of HTML
* tdlite-counters.ts -- counters of scripts, users, etc; also handling of `/api/dailystats`, which returns daily data about such events
* tdlite-cppcompiler.ts -- interface to C++ compilers - ARM's and the one in `dockerbuild/` in this repo
* tdlite-docs.ts -- macro expansion in HTML templates (not used in PXT)
* tdlite-i18n.ts -- crowdin support for documentation
* tdlite-import.ts -- import from old td.com
* tdlite-index.ts -- extract features from publications for search indexing
* tdlite-legacy.ts -- import of accounts from old td.com
* tdlite-login.ts -- handling of login either via server-auth.ts or word-password.ts
* tdlite-routing.ts -- implements custom REST API routing (see below)
* tdlite-status.ts -- reporting of CPU load and failures of redis/storage
* tdlite-tdcompiler.ts -- interface to TouchDevelop running in a separate cloud service; this is used primarily for rendering scripts as docs (not in PXT though)

These files deal with specific REST API requests:

* tdlite-admin.ts -- deals with assorted admin requests
* tdlite-ticks.ts -- handles POST /api/ticks
* tdlite-progress.ts -- handles tutorial progress APIs
* tdlite-vimeo.ts -- vimeo thumbnail and video caching in blob storage
* tdlite-workspace.ts -- handling of locally installed user's scripts `/api/me/installed`
* tdlite-runtime.ts -- allow TouchDevelop runtime to call translation, sign JWT tokens, generate revision service tokens, and proxy web requests that cross origins
* tdlite-search.ts -- handling of `/api/search`, `/api/websearch`, publication indexing and forced document reindexing, publication counting; also calls into `acs.ts`

These files deal with a specific publication kind:

* tdlite-abuse.ts
* tdlite-art.ts
* tdlite-audit.ts
* tdlite-channels.ts
* tdlite-comments.ts
* tdlite-crashes.ts
* tdlite-groups.ts
* tdlite-notifications.ts
* tdlite-pointers.ts
* tdlite-promos.ts
* tdlite-releases.ts
* tdlite-reviews.ts
* tdlite-scripts.ts
* tdlite-tags.ts
* tdlite-users.ts

## Custom REST API routing

TDB doesn't use restify routing much. This is due to need to support batch API
calls among other things.

All of API endpoints under `/api/*` are handled by routes installed with
`core.addRoute(method, root, verb, handler)`. `method` is `GET`, `POST` etc.
`root` can be either a constant string like `new-scripts`, or `*` followed by
a publication kind. For example, `core.addRoute("GET", "*script", "text", ...)`
will add handler for `GET /api/xyzw/text` where `xyzw` is an ID of a script.
It's also possible to install handler for `*pub` which will match any
publication kind. The `verb` argument can be empty (for example,
`core.addRoute("GET", "search", "", ...)`, or it can be `"*"` to match any
string.

The order in which routes are added doesn't matter. `addRoute` will throw
when trying to add the same route twice. Routes with constant strings are
tried before `"*specific-kind"`, which are before `"*pub"`, and `"*"`.

`core.addRoute()` will add size-checking (limit is 20k) on the request. It can
be disabled with `noSizeCheck` optional argument, or `sizeCheckExcludes` to
check the size of the request, except for named JSON field (typically text of
script or content of art resource). 

The `handler` function is async and takes an `req:ApiRequest` object. Handler
is supposed to either store response JSON (or text) object in `req.response`,
or modify `req.status` from the default value of `200`. If `req.status != 200`
when handler finishes, `req.response` is ignored.

Fields of interest of `ApiRequest`, assume `GET /api/xyzw/text?foo=bar`
request:

* `method == "GET"`
* `root == "xyzw"`
* `rootId == "xyzw"`
* `rootPub == {` ... JSON object representing script /xyzw ... `}`
* `verb == "text"`
* `argument == ""` -- next path element after `verb`
* `subArgument == ""` -- next path element after `argument`
* `subSubArgument == ""` -- next path element after `subArgument`
* `queryOptions == { foo: "bar" }`
* `body == null` -- set for `POST` requests to JSON object posted
* `userid == "abcd"` -- user ID of the calling user or empty
* `status == 200`
* `response == null`
* `responseContentType == ""` -- will default to `application/json`, or `text/plain` depending on `typeof response`
* `origUrl == "/api/xyzw/text?foo=bar"`
* `headers == null` -- response headers
* `userinfo` -- information about calling user if any
* `restifyReq` -- underlying request; this can be a batch request!

## Throttling

Throttling is realized by removing tokens from buckets. The buckets are replenished at
the rate of 1 token per second, but cannot hold more than 3600 tokens.
Each user has a number of buckets for different kinds of operations.
Users are identified either by userid if they are logged in, or by IP address
if they are not.

Each operations has a token cost and bucket assigned to it. The tokens are
removed from the bucket when the request is made. If the bucket doesn't contain
enough tokens than: (a) if what is missing is less than 10 tokens, the server
waits for the tokens to become available and then removes them and responds,
otherwise (b) the server responds with HTTP 429 Too Many Requests and doesn't
remove any tokens.

Following are the token costs associated to operations:
* API requests at `/api/cached/*`
  * no throttling if cache is hit
  * 10 from (user, "apireq") on cache miss
* any other API request: 2 from (user, "apireq") bucket
  * API request returning 404 status, additionally 3 from (user, "apireq")
* mbed compile extension/template hex file: 
  * initially 5 from (user, "compile") bucket
  * additionally 50 from (user, "compile") if an actual compile needs to be started
  * usually though, it's zero, as the .hex file is already on CDN and no API req is made
* create any publication (including review and abuse report): 60 from (user, "pub") bucket
* authentication attempt with code: 10 from (ip, "code") bucket

Operation-specific throttling can be done with something like:

```javascript
await core.throttleAsync(apiRequest, "web-proxy", 10)
if (apiRequest.status != 200) return;
```

Implementation-wise every token is a variable (redis key) holding a timestamp
saying when the next request can be processed. This timestamp can be in the
past (but not more than 3600s), or in the future (in which case we need to wait
before responding).

Throttling generally doesn't apply to users with `unlimited` permission.

## Cached storage

Cached store is a key-value store organized in containers and backed by Azure
Blobs.  Keys are strings and values are JSON objects.

The elements can be cached in Redis. Redis caching is sequentially consistent
(there is only one Redis instance used). By default elements are stored in
redis for 2h.

Elements can be also cached in memory on the current instance. This cache can
be stale. Typically, we assume validity of this cache of about 15s. 

Container are represented by `cachedStore.Container` class, which has
following methods of interest:

* `getAsync` - get one element
* `getManyAsync` - get many elements (more efficient than parallel map of `getAsync`)
* `updateAsync(id, update)` - update given element, by running `update(json)`
  on its value. The `update()` function will be run multiple times if there is
  conflict of writing the element. Conflict are resolved  by etag protocol of
  Azure Blob storage
* `tryInsertAsync(id, json)` - try to create a new element (usually at random short id)

Cached store adds `__version` field to stored JSON objects. It also sets `id`
field to the id of the object.

## Indexed storage

Indexed storage builds on top of cached storage. It uses Azure Tables to
provide indices. It adds `kind` field to stored JSON objects. The
`indexedStore.Store` class has following methods of interest:

* `generateIdAsync(minLength)` - reserve a new random short id; usually `core.generateIdAsync` is used instead
* `insertAsync(obj)` - insert object under previously reserved id and also into all indices
* `createIndexAsync(name, toKey)` - create an index; `toKey(obj)` should project the store 
   object into its index value; for example `createIndex("byuser", obj => obj["pub"]["userid"])`

Indexes are created upon initialization. Also, after adding indices `reinit`
variable needs to be set to `true` in `tdlite.ts` and the service redeployed
at least once to create the tables. You should not run with `reinit == true`
when there are tens or hundreds of instances -- it will cause random startup
problems (mostly with Azure Search). TODO - make this automatic

Element in indices are ordered by creation time, most recent first.

## setResolveAsync

Publications in indexed store generally have the following fields:

* `id`
* `kind` -- assigned by indexed store
* `__version` -- assigned by cached store
* `pub` -- public data about the object

Every store kind has its own resolution function assigned with
`core.setResolveAsync`. This function usually copies the `pub` field into response
and then augments it, by for example adding `username` based on `userid`.

There can be other fields outside `pub`, and the resolution function can use
them to construct response.

Publications from indexed store are never returned directly to the user, they
always go through resolution first. This means it can be used to implement
security, for example script resolution function will not return hidden
scripts of other users in aggregate responses.

The resolution function always runs on lists of publications for performance
reasons. You can use `core.resolveOnePubAsync()` to run it on a single
publication.

`core.setResolveAsync` always creates an index named `all`. It can also
optionally create index of publications by author or parent publication.
Other indices need to be created with `createIndexAsync`.

## Permissions

Every user is assigned a set of permissions. Permissions are identified by
strings. Every permission can subsume zero or more other permissions. This
relation is defined in service configuration.

Typical permission checking pattern is:

```
if (!core.checkPermission(req, "foobar"))
   return;

```

Some permissions of interest:

* admin -- automatically subsumes any other permission
* `write-ptr-*` - allows overwriting and creating URLs at a particular location
  * for example, write-ptr-foo-bar allows writes at `/foo/bar/*` (and also at `/foo-bar-*` for technical reasons)
  * in addition to `write-ptr-*`, also `root-ptr` is required
  * `write-ptr` allows writing anywhere
* level0, level1, ..., level6 -- used in conjunction with other permissions to
  determine who can manage whose content
* adult - only adult can be facilitator; only non-adult can be facilitated by group membership
* external-links - allow external links and videos in CMS content
* post-* - ability to create specific kinds of publications
  * post-abusereport
  * post-review
  * post-script
        * post-script-meta - set cover art/video/internal video on a script
        * post-direct-script - allow using of `POST /api/scripts` in addition to publishing via workspace sync protocol (PXT uses only this method)
  * post-art - required for posting any art
        * post-art-jpg - allows posting JPG files
        * post-art-png - allows posting PNG files
        * post-art-js
        * post-art-css
        * post-art-txt
        * post-art-docx
        * post-art-pptx
        * post-art-pdf
        * post-art-zip
        * post-art-mp4 (movies)
        * post-art-wav
  * post-pointer - publish at /usercontent/scriptid on the website
  * post-screenshot
  * post-subscription
  * post-comment
  * post-channel
* root-ptr - can create arbitrary URLs on website
* unlimited - not subject to throttling of publication frequency or API call frequency
* post-raw - post raw HTML
* web-upload - allow upload at CDN/files
* global-list
* script-promo - management of script promos
* global-list - see list of all scripts, all groups, all ...; in `core.fullTD` (non-microbit.co.uk) everyone can see that
  * also see list of members in groups you're not member of
  * also see results in search even if they were reported as abusive
* official - can use words like "Microsoft", "Official" in the nick name
* user-mgmt
  * get user permissions
  * set user credit
* any-facilitator - act as facilitator for any user
  * set status of abuse report on that user
  * reset bitcode (4-word password)
  * delete any publication by that user
  * delete user and all their publications 
  * see unmoderated scripts
* script-promo - allow editing `promo` field of a script
* stats - view site statistics (usage of editors etc)
* gen-code - generate access codes; if code gives permissions they need to be subset of current user permissions
* signin-XXXX - sign in as given user
* permission-mgmt - allows setting other user's permissions; the calling user has to have all the permissions that:
  * the target user currently has
  * the target user would have after the operation
* upload - upload releases
* lbl-latest - allow setting `latest` label; similar for other labels; not used in PXT release upload
* custom-pointer - publish at /user/userid/anything on the website
* view-bug - view crash reports on site
* operator - reindexing search etc
* root - various dangerous stuff, including
  * set user permissions
* me-only - impersonate a user; no UI for any of these exists
  * join/remove users from arbitrary groups
  * reset notification count for a user
  * view and update scripts in user's workspace (installed private scripts)
  * view and update user's settings (nickname etc)
* pub-mgmt - act as owner of any publication
  * set script meta (vimeo video etc)
  * update any pointer
  * update channel properties
  * add/remove scripts from channel
  * update group properties (including access code)

Users at level4 or above cannot be deleted (by anyone). You have to update their
permissions first. This is because the consequences of deleting some of these
users would be rather dire.

Certain permissions are by convention used as 'roles', i.e., they are assigned
as a sole permission to a user, and they are not used in direct
`checkPermission` calls. Instead, they subsume a number of other permissions.

Permissions need not be defined anywhere, though usually you will have
them subsumed by one or more 'role' permissions.

Also see microbit-extras/systems/web/design/permissions.md

## Encryption in storage

Certain data (usually PII) is encrypted in JSON objects of publications.
This is done manually with `core.encrypt()` and `core.decrypt()` functions.

## Long polling

`core.longPollAsync()` is used to implement long polling of notifications or
installed scripts. This works with redis message passing.

## Cache locking

Whenever there is a time-consuming operation, results of which are cached
there is a risk that when the cache expires and the site is under heavy load,
many workers will try to re-create the cache entry at the same time (new
clients coming in, while the cache is already being recomputed).

This is particularly true for rendering documentation scripts using TD compile
service, but other HTML generation tasks can be also affected.

In such cases use the following pattern:


```javascript
let lock = await core.acquireCacheLockAsync(path);
if (lock == "") {
   // ... call self again - retry ...
   return
}
// ... recompute ...
// ... store cache ...
await core.releaseCacheLockAsync(lock);

```


