# TouchDevelop cloud APIs

This document describes various REST APIs available in the new TouchDevelop
backend services, i.e., the lite cloud.

The document is based on https://legacy.touchdevelop.com/help/cloudservices

The following are not yet implemented, and may or may not be implemented in future:

* tags
* webapps
* leaderboardscores
* canexportapp API


## conventions

### http, rest, json

All APIs are exposed as REST services; the APIs return either structured JSON
objects, or plain text.

### URLs

All APIs are exposed via URLs of the form ``http://www.touchdevelop.com/api/...``.
The results of all requests under the ``/api/`` prefix return results which are
not meant for direct human consumption.

### access restrictions

At this time, no authentication is required to invoke the APIs described below. 

### search query strings

See here for more documentation on the search query syntax: 
[how to search](https://www.touchdevelop.com/docs/howtosearch).

### count, continuation

When querying a list, you will get the results in batches. 

You can add the query parameter ``&count=[count]`` with a number between 10 and
1000 to indicate how many items you would like to get returned in each batch.
However, the actually returned number of items may be different.

You can add the query ``&applyupdates=true`` if you want that the latest update
of all scripts is returned.

The structured JSON response may contain a field called ``continuation``.  If
this continuation token contains a non-empty string, then there might be more
items available, which you can get by performing the exact same query again
with the added query parameter ``&continuation=[continuation]``.

### publication ids

Each script, user, comment, screenshot, review, tag has a unique id, in general
referred to as its publication id.  Publication ids are sequences of lower-case
latin letters, at least four letters long.  The ids are randomly assigned by
TouchDevelop; the space of possible ids is only used sparcely.  Do not try to
guess ids; instead, use the APIs to enumerate assigned ids.

## APIs

### main lists

The following queries return lists that enumerate all available objects.
All list APIs take the optional ``count``, ``continuation`` and ``etagsmode`` arguments.


* ``/api/scripts`` queries all scripts
* ``/api/users`` queries the list of users
* ``/api/comments`` queries the list of comments
* ``/api/screenshots`` queries the list of screenshots
* ``/api/reviews`` queries the list of reviews (hearts)
* ``/api/art`` queries the list of all art
* ``/api/tags`` queries the list of all tags
* ``/api/webapps`` queries all web apps

All the lists are ordered by publication creation time.

The following queries return lists that enumerate a particular subset of all available objects.

* ``/api/showcase-scripts`` queries list of featured scripts

Examples:

* [/api/scripts?count=20](http://www.touchdevelop.com/api/scripts?count=20)
* [/api/scripts?count=20&continuation=S2520837450019190298-oylo](http://www.touchdevelop.com/api/scripts?count=20&continuation=S2520837450019190298-oylo)
* [/api/search?q=missile](http://www.touchdevelop.com/api/search?q=missile)
* [/api/users?count=100](http://www.touchdevelop.com/api/users?count=100)
* [/api/users?q=samples](http://www.touchdevelop.com/api/users?q=samples)
* [/api/comments?count=1000](http://www.touchdevelop.com/api/comments?count=1000)
* [/api/comments?q=awesome](http://www.touchdevelop.com/api/comments?q=awesome)
* [/api/screenshots?count=1000](http://www.touchdevelop.com/api/screenshots?count=1000)
* [/api/reviews?count=1000](http://www.touchdevelop.com/api/reviews?count=1000)
* [/api/tags?count=1000](http://www.touchdevelop.com/api/tags?count=1000)
* [/api/tags?count=1000&q=games](http://www.touchdevelop.com/api/tags?count=1000&q=games)

### publication properties

Given a publication id, you can query certain properties:
You can get the script text, or its compiled 
[abstract syntax tree](/api/language/webast) by querying ``/api/[scriptid]/text`` and
``/api/[scriptid]/webast``.
As the TouchDevelop language is evolving, the returned script text might
changed. Use ``/text?original=true`` to obtain the script text as it was
originally submitted.


* ``/api/[id]`` for the info about a script, user, comment, screenshot, review, tag, art, run, or run bucket
* ``/api/[scriptid]/text`` for the raw text of a script; optional parameters: ``?original=[boolean]&ids=[boolean]``
* ``/api/[scriptid]/webast`` for the compiled [abstract syntax tree](/api/language/webast) of a script
* ``/api/[scriptid]/successors`` for a list of all successor scripts of a script
* ``/api/[scriptid]/base`` for the base script of a script
* ``/api/[scriptid or userid or tagid or artid]/scripts`` for a list of all scripts that use a library given by its scriptid, or art given by its artid, or all scripts published by a user or given a tag
* ``/api/[scriptid or userid or commentid]/comments`` for a list of all comments for a script or from a user or replies to a comment
* ``/api/[scriptid or userid or tagid]/screenshots`` for a list of all screenshots for a script or from a user or associated with a tag
* ``/api/[commentid or scriptid or userid]/reviews`` for a list of all reviews for a comment or script or from a user
* ``/api/[scriptid or userid]/leaderboardscores`` for a list of all leaderboard scores for a script or from a user; optional parameters: ``&recent=true``
* ``/api/[userid]/subscribers`` for a list of all subscribers of a user
* ``/api/[userid]/subscriptions`` for a list of all subscriptions of a user
* ``/api/[userid]/notifications`` for a list of all notifications of a user
* ``/api/[scriptid or userid]/tags`` for a list of all tags given to a script or given by a user
* ``/api/[userid or scriptid]/art`` for a list of all art published by a user or referenced by a script
* ``/api/[userid]/tagged/[scriptid or tagid]`` for a list of all scripts tagged by a user with a particular tag, or a list of all tags given by a user for a particular script
* ``/api/[userid]/reviewed/[scriptid or commentid]`` for the review of the user for a script or comment
* ``/api/[userid]/leaderboardscored/[scriptid]`` for the leaderboard score of the user for a script or comment (returns an object with just a 'score' field); optional parameters: ``?recent=true``
* ``/api/[userid]/picture`` for the picture of the user; optional parameter: ``type=[square|small|normal|large]`` where ``square`` is 50x50, ``small`` has 50px width, ``normal`` has 100px width, ``large`` has roughly 200px width
* ``/api/[userid]/webapps`` for a list of all web apps of a user
* ``/api/[scriptid]/progressstats`` for the progress per tutorial step
* ``/api/[scriptid]/canexportapp/[userid]`` indicates if user ``userid`` can export the script ``scriptid`` to a native app. The optional ``features`` (``nofeatures``) query argument allows to specify a required (forbidden) column separated list of features.

Examples:

* [/api/ecvs](http://www.touchdevelop.com/api/ecvs) for the info about script with id /ecvs; status code 404 if no such script id
* [/api/ecvs/text](http://www.touchdevelop.com/api/ecvs/text) for the raw text of the script with id /ecvs; status code 404 if no such script id
* [/api/ecvs/webast](http://www.touchdevelop.com/api/ecvs/webast) for the compiled [abstract syntax tree](/api/language/webast) of /ecvs; status code 404 if no such script id
* [/api/ecvs/successors](http://www.touchdevelop.com/api/ecvs/successors) for a list of all successor scripts of /ecvs
* [/api/fhxu/base](http://www.touchdevelop.com/api/fhxu/base) for the base script of /fhxu; status code 404 if no base exists
* [/api/pboj/scripts](http://www.touchdevelop.com/api/pboj/scripts) for a list of all scripts by the user /pboj
* [/api/pboj/comments](http://www.touchdevelop.com/api/pboj/comments) for a list of all comments by the user /pboj
* [/api/pboj/screenshots](http://www.touchdevelop.com/api/pboj/screenshots) for a list of all screenshots by the user /pboj
* [/api/pboj/reviews](http://www.touchdevelop.com/api/pboj/reviews) for a list of all reviews by the user /pboj
* [/api/pboj/leaderboardscores](http://www.touchdevelop.com/api/pboj/leaderboardscores) for a list of all leaderboard scores by the user /pboj
* [/api/pboj/picture?type=square](http://www.touchdevelop.com/api/pboj/picture?type=square) for a square 50x50 picture of the user /pboj; status code 404 if no such user id or no picture set

### JSON format

Each JSON-formatted response contains a ``kind`` field that states the type of the response;
depending on the ``kind``, other fields are available.
The following kinds and other fields may be returned

#### list

* ``kind``: ``"list"``
* ``items``: array of items
* ``continuation``: continuation token (if non-empty string)

#### script

* ``kind``: ``"script"``
* ``time``: time when script was created
* ``id``: script id
* ``name``: script name
* ``baseid``: id of the base script if any; **lite-only**
* ``description``: script description
* ``userid``: user id of user who published script
* ``username``: user name
* ``userscore``: user score
* ``userhaspicture``: whether the user has a picture
* ``userplatform``: optional array of descriptors identifying the platform on which this publication was created
* ``icon``: script icon name
* ``iconbackground``: script icon background color
* ``iconurl``: script icon picture url
* ``iconArtId``: script art picture id if any
* ``splashArtId``: script splash picture id if any
* ``positivereviews``: number of users who added &hearts; to this script
* ``subscribers``: number of users subscribed to this script
* ``comments``: number of discussion threads
* ``screenshots``: number of screenshots
* ``capabilities``: array of capabilities used by this script; each capability has two fields: ``name``, ``iconurl``
* ``haserrors``: whether this script has any compilation errors
* ``rootid``: refers to the earliest script along the chain of script bases
* ``updateid``: refers to the latest published successor (along any path) of that script with the same name and from the same user
* ``ishidden``: whether the user has indicated that this script should be hidden
* ``islibrary``: whether the user has indicated that this script is a reusable library
* ``installations``: an approximation of how many TouchDevelop users have currently installed this script
* ``runs``: an estimate of how often users have run this script
* ``librarydependencyids``: a list of script ids that are referenced as libraries
* ``art``: number of art used by this script
* ``toptagids``: ids of top tag given by most users
* ``mergeids``: a set of script ids whose content was merged into this script
* ``meta``: meta-info associated with a script (like YouTube URL)

Endpoints:

`POST /<scriptid>/meta { field: value, ... }` - set fields in `meta`; set to `null` to remove

    POST /scripts
    { 
       text: "...script text...",
       baseid: "<scriptid>",
       editor: "...",
       mergeids: ["<scriptid>",...],
       name: "...",
       description: "...",
       iconbackground: "...",
       islibrary: true/false,
       ishidden: true/false,
       iconArtId: "...",
       splashArtId: "...",
       meta: { ... },
    }

The API above is not currently used by the web app.

#### installed scripts

All of these are private to the user in question.

* `GET /<userid>/installed` - get list of headers of installed scripts
```
    export interface Version {
        instanceId: string;
        version: number;
        time: number;
        baseSnapshot: string;
    }
    export interface Header {
        guid: string;           // unique identifier for this installation slot
        name: string;           // user-supplied name of the script
        scriptId: string;       // if script is based on another script - its ID is here
        userId: string;         // author of [scriptId]
        scriptTime:number;      // publication time of [scriptId]
        updateId: string;       // if an update exists, it's here
        updateTime:number;      // publication time of the update
        scriptVersion: Version; // version number
        meta: any;              // derived from script source (description, icons etc)
        capabilities: string;   // not used
        flow: string;           // not used
        status: string;         // "published", "unpublished" (or modified from published version) or "deleted"
        hasErrors: boolean;     // not used
        publishAsHidden:boolean;// used in publication flow
        recentUse: number;      // seconds since epoch
        editor?: string;        // empty if Touch Develop
        target?: string;        // for KS
    }
    export interface InstalledHeaders {
        headers: Header[];
        newNotifications: number;
        notifications: boolean;
        time: number;
        minimum?: string;
        random?:string;
        v?: number;
        user?: any;
        blobcontainer?: string;
    }
```

The actual script text is fetched from URL: 
  `blobcontainer + "/" + h.scriptVersion.baseSnapshot`
This is a public URL, but `baseSnapshot` is a random name.

* `GET /<userid>/installed/<guid>` - get one header
```
POST /<userid>/installed
  {
    bodies: [
      {
        guid: string
	name: string
	scriptId: string
	userId: string
	scriptVersion: { ... }
	recentUse: number
	script: string
	editorState: string
	meta: any JSON
      }
    ]
  }
```


#### user

* ``kind``: ``"user"``
* ``time``: time when user account was created
* ``id``: user id
* ``name``: user name
* ``about``: user's about-me text
* ``features``: number of features used by that user
* ``receivedpositivereviews``: number of &hearts; given to this user's scripts and comments
* ``subscribers``: number of users subscribed to this user
* ``score``: overall score of this user
* ``haspicture``: whether this user has a picture


Private user APIs - only accessible to the user themselves, their facilitators, and admins:
* `DELETE /<userid>` - remove user account and all their assets
* `GET /<userid>/resetpassword` - generate a number of new bitcodes for given user; 
  returns `{ passwords: [ "...", ... ] }`
* `POST /<userid>/resetpassword { password: "..." }` - set password for a bitcode-authenticated user
```
POST /generatecodes 
  { 
    count: <how many codes>, 
    credit: <how much credit per code>,
    singlecredit: <how much credit give out on each usage>, // optional, defaults to credit
    permissions: <permission string>,  // optional; permissions to grant
  }
```
The theoretical maximum number of allowed users is `count * credit`, regardless
of `singlecredit` which should be no bigger than `credit`, and allows a single
code to be used multiple times; typically when `singlecredit` is given, `count`
is 1.
```
POST /<userid>/settings
  {
    nickname: "... same as user->name ...",
    email: "someone@example.com",
    editorMode: "...",

    ... and a number of other fields including: website, aboutme, picture,
    gender, realname, location, culture, howfound, programmingknowledge,
    occupation, twitterhandle, school, wallpaper, yearofbirth (number) ...
  }
```

* `GET /<userid>/settings[?shortform=true]` - like the above and also:
```
  credit: number;
  permissions: string;
```

#### subscription

Subscription don't have a separate JSON object type. Instead the following lists are visible:

* `/<userid>/subscribers` - who subscribes to a given user
* `/<userid>/subscriptions` - who does the user subscribe to

Updates:

* `POST /<userid>/subscriptions {}` - subscribe calling to user to the given
  user; modifies `/<userid>/subscribers` (yes this is not logical)
* `DELETE /<userid>/subscriptions` - unsubscribe calling user from the given user


#### comment

* ``kind``: ``"comment"``
* ``time``: time when comment was created
* ``id``: comment id
* ``text``: comment text
* ``userid``: user id of user who published comment
* ``username``: user name
* ``userscore``: user score
* ``userhaspicture``: whether the user has a picture
* ``userplatform``: optional array of descriptors identifying the platform on which this publication was created
* ``publicationid``: script id that is being commented on, or parent comment id if ``nestinglevel>0``
* ``publicationname``: script name
* ``publicationkind``: "script"
* ``nestinglevel``: 0 or 1
* ``positivereviews``: number of users who added &hearts; to this comment
* ``subscribers``: number of users subscribed to this comment
* ``comments``: number of nested replies available for this comment

Create:

    POST /<publication in>/comments
    {
      text: "..."
    }

#### group

* ``kind``: ``"group"``
* ``time``: Number
* ``id``: String
* ``name``: String
* ``pictureid``: the id of art which is the picture for this group
* ``description``: String
* ``school``: String
* ``grade``: String
* ``allowexport``: Boolean
* ``allowappstatistics``: Boolean
* ``isrestricted``: Boolean
* ``isclass``: Boolean
* ``userid``: user id of user who owns the group
* ``username``: user name
* ``userscore``: user score
* ``userhaspicture``: whether the user has a picture
* ``userplatform``: optional array of descriptors identifying the platform on which this publication was created
* ``positivereviews``: number of users who added &hearts; to this group
* ``subscribers``: number of users subscribed to this group
* ``groups``: number of nested replies available for this comment

Create:

    POST /groups
    {
      name: "...",
      isclass: true/false,
      ... any of the fields in update below ...
    }

Update (all fields are optional):

    POST /<group id>
    {
      description: "...",
      school: "...",
      grade: "...",
      pictureid: "...",
      allowappstatistics: true/false,
      allowexport: true/false,
      isrestricted: true/false,
    }

Codes:
* `POST /<userid>/code/<code> {}` - redeem code (e.g., to join group)
* `GET /<userid>/code/<code> {}` - lookup code
* `GET /<groupid>/code` - get current code for a group (owner only)
* `DELETE /<groupid>/code` - allow anyone to join (delete code)
* `POST /<groupid>/code {}` - generate new code

Join/leave:
* `POST /<userid>/groups/<groupid>` - join group (if there is no code)
* `DELETE /<userid>/groups/<groupid>` - leave group
* `GET /<userid>/groups/<groupid>` - check group membership

Lists:
* `/<userid>/groups` - groups the user is member of
* `/<userid>/owngroups` - groups the user is owner of
* `/<groupid>/users` - members

#### review

* ``kind``: ``"review"``
* ``time``: time when review was created
* ``id``: review id
* ``userid``: user id of user who published review
* ``username``: user name
* ``userscore``: user score
* ``userhaspicture``: whether the user has a picture
* ``userplatform``: optional array of descriptors identifying the platform on which this publication was created
* ``publicationid``: script id that is being reviewed
* ``publicationname``: script name
* ``publicationkind``: "script" or "comment"
* ``ispositive``: ``"true"`` indicates a &hearts;

#### art

* ``kind``: ``"art"``
* ``time``: time when art was created
* ``id``: art id
* ``userid``: user id of user who published art
* ``username``: user name
* ``userscore``: user score
* ``userhaspicture``: whether the user has a picture
* ``userplatform``: optional array of descriptors identifying the platform on which this publication was created
* ``name``: art name
* ``description``: art description
* ``pictureurl``: picture url if art is a picture
* ``thumburl``: thumbnail url if art is a picture
* ``mediumthumburl``: optional bigger thumbnail
* ``wavurl``: url of wave file if art is audio
* ``aacurl``: url of aac file if art is audio
* ``contenttype``: MIME content type (image/jpeg, text/plain etc) 
* ``arttype``: "picture", "sound", "text" (.txt, .css, .js etc), or "blob" (.docx, .pdf, etc)
* ``bloburl``: non-empty for all art types; URL where the content can be found

Creating art:

    POST /api/art
    { 
        kind: "art",
        name: "...",
        description: "...",
        content: "...text or base64 binary...",
        contentEncoding: "base64" (default) or "utf8"
    }



#### release

**admin-only**

* ``kind``: ``"release"``
* ``time``: Number
* ``id``: String
* ``releaseid``: something like `2519768268998970000-496c2875.9efd.4659.b3fe.1b5b73dade32-80042`
* ``userid``: String
* ``username``: String
* ``userscore``: Number
* ``userhaspicture``: Boolean
* ``labels``: Collection of release label

#### release label

**admin-only**

* ``name``: `"beta"`, `"current"`, etc
* ``userid``: String
* ``time``: Number
* ``releaseid``: String

#### pointer

Pointers are a way of creating permanent URLs in the website, which point to rendered scripts.

* ``kind``: ``"pointer"``
* ``time``: Number
* ``id``: `"ptr-<encodedurl>"` - the actual URL path of the pointer is encoded by replacing non-alphanumeric 
  characters with "-"; here it would be `ptr-foo-bar`
* ``path``: "foo/bar"; will be visible under `https://www.example.com/foo/bar`
* ``scriptid``: the target of the pointer
* ``redirect``: the pointer is just a redirect to a different pointer
* ``description``: String
* ``userid``: user id of user who owns the pointer
* ``comments``: number of comments

Regular users are only allowed to post where `path` starts with `<userid>/`.

Creating (and updating):

    POST /pointers
    {
      path: "<userid>/foo/bar",
      scriptid: "...", (optional)
      redirect: "...", (optional)
    }

Updating:

    POST /<pointerid>
    {
      scriptid: "...",
      redirect: "...",
    }

#### notification

* ``kind``: ``"notification"``
* ``time``: Number
* ``id``: String
* ``notificationkind``: "subscribed", "fork", "reply", "onmine"
* ``userid``: String
* ``publicationid``: String
* ``publicationname``: String
* ``publicationkind``: String
* ``supplementalid``: the id of the "parent" - comment on what, fork of what etc
* ``supplementalkind``: String
* ``supplementalname``: String

Created automatically.

* `/notifications` - all notifications in the system
* `/<userid>/notifications` - notifications for a particular user
* `POST /<userid>/notifications {}` - reset notification count

#### abuse report

* ``kind``: ``"abusereport"``
* ``userid``: who created the abuse report
* ``publicationid``: the abusive publication
* ``publicationuserid``: the author of the abusive publication
* ``time``: when the abuse report was created
* ``text``: the explanation for abuse report entered by the reporting user
* ``resolution``: initially empty; later `deleted` or `ignored`

To create:

    POST /api/<publication id>/abusereports
    {
      text: "..."
    }

To update:

    POST /api/<abuse report id>
    {
      resolution: "ignored"
    }

* `/<userid>/abuses` - abuse reports about publications of a given user
* `/<userid>/abusereports` - abuses reported by a given user
* `/<publicationid>/abusereports` - abuse reports about a given publication
* `/abusereports` - all abuse reports

```
GET /<publicationid>/candelete =>
{
  candelete: true/false, // current user can delete or not
  hasabusereports: true/false,
  canmanage: true/false, // the current user has mangement permissions over the publication author
}
```

#### channel

Channels contain scripts, or rather update triples - rootid, userid, title.

* ``kind``: ``"channel"``
* ``time``: Number
* ``id``: String
* ``name``: String
* ``pictureid``: the id of art which is the picture for this channel
* ``description``: String
* ``userid``: user id of user who owns the channel
* ``username``: user name
* ``userscore``: user score
* ``userhaspicture``: whether the user has a picture
* ``userplatform``: optional array of descriptors identifying the platform on which this publication was created
* ``positivereviews``: number of users who added &hearts; to this channel
* ``comments``: number of comments

Lists:
* `/<script id>/channels` - all channels in which this script is listed
* `/<script id>/channels/<channel id>` - check if the script is part of a channel (404 if not)
* `/<script id>/channelsof/<userid>` - all channels of particular user in which the script is listed (typically `/<...>/channelsof/me`)
* `/<channel id>/scripts` - all scripts in the channel; `?applyupdates=true` is implicit
* `/channels` - all channels
* `/<userid>/channels` - all channels of a given user

Create:

    POST /channels
    {
      name: "...",
      description: "...",
      pictureid: "...",
    }

Update:

    POST /<channel id>
    {
      description: "...",
      pictureid: "...",
    }

* `POST /<script id>/channels/<channel id>` `{}` - add script to a channel
* `DELETE /<script id>/channels/<channel id>` - remove script from a channel


#### other admin-only APIs

* `POST /config`
* `POST /recimport/<publicationid>[?force=true][?fulluser=true]` - import from touchdevelop.com
* `POST /<releaseid>/files` - add files to a release
* `POST /<releaseid>/label` - set release label



### ``ETag``/``If-None-Match`` headers
        
Every successful response contains an ``ETag`` header representing a stable hash derived form the content of the response.
This hash can be passed in as part of a future request via a ``If-None-Match`` header. 
If the content matches the given hash, a ``304 Not modified`` response status code is returned and the unchanged response content is omitted.

### Using ETags in list queries
        
The optional query parameter ``&etagsmode=[etagsmode]`` for list queries can be used to reduce the data transfers required to perform queries and responses.
The ``etagsmode`` can be one of the following.


* ``includeetags``: The list response will not only contain a ``items`` field, but also an ``ids`` field, containing an array of objects of the form ``{ "id": $id, "ETag": $hash }``, indicating the ``ETag`` value that a separate ``/api/$id`` request would have returned for each ``$id``.
* ``etagsonly``: The list response will contain an ``ids`` field, and ``items`` will be omitted.

Examples:

* [/api/scripts?etagsmode=includeetags](http://www.touchdevelop.com/api/scripts?etagsmode=includeetags)
* [/api/scripts?etagsmode=etagsonly](http://www.touchdevelop.com/api/scripts?etagsmode=etagsonly)


To further reduce data transfers for requests with rarely changing responses, e.g. ``featured-scripts``, 
you can indicate in the query that you already have obtained the information about a publication earlier.
You do so by appending the ``etagsmode`` with a comma followed by a comma-separated list of 
``id:ETag`` pairs.

Examples:

* [/api/scripts?etagsmode=includeetags%2Cabcd%3ASOMEETAG1%2Cbcde%3ASOMEETAG2](http://www.touchdevelop.com/api/scripts?etagsmode=includeetags%2Cabcd%3ASOMEETAG1%2Cbcde%3ASOMEETAG2) where the value of ``etagsmode`` is the URL-encoded form of the string ``includeetags,abcd:SOMEETAG1,bcde:SOMEETAG2``


If the query string gets long, or you want that it gets compressed, wrap the request in a batch request.

### batch requests

You can bundle requests. Bundling involves encoding HTTP requests and responses in JSON form.


To perform a batch request, do a ``POST`` request to ``/api``, with a JSON body containing a batch of requests. 
Unless the JSON body is malformed or there is a fundamental problem with the HTTP request, 
the main ``/api`` call should always return with a ``200 OK``,
while all individual sub-requests have their own status codes embedded in a response JSON object.


At this time, a batch request may include at most 50 individual requests.

#### batch JSON form of basic HTTP request

An HTTP request similar to

    GET http://touchdevelop.com/api/$path
    If-None-Match: $hash

is encoded in JSON as follows.

    { "method": "GET", "relative_url": "$path", "If-None-Match": "$hash" }

The ``"method"`` field can be omitted and then ``"GET"`` will be assumed as the method.
An HTTP response similar to

    200 OK
    ETag: $hash
    $json

is encoded in JSON as follows.

    { "code": 200, "body": $json, "ETag": "$hash" }

#### batch array of requests

You can bundle an array of requests ``[ $request1, $request2, ..., $requestN ]``, where each ``$requestI`` is given in JSON-encoded form, as follows.

    { "array": [ $request1, $request2, ..., $requestN ], 
    "If-None-Match": "$hash" }

Responses come in array form as well.

    { "code": 200, 
      "array": [ $response1, ..., $responseN ], 
      "ETag": "$hash" }

Note that such array requests and responses work with ``ETag``/``If-None-Match`` just as individual requests.

#### limitations

Not all URLs are supported for batch requests yet. Not yet supported APIs are:


* ``/api/[id]/picture``

    
### ssl

All queries must be performed via ``https``. All queries to ``http`` will be redirected to ``https``.

### faq

* *How to enumerate all scripts?* Start by querying for some latest scripts: [/api/new-scripts?count=20](http://www.touchdevelop.com/api/new-scripts?count=100). At the end of the JSON response, you will find a continuation token like ``S2520751967211266017-vrgz``. To get the next 100 scripts, query [/api/new-scripts?count=20&continuation=S2520751967211266017-vrgz](http://www.touchdevelop.com/api/new-scripts?count=100&continuation=S2520751967211266017-vrgz); the response will contain another continuation token. And so on, until the continuation token is empty.
* *How is time represented?* The time values are seconds since the beginning of January 1st 1970 in UTC.


