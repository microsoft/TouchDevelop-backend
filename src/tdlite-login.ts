/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

import * as azureBlobStorage from "./azure-blob-storage"
import * as azureTable from "./azure-table"
import * as cachedStore from "./cached-store"
import * as parallel from "./parallel"
import * as restify from "./restify"
import * as wordPassword from "./word-password"
import * as serverAuth from "./server-auth"
import * as core from "./tdlite-core"
import * as audit from "./tdlite-audit"
import * as search from "./tdlite-search"
import * as tdliteHtml from "./tdlite-html"
import * as tdliteUsers from "./tdlite-users"
import * as tdlitePointers from "./tdlite-pointers"
import * as tdliteGroups from "./tdlite-groups"
import * as tdliteLegacy from "./tdlite-legacy"

export type StringTransformer = (text: string) => Promise<string>;

type IUser = tdliteUsers.IUser;

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var kidsDisabled = true;

var logger = core.logger;
var httpCode = core.httpCode;
var loginHtml: JsonObject;
var initialApprovals: boolean = false;
var tokensTable: azureTable.Table;

export class LoginSession
    extends td.JsonRecord {
    @td.json public state: string = "";
    @td.json public userid: string = "";
    @td.json public groupid: string = "";
    @td.json public passwords: string[];
    @td.json public pass: string = "";
    @td.json public ownerId: string = "";
    @td.json public termsOk: boolean = false;
    @td.json public codeOk: boolean = false;
    @td.json public nickname: string = "";
    @td.json public realname: string = "";

    @td.json public askLegacy = false;
    @td.json public legacyCodes: {}; // code -> userid; there may be multiple accounts attached to an email    

    @td.json public profileId: string;
    @td.json public providerId: string;
    @td.json public storedMessage: string;
    @td.json public oauthClientId: string;
    @td.json public oauthU: string;
    @td.json public oauthHost: string;
    @td.json public federatedUserInfo: serverAuth.IUserInfo;
    @td.json public linksecret: string;
    @td.json public restartQuery: string;

    static createFromJson(o: JsonObject) { let r = new LoginSession(); r.fromJson(o); return r; }

    public userCreated() {
        return (this.userid && this.userid != "pending");
    }

    static async loadCoreAsync(id: string): Promise<LoginSession> {
        let sessionString = orEmpty(await serverAuth.options().getData(orEmpty(id)));
        logger.debug("session string: " + sessionString);
        if (sessionString != "") {
            return LoginSession.createFromJson(JSON.parse(sessionString));
        } else return <LoginSession>null;
    }

    public getRestartQuery() {
        if (!this.linksecret)
            this.linksecret = td.createRandomId(12);
        return this.restartQuery + "&u=2" + this.state + "." + this.linksecret
    }

    public async getLinkedSessionAsync(): Promise<LoginSession> {
        let tokM2 = /^2(\w+)\.(\w+)$/.exec(this.oauthU);
        if (tokM2) {
            let othersession = await LoginSession.loadCoreAsync(tokM2[1])
            if (othersession && othersession.linksecret && othersession.linksecret == tokM2[2]) {
                return othersession
            }
        }

        return <LoginSession>null;
    }

    static async loadAsync(id: string): Promise<LoginSession> {
        let session = await LoginSession.loadCoreAsync(id);
        return session
    }

    public async setMigrationUserAsync(uid: string, multipleOK = false) {
        let ok = await tdliteUsers.setProfileIdFromLegacyAsync(uid, this.profileId, multipleOK);
        if (!ok) return false;
        this.userid = uid
        this.askLegacy = false
        return true
    }

    public fixupRedirectUrl(url: string) {
        if (this.oauthClientId == "webapp3") {
            // if the webapp supports this, use %23 instead of a second hash
            // otherwise sign-in on iOS/Chrome doesn't work
            url = url.replace(/#(.*)#/, (m, x) => "#" + x + "%23");
        }
        return url;
    }

    public async createUserIfNeededAsync(req: restify.Request): Promise<IUser> {
        if (this.userCreated()) {
            let js = await tdliteUsers.getAsync(this.userid);
            if (this.termsOk)
                js = await this.updateTermsVersionAsync(req, js)
            return js
        }

        let profile = this.federatedUserInfo;

        let username = core.fullTD ? profile.name : profile.name.replace(/\s.*/g, "");
        let realname = /^0x/.test(profile.name) ? "" : profile.name

        if (this.nickname) username = this.nickname;
        if (this.realname) realname = this.realname;

        logger.tick("PubUser@federated");
        let perms = ""
        if (core.fullTD)
            perms = "user";
        let userjs = await tdliteUsers.createNewUserAsync(username, profile.email, this.profileId, perms, realname, false);
        this.userid = userjs["id"];
        await this.saveAsync();

        userjs = await this.updateTermsVersionAsync(req, userjs)

        return userjs
    }

    public async updateTermsVersionAsync(req: restify.Request, userjs: IUser) {
        let ver = core.serviceSettings.termsversion || "default"
        if (userjs.termsversion != ver) {
            userjs = await tdliteUsers.updateAsync(this.userid, async (entry1) => {
                entry1.termsversion = ver;
            });
            await audit.logAsync(audit.buildAuditApiRequest(req), "user-agree", {
                userid: this.userid,
                subjectid: this.userid,
                data: ver,
                newvalue: userjs
            });
        }
        return userjs;
    }

    public async saveAsync() {
        await serverAuth.options().setData(this.state, JSON.stringify(this.toJson()));
    }

    public async saveAndRedirectAsync(req: restify.Request) {
        await this.saveAsync();
        req.response.redirect(302, core.self + "oauth/dialog?td_session=" + this.state)
    }

    private async generateRedirectUrlAsync(): Promise<string> {
        assert(this.userCreated())
        let clientId = this.oauthClientId;
        if (this.federatedUserInfo.redirectPrefix.startsWith("http://localhost:"))
            clientId = "no-cookie";
        let tok = await generateTokenAsync(this.userid, this.profileId, clientId);
        let redirectUrl = td.replaceAll(this.federatedUserInfo.redirectPrefix, "TOKEN", encodeURIComponent(tok.url)) + "&id=" + this.userid;
        if (tok.cookie != "") {
            redirectUrl = redirectUrl + "&td_cookie=" + tok.cookie;
        }
        return this.fixupRedirectUrl(redirectUrl);
    }

    public async accessTokenRedirectAsync(req: restify.Request) {
        let url = await this.generateRedirectUrlAsync();
        accessTokenRedirect(req, url);
    }
}

export interface ILoginSession {
    state: string;
    userid: string;
    redirectUri: string;
    groupid: string;
    passwords: string[];
    pass: string;
    ownerId: string;
    termsOk: boolean;
    codeOk: boolean;
}

function redirectToProviders(req: restify.Request) {
    let query = req.url().replace(/^[^\?]*/g, "");
    let url = req.serverUrl() + "/oauth/providers" + query;
    req.response.redirect(303, url);
}

export async function initAsync(): Promise<void> {
    initialApprovals = core.myChannel == "test";
    tokensTable = await core.tableClient.createTableIfNotExistsAsync("tokens");

    restify.server().get("/api/ready/:userid", async (req1: restify.Request, res1: restify.Response) => {
        core.handleHttps(req1, res1);
        let throttleKey = core.sha256(req1.remoteIp()) + ":ready";
        if (await core.throttleCoreAsync(throttleKey, 1)) {
            res1.sendError(httpCode._429TooManyRequests, "");
        }
        else {
            let uid = req1.param("userid");
            let entry2 = await tdliteUsers.getAsync(uid);
            if (entry2 == null) {
                if (await core.throttleCoreAsync(throttleKey, 100)) {
                    res1.sendError(httpCode._429TooManyRequests, "");
                }
                else {
                    res1.sendError(httpCode._404NotFound, "Missing");
                }
            }
            else if (core.orFalse(entry2["awaiting"])) {
                res1.json(({ "ready": false }));
            }
            else {
                res1.json(({ "ready": true }));
            }
        }
    });

    let jsb = {};
    let template_html = tdliteHtml.template_html
    jsb["activate"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.activate_html);
    jsb["kidcode"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.enterCode_html);
    jsb["kidornot"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.kidOrNot_html);
    jsb["newuser"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.newuser_html);
    jsb["newadult"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.newadult_html);
    jsb["agree"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.agree_html);
    jsb["usercreated"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.user_created_html);
    jsb["providers"] = td.replaceAll(template_html, "@BODY@", tdliteHtml.providers_html);
    loginHtml = td.clone(jsb);

    serverAuth.init({
        makeJwt: async (profile: serverAuth.UserInfo, oauthReq: serverAuth.OauthRequest) => {
            let url2 = await loginFederatedAsync(profile, oauthReq);
            return {
                "http redirect": url2
            }
        },
        getData: async (key: string) => {
            let value: string;
            value = await core.redisClient.getAsync("authsess:" + key);
            return value;
        },
        setData: async (key1: string, value1: string) => {
            let minutes = 30;
            await core.redisClient.setpxAsync("authsess:" + key1, value1, minutes * 60 * 1000);
        },
        federationMaster: orEmpty(td.serverSetting("AUTH_FEDERATION_MASTER", true)),
        federationTargets: orEmpty(td.serverSetting("AUTH_FEDERATION_TARGETS", true)),
        self: core.self.replace(/\/$/g, ""),
        isValidDomain: s =>
            s + "/" == core.self ||
            core.serviceSettings.domains.hasOwnProperty(s.replace(/^https:\/\//i, "").toLowerCase()),
        requestEmail: false,
        redirectOnError: "/#loginerror"
    });
    if (core.hasSetting("AZURE_AD_CLIENT_SECRET")) {
        serverAuth.addAzureAd();
    }
    if (core.hasSetting("LIVE_CLIENT_SECRET")) {
        serverAuth.addLiveId();
    }
    if (core.hasSetting("GOOGLE_CLIENT_SECRET")) {
        serverAuth.addGoogle();
    }
    if (core.hasSetting("FACEBOOK_CLIENT_SECRET")) {
        serverAuth.addFacebook();
    }
    if (core.hasSetting("YAHOO_CLIENT_SECRET")) {
        serverAuth.addYahoo();
    }
    if (core.hasSetting("GITHUB_CLIENT_SECRET")) {
        serverAuth.addGitHub();
    }

    restify.server().get("/user/logout", async (req: restify.Request, res: restify.Response) => {
        res.redirect(302, "/signout");
    });
    restify.server().get("/oauth/providers", async (req1: restify.Request, res1: restify.Response) => {
        serverAuth.validateOauthParameters(req1, res1);
        core.handleBasicAuth(req1, res1);
        if (!res1.finished()) {
            let lang2 = await tdlitePointers.handleLanguageAsync(req1);
            let html = await getLoginHtmlAsync("providers", lang2);
            for (let k of serverAuth.providerLinks(req1.query())) {
                html = td.replaceAll(html, "@" + k.id + "-url@", k.href);
            }
            res1.html(html);
        }
    });
    restify.server().get("/oauth/dialog", async (req: restify.Request, res: restify.Response) => {
        let session = await LoginSession.loadAsync(req.query()["td_session"]);
        if (!session) {
            session = new LoginSession();
            session.state = cachedStore.freshShortId(16);
        }
        if (session.userid == "") {
            serverAuth.validateOauthParameters(req, res);
        }
        core.handleBasicAuth(req, res);
        if (session.oauthHost && req.header("host") && req.header("host").toLowerCase() != session.oauthHost) {
            res.redirect(302, "https://" + session.oauthHost + req.url())
            return
        }
        await createKidUserWhenUsernamePresentAsync(req, session, res);
        if (!res.finished()) {
            let accessCode = orEmpty(req.query()["td_state"]);
            if (accessCode == "teacher") {
                redirectToProviders(req);
            }
            else if (accessCode == core.tokenSecret && session.userid != "") {
                // **this is to be used during initial setup of a new cloud deployment**
                await session.createUserIfNeededAsync(req);
                await tdliteUsers.updateAsync(session.userid, async (entry) => {
                    entry.credit = 1000;
                    entry.totalcredit = 1000;
                    entry.permissions = ",admin,";
                });
                await session.accessTokenRedirectAsync(req);
            }
            else {
                await loginHandleCodeAsync(accessCode, res, req, session);
            }
        }
    });
    restify.server().get("/oauth/gettoken", async (req3: restify.Request, res3: restify.Response) => {
        let s3 = req3.serverUrl() + "/oauth/login?state=foobar&response_type=token&client_id=no-cookie&redirect_uri=" + encodeURIComponent(req3.serverUrl() + "/oauth/gettokencallback") + "&u=" + encodeURIComponent(orEmpty(req3.query()["u"]));
        res3.redirect(303, s3);
    });
    restify.server().get("/oauth/gettokencallback", async (req4: restify.Request, res4: restify.Response) => {
        let _new = "<p>Your access token is below. Only paste in applications you absolutely trust.</p>\n<pre id=\"token\">\nloading...\n</pre>\n<p>You could have added <code>?u=xyzw</code> to get access token for a different user (given the right permissions).\n</p>\n<script>\nsetTimeout(function() {\nvar h = document.location.href.replace(/oauth\\/gettoken.*access_token/, \"?access_token\").replace(/&.*/, \"\");\ndocument.getElementById(\"token\").textContent = h;\n}, 100)\n</script>";
        res4.html(td.replaceAll(td.replaceAll(template_html, "@JS@", ""), "@BODY@", _new));
    });

    core.addRoute("POST", "*user", "logout", async (req: core.ApiRequest) => {
        if (!core.checkPermission(req, "root")) return;
        await logoutEverywhereAsync(req.rootId);
        req.response = {};
    })

    core.addRoute("POST", "logout", "", async (req3: core.ApiRequest) => {
        if (req3.userid != "") {
            if (core.orFalse(req3.body["everywhere"])) {
                await logoutEverywhereAsync(req3.userid);
            }
            else {
                await tokensTable.deleteEntityAsync(req3.userinfo.token.toJson());
                await core.redisClient.setpxAsync("tok:" + tokenString(req3.userinfo.token), "", 500);
            }
            req3.response = {};
            if (req3.userinfo.token.cookie) {
                let cookie = wrapAccessTokenCookie("logout").replace(/Dec 9999/g, "Dec 1971")
                cookie = patchUpAccessTokenCookie(req3.restifyReq, cookie)
                req3.headers = {
                    "Set-Cookie": cookie
                };
            }
        }
        else {
            req3.status = httpCode._401Unauthorized;
        }
    });

    core.addRoute("POST", "*user", "token", async (req7: core.ApiRequest) => {
        core.checkPermission(req7, "signin-" + req7.rootId);
        if (req7.status == 200) {
            let resp = {};
            let clientId = "webapp2";
            if (!req7.userinfo.token.cookie)
                clientId = "no-cookie";
            let tok = await generateTokenAsync(req7.rootId, "admin", clientId);
            if (tok.cookie) {
                if (req7.headers == null) {
                    req7.headers = {};
                }
                req7.headers["Set-Cookie"] = patchUpAccessTokenCookie(req7.restifyReq, wrapAccessTokenCookie(tok.cookie));
            }
            else {
                assert(clientId == "no-cookie", "no cookie in token");
            }
            await audit.logAsync(req7, "signin-as", {
                data: core.sha256(tok.url).substr(0, 10)
            });
            resp["token"] = tok.url;
            req7.response = td.clone(resp);
        }
    });
}

async function logoutEverywhereAsync(uid: string) {
    let entities = await tokensTable.createQuery().partitionKeyIs(uid).fetchAllAsync();
    await parallel.forAsync(entities.length, async (x: number) => {
        let json = entities[x];
        // TODO: filter out reason=admin?
        let token = core.Token.createFromJson(json);
        await tokensTable.deleteEntityAsync(token.toJson());
        await core.redisClient.setpxAsync("tok:" + tokenString(token), "", 500);
    });
}

async function generateTokenAsync(user: string, reason: string, client_id: string): Promise<tdliteUsers.IRedirectAndCookie> {
    let token = new core.Token();
    token.PartitionKey = user;
    token.RowKey = td.createRandomId(32);
    token.time = await core.nowSecondsAsync();
    token.reason = reason;
    token.version = 2;
    if (orEmpty(client_id) != "no-cookie") {
        token.cookie = td.createRandomId(32);
    }
    await tdliteUsers.updateAsync(user, async (entry) => {
        entry.lastlogin = await core.nowSecondsAsync();
    });
    await tokensTable.insertEntityAsync(token.toJson(), "or merge");
    return {
        url: tokenString(token),
        cookie: token.cookie
    }
}

export function tokenString(token: core.Token): string {
    let customToken: string;
    customToken = "0" + token.PartitionKey + "." + token.RowKey;
    return customToken;
}

function wrapAccessTokenCookie(cookie: string): string {
    let value = "TD_ACCESS_TOKEN2=" + cookie + "; ";
    if (core.hasHttps)
        value += "Secure; "
    value += "HttpOnly; Path=/; "
    if (!/localhost:/.test(core.self))
        value += "Domain=" + core.self.replace(/\/$/g, "").replace(/.*\//g, "").replace(/:\d+$/, "") + "; "
    value += "Expires=" + new Date(Date.now() + 365 * 24 * 3600 * 1000).toString();
    return value;
}

async function getRedirectUrlAsync(user2: string, req: restify.Request, session: LoginSession): Promise<string> {
    let url: string;
    let jsb = {};
    let tok = await generateTokenAsync(user2, "code", req.query()["client_id"]);
    jsb["access_token"] = tok.url;
    jsb["state"] = req.query()["state"];
    jsb["id"] = user2;
    if (tok.cookie != "") {
        jsb["td_cookie"] = tok.cookie;
    }
    url = req.query()["redirect_uri"] + "#" + serverAuth.toQueryString(td.clone(jsb));
    if (session) url = session.fixupRedirectUrl(url);
    return url;
}


async function loginFederatedAsync(profile: serverAuth.UserInfo, oauthReq: serverAuth.OauthRequest): Promise<string> {
    await core.refreshSettingsAsync();

    let coll = (/([^:]*):(.*)/.exec(profile.id) || []);
    let provider = coll[1];
    let providerUserId = coll[2];
    let profileId = "id/" + provider + "/" + core.encryptId(providerUserId, "SOCIAL0");
    logger.debug("profileid: " + profile.id + " enc " + profileId);
    let modernId = profileId;
    let upointer = await tdliteUsers.passcodesContainer.getAsync(profileId);
    // ## Legacy profiles
    if (1 > 1) {
        if (upointer == null) {
            let legacyId = "id/" + provider + "/" + core.sha256(providerUserId);
            let entry = await tdliteUsers.passcodesContainer.getAsync(legacyId);
            if (core.isGoodPub(entry, "userpointer") && await tdliteUsers.getAsync(entry["userid"]) != null) {
                upointer = entry;
                profileId = legacyId;
            }
        }
        if (upointer == null) {
            let legacyId1 = "id/" + provider + "/" + td.replaceAll(providerUserId, ":", "/");
            let entry1 = await tdliteUsers.passcodesContainer.getAsync(legacyId1);
            if (core.isGoodPub(entry1, "userpointer") && await tdliteUsers.getAsync(entry1["userid"]) != null) {
                upointer = entry1;
                profileId = legacyId1;
            }
        }
        // If we have a legacy pointer, update it
        if (modernId != profileId && upointer != null) {
            await tdliteUsers.passcodesContainer.updateAsync(modernId, async (entry3: JsonBuilder) => {
                td.jsonCopyFrom(entry3, upointer);
            });
        }
    }

    let userjs: IUser = null;
    if (core.isGoodPub(upointer, "userpointer")) {
        let entry31 = await tdliteUsers.getAsync(upointer["userid"]);
        if (entry31 != null) {
            userjs = entry31;
            let logins = (userjs.altLogins || []).concat([userjs.login])
            if (logins.indexOf(profileId) < 0) {
                userjs = await tdliteUsers.updateAsync(userjs.id, async (entry4) => {
                    if (!entry4.login)
                        entry4.login = profileId;
                    else {
                        if (!entry4.altLogins) entry4.altLogins = [];
                        entry4.altLogins.push(profileId)
                    }
                });
            }
        }
    }

    let clientOAuth = serverAuth.ClientOauth.createFromJson(oauthReq._client_oauth);
    let session = new LoginSession();
    session.federatedUserInfo = <any>profile.toJson();
    session.profileId = profileId;
    session.providerId = provider;
    let m = /^https:\/\/([^/]+)/.exec(clientOAuth.redirect_uri)
    session.oauthHost = m ? m[1].toLowerCase() : core.myHost
    session.oauthClientId = clientOAuth.client_id;
    session.oauthU = clientOAuth.u;
    session.restartQuery = clientOAuth.toQueryString();

    if (userjs == null) {
        if (core.jsonArrayIndexOf(core.serviceSettings.blockedAuth, provider) >= 0) {
            // New accounts blocked for now.
            return "/";
        }
        userjs = <any>{ id: "pending" }
    }
    else {
        logger.tick("Login@federated");
        let uidOverride = withDefault(clientOAuth.u, userjs["id"]);
        if (/^[a-z]+$/.test(uidOverride) && uidOverride != userjs["id"]) {
            logger.info("login with override: " + userjs["id"] + "->" + uidOverride);
            if (core.hasPermission(userjs, "signin-" + uidOverride)) {
                let entry41 = await tdliteUsers.getAsync(uidOverride);
                if (entry41 != null) {
                    logger.debug("login with override OK: " + userjs["id"] + "->" + uidOverride);
                    userjs = entry41;
                }
            }
        }
    }

    session.state = cachedStore.freshShortId(16);
    session.userid = userjs["id"];

    if (session.userCreated()) {
        let linkedSession = await session.getLinkedSessionAsync();
        if (linkedSession && linkedSession.profileId) {
            let last = await tdliteUsers.passcodesContainer.updateAsync(linkedSession.profileId, async (v) => {
                let kind = v["kind"]
                if (!kind || kind == "reserved" || kind == "userpointer") {
                    v["kind"] = "userpointer";
                    let existing = await tdliteUsers.getAsync(v["userid"])
                    if (!existing)
                        v["userid"] = session.userid;
                }
            })
            if (last["userid"] == session.userid)
                await tdliteUsers.updateAsync(session.userid, async (v) => {
                    if (!v.altLogins) v.altLogins = [];
                    v.altLogins.push(linkedSession.profileId);
                })
        }
    }

    if (core.pxt) {
        session.termsOk = orEmpty(userjs["termsversion"]) == core.serviceSettings.termsversion;
        session.codeOk = true;
        session.legacyCodes = {};
    } else if (core.fullTD) {
        session.termsOk = true;
        session.codeOk = true;
        session.legacyCodes = null;
        if (!session.userCreated())
            session.askLegacy = true;
    } else {
        session.termsOk = orEmpty(userjs["termsversion"]) == core.serviceSettings.termsversion;
        session.codeOk = orEmpty(userjs["permissions"]) != "";
        session.legacyCodes = {};

    }

    await session.saveAsync();
    return "/oauth/dialog?td_session=" + encodeURIComponent(session.state);
}

function patchUpAccessTokenCookie(req: restify.Request, cookie: string) {
    let host = req.header("host")
    if (host && host.toLowerCase() != core.myHost) {
        cookie = cookie.replace("Domain=" + core.myHost, "Domain=" + host.toLowerCase())
    }
    return cookie
}

function setAccessTokenCookie(req: restify.Request, cookie: string) {
    if (!cookie) return
    req.response.setHeader("Set-Cookie", patchUpAccessTokenCookie(req, cookie));
}

async function createKidUserWhenUsernamePresentAsync(req: restify.Request, session: LoginSession, res: restify.Response): Promise<void> {
    let tdUsername = req.query()["td_username"];
    // TODO multi-host cookie support
    if (!res.finished() && session.groupid != "" && orEmpty(tdUsername) != "") {
        let groupJson = await core.getPubAsync(session.groupid, "group");
        session.pass = session.passwords[core.orZero(req.query()["td_password"])];
        if (session.pass == null) {
            session.pass = session.passwords[0];
        }
        // this can go negative; maybe we should reject it in this case?
        await tdliteUsers.updateAsync(session.ownerId, async (entry) => {
            entry.credit -= 1;
        });
        logger.tick("PubUser@code");
        let jsb = await tdliteUsers.createNewUserAsync(tdUsername, "", core.normalizeAndHash(session.pass), ",student,", "", initialApprovals);
        let user2 = jsb["id"];

        await audit.logAsync(audit.buildAuditApiRequest(req), "user-create-code", {
            userid: session.ownerId,
            subjectid: user2,
            publicationid: session.groupid,
            publicationkind: "group",
            newvalue: td.clone(jsb)
        });
        if (initialApprovals) {
            await tdliteGroups.addGroupApprovalAsync(groupJson, jsb);
        }
        else {
            await tdliteGroups.addUserToGroupAsync(user2, groupJson, (<core.ApiRequest>null));
        }
        let redirectUri = await getRedirectUrlAsync(user2, req, session);
        await session.saveAsync();

        let tok = stripCookie(redirectUri);
        setAccessTokenCookie(req, tok.cookie)
        let lang = await tdlitePointers.handleLanguageAsync(req);
        let html = td.replaceAll(await getLoginHtmlAsync("usercreated", lang), "@URL@", tok.url);
        html = td.replaceAll(html, "@USERID@", session.userid);
        html = td.replaceAll(html, "@PASSWORD@", session.pass);
        html = td.replaceAll(html, "@NAME@", core.htmlQuote(tdUsername));
        core.setHtmlHeaders(req);
        res.html(html);
    }
}

async function loginHandleCodeAsync(accessCode: string, res: restify.Response, req: restify.Request, session: LoginSession): Promise<void> {
    let passId = core.normalizeAndHash(accessCode);
    let lang = await tdlitePointers.handleLanguageAsync(req);
    let msg = "";
    if (passId == "" || accessCode == "kid") {
    }
    else {
        if (await core.throttleCoreAsync(core.sha256(req.remoteIp()) + ":code", 10)) {
            // TODO this should be some nice page
            res.sendError(httpCode._429TooManyRequests, "Too many login attempts");
            return;
        }
        let codeObj = await tdliteUsers.passcodesContainer.getAsync(passId);
        if (codeObj == null || codeObj["kind"] == "reserved") {
            msg = core.translateMessage("Whoops! The code doesn't seem right. Keep trying!", lang);
        }
        else {
            let kind = codeObj["kind"];
            if (kind == "userpointer") {
                let userJson = await tdliteUsers.getAsync(codeObj["userid"]);
                if (session.userid != "") {
                    msg = core.translateMessage("We need an activation code here, not user password.", lang);
                }
                else if (userJson == null) {
                    msg = core.translateMessage("The user account doesn't exist anymore.", lang);
                }
                else {
                    logger.tick("Login@code");
                    accessTokenRedirect(req, await getRedirectUrlAsync(userJson["id"], req, session));
                }
            }
            else if (kind == "activationcode") {
                if (session.userid == "") {
                    // The code shouldn't be entered here, let's save it for future.
                    let query = req.url().replace(/^[^\?]*/g, "");
                    let url = req.serverUrl() + "/oauth/dialog" + td.replaceAll(query, "&td_state=", "&validated_code=");
                    res.redirect(303, url);
                }
                else if (codeObj["credit"] <= 0) {
                    msg = core.translateMessage("This code has already been used.", lang);
                }
                else {
                    let userjson = await session.createUserIfNeededAsync(req);
                    await tdliteUsers.applyCodeAsync(userjson, codeObj, passId, audit.buildAuditApiRequest(req));
                    await session.accessTokenRedirectAsync(req);
                }
            }
            else if (kind == "groupinvitation") {
                let groupJson = await core.getPubAsync(codeObj["groupid"], "group");
                if (session.userid != "") {
                    msg = core.translateMessage("We need an activation code here, not group code.", lang);
                }
                else if (groupJson == null) {
                    msg = "Group gone?";
                }
                else {
                    session.ownerId = groupJson["pub"]["userid"];
                    let groupOwner = await tdliteUsers.getAsync(session.ownerId);
                    if (core.orZero(groupOwner["credit"]) <= 0) {
                        msg = core.translateMessage("Group owner is out of activation credits.", lang);
                    }
                    else {
                        session.groupid = groupJson["id"];
                        session.passwords = td.range(0, 10).map<string>(elt => wordPassword.generate());
                        await session.saveAsync();
                    }
                }
            }
            else {
                msg = core.translateMessage("This code cannot be entered here. Sorry.", lang);
            }
        }
    }

    if (!res.finished()) {
        await core.refreshSettingsAsync();
        let params = {
            //LANG: core.normalizeLang(lang),
        };
        let inner = "kidornot";
        if (accessCode == "kid") {
            inner = "kidcode";
        }
        if (session.passwords != null) {
            let links = "";
            for (let i = 0; i < session.passwords.length; i++) {
                links = links + "<button type=\"button\" class=\"button provider\" href=\"#\" onclick=\"passwordok(" + i + ")\">" + session.passwords[i] + "</button><br/>\n";
            }
            let lang2 = await tdlitePointers.handleLanguageAsync(req);
            inner = td.replaceAll(td.replaceAll(await getLoginHtmlAsync("newuser", lang2), "@PASSWORDS@", links), "@SESSION@", session.state);
            core.setHtmlHeaders(req);
            res.html(td.replaceAll(inner, "@MSG@", msg));
            return;
        }
        else if (session.userid != "") {
            let termsversion = orEmpty(req.query()["td_agree"]);
            if (termsversion == "noway") {
                await serverAuth.options().setData(session.state, "{}");
                // this should never be true now
                if (false && session.userCreated()) {
                    let delEntry = await tdliteUsers.getAsync(session.userid);
                    if (delEntry != null && !delEntry["termsversion"] && !delEntry["permissions"]) {
                        let delok = await core.deleteAsync(delEntry);
                        await core.pubsContainer.updateAsync(session.userid, async (entry: JsonBuilder) => {
                            entry["settings"] = {};
                            entry["pub"] = {};
                            entry["login"] = "";
                            entry["permissions"] = "";
                        });
                    }
                }
                res.redirect(302, "/");
                return;
            }
            if (!session.termsOk && termsversion == core.serviceSettings.termsversion) {
                session.termsOk = true;
                await session.saveAsync();
            }
            let username = orEmpty(req.query()["td_username"]).slice(0, 25);
            if (!session.nickname && username) {
                let nick = username.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
                if (new RegExp(core.serviceSettings.blockedNicknameRx).test(nick)) {
                    msg = core.translateMessage("This nickname is not allowed.", lang);
                } else {
                    session.nickname = username;
                    let realname = (req.query()["td_realname"] || "").slice(0, 60)
                    if (realname)
                        session.realname = realname
                    await session.saveAsync();
                }
            }


            if (!session.termsOk) {
                inner = "agree";
            }
            else if (!core.fullTD && !session.userCreated() && !session.nickname) {
                inner = "newadult";
                params["EXAMPLES"] = "";
                params["SESSION"] = session.state;
                if (!session.federatedUserInfo.name || /^0x/.test(session.federatedUserInfo.name))
                    params["REALNAMESTYLE"] = "display:block";
                else
                    params["REALNAMESTYLE"] = "display:none";
                let uentry = await tdliteUsers.getAsync(session.userid);
                if (uentry) {
                    let nm = uentry["pub"].name
                    params["EXAMPLES"] = ["Ms" + nm, "Mr" + nm, nm + td.randomRange(10, 99)].join(", ");
                }
            }
            else if (!session.codeOk) {
                inner = "activate";
            }
            else {
                await tdliteLegacy.handleLegacyAsync(req, session, params);
                if (session.askLegacy) {
                    inner = params["INNER"];
                } else {
                    await session.createUserIfNeededAsync(req);
                    await session.accessTokenRedirectAsync(req);
                }
            }
        }

        if (!res.finished()) {
            if (kidsDisabled && inner == "kidornot") {
                redirectToProviders(req);
                return;
            }

            let agreeurl = "/oauth/dialog?td_session=" + encodeURIComponent(session.state) + "&td_agree=" + encodeURIComponent(core.serviceSettings.termsversion);
            let disagreeurl = "/oauth/dialog?td_session=" + encodeURIComponent(session.state) + "&td_agree=noway";
            params["MSG"] = msg;
            params["AGREEURL"] = agreeurl;
            params["DISAGREEURL"] = disagreeurl;
            params["USERNAME"] = session.federatedUserInfo.name;
            let ht = await getLoginHtmlAsync(inner, lang)
            ht = ht.replace(/@(\w+)@/g, (m, n) => params.hasOwnProperty(n) ? params[n] : m)
            res.html(ht);
        }
    }
}

async function getLoginHtmlAsync(inner: string, lang: string[]): Promise<string> {
    let text = await tdlitePointers.simplePointerCacheAsync("signin/" + inner, lang);
    if (text.length < 100) {
        text = loginHtml[inner];
    }
    if (!text) {
        text = "signin/" + inner + " is missing"
    }
    text = td.replaceAll(text, "@JS@", tdliteHtml.login_js);
    return text;
}


function accessTokenRedirect(req: restify.Request, url2: string): void {
    let res = req.response
    let tok = stripCookie(url2);
    setAccessTokenCookie(req, tok.cookie)
    res.redirect(303, tok.url);
}

function stripCookie(url2: string): tdliteUsers.IRedirectAndCookie {
    let cook: string;
    let coll = (/&td_cookie=([\w.]+)$/.exec(url2) || []);
    let cookie = coll[1];
    cook = "";
    if (cookie != null) {
        url2 = url2.substr(0, url2.length - coll[0].length);
        cook = wrapAccessTokenCookie(cookie);
    }
    return {
        url: url2,
        cookie: cook
    }
}

export async function lookupTokenAsync(token: string): Promise<core.Token> {
    let tokenJs: {} = null;
    if (td.startsWith(token, "0") && token.length < 100) {
        let value = await core.redisClient.getAsync("tok:" + token);
        if (value == null || value == "") {
            let coll = (/^0([a-z]+)\.([A-Za-z]+)$/.exec(token) || []);
            if (coll.length > 1) {
                tokenJs = await tokensTable.getEntityAsync(coll[1], coll[2]);
                if (tokenJs != null) {
                    await core.redisClient.setpxAsync("tok:" + token, JSON.stringify(tokenJs), 1000 * 1000);
                }
            }
        }
        else {
            tokenJs = JSON.parse(value);
        }
    }

    if (tokenJs) {
        return core.Token.createFromJson(tokenJs);
    } else {
        return <core.Token>null;
    }
}

// Don't set the 401 code on token expired/cookie missing.
// If it's anonymous request it will suceeded, otherwise checkPermission() will set code to 401 anyways.
var softTokenFailure = true;

export async function validateTokenAsync(req: core.ApiRequest, rreq: restify.Request): Promise<void> {
    if (req.isCached) {
        return;
    }
    let token = withDefault(rreq.header("x-td-access-token"), td.toString(req.queryOptions["access_token"]));
    if (token != null && token != "null" && token != "undefined") {
        if (token.length > 100) {
            // this is to prompt migration client-side
            req.status = 442;
            return;
        }

        let token2 = await lookupTokenAsync(token);

        if (token2 == null) {
            if (!softTokenFailure)
                req.status = httpCode._401Unauthorized;
            return
        } else {
            if (core.orZero(token2.version) < 2) {
                req.status = httpCode._401Unauthorized;
                return;
            }
            if (orEmpty(token2.cookie) != "") {
                let ok = td.stringContains(orEmpty(rreq.header("cookie")), "TD_ACCESS_TOKEN2=" + token2.cookie);
                if (!ok) {
                    if (!softTokenFailure)
                        req.status = httpCode._401Unauthorized;
                    logger.info("cookie missing, user=" + token2.PartitionKey);
                    return;
                }
                let r = orEmpty(rreq.header("referer"));
                if (core.pxt || td.startsWith(r, "http://localhost:") || td.startsWith(r, core.self + "app/") || td.startsWith(r, core.self + "userapp/")) {
                }
                else {
                    req.status = httpCode._401Unauthorized;
                    logger.info("bad referer: " + r + ", user = " + token2.PartitionKey);
                    return;
                }
                // minimum token expiration - 5min
                if (orEmpty(token2.reason) != "code" && core.orZero(core.serviceSettings.tokenExpiration) > 300 && await core.nowSecondsAsync() - token2.time > core.serviceSettings.tokenExpiration) {
                    // Token expired.
                    if (!softTokenFailure)
                        req.status = httpCode._401Unauthorized;
                    return;
                }
            }
            let uid = token2.PartitionKey;
            await core.setReqUserIdAsync(req, uid);
            if (req.status == 200 && core.orFalse(req.userinfo.json["awaiting"])) {
                req.status = httpCode._418ImATeapot;
            }
            if (req.status == 200) {
                req.userinfo.token = token2;
                req.userinfo.ip = rreq.remoteIp();
                let uid2 = orEmpty(req.queryOptions["userid"]);
                if (uid2 != "" && core.hasPermission(req.userinfo.json, "root")) {
                    await core.setReqUserIdAsync(req, uid2);
                }
            }
        }
    }
}

