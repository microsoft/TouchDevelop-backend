/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as querystring from 'querystring';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as restify from "./restify"

export type MakeUrlCallback = (req: restify.Request, p: OauthRequest) => Promise<string>;
export type MakeUserInfo = (profile: JsonObject) => Promise<UserInfo>;
export type GetProfile = (req1: restify.Request, p1: OauthRequest) => Promise<JsonObject>;
export type MakeJwt = (profile1: UserInfo, oauthReq: OauthRequest) => Promise<JsonBuilder>;
export type GetData = (key: string) => Promise<string>;
export type SetData = (key1: string, value: string) => Promise<void>;
export type PreDialog = (req2: restify.Request, res: restify.Response) => Promise<void>;
export type GetProviderTemplate = () => Promise<string>;
export type ErrorCallback = (res1: restify.Response, msg: string) => Promise<void>;

var logger: td.AppLogger;
var tokenSecret: string = "";
var debug: boolean = false;
var globalOptions: IInitOptions;
var fedTargets: string[];
var myHost: string = "";

var azureKey: string = 
`-----BEGIN RSA PUBLIC KEY-----
MIIBCgKCAQEAvIqz+4+ER/vNWLON9yv8hIYV737JQ6rCl6XfzOC628seYUPf0TaG
k91CFxefhzh23V9Tkq+RtwN1Vs/z57hO82kkzL+cQHZX3bMJD+GEGOKXCEXURN7V
MyZWMAuzQoW9vFb1k3cR1RW/EW/P+C8bb2dCGXhBYqPfHyimvz2WarXhntPSbM5X
yS5v5yCw5T/Vuwqqsio3V8wooWGMpp61y12NhN8bNVDQAkDPNu2DT9DXB1g0CeFI
Np/KAS/qQ2Kq6TSvRHJqxRR68RezYtje9KAqwqx4jxlmVAQy0T3+T+IAbsk1wRtW
DndhO6s1Os+dck5TzyZ/dNOhfXgelixLUQIDAQAB
-----END RSA PUBLIC KEY-----`;

var chooseProvider_html: string = 
`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=320.1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>Sign in</title>
<style>
a.provider {
   padding: 1em;
   text-decoration: none;
   color: white;
   background: #2986E0;
   width: 12em;
   display: block;
   margin: 0 auto;
   font-size: 1.2em;
}
</style>
<body id='root' style='font-size:16px; font-family:sans-serif;'>
<div style='margin: 0 auto; width: 310px;  text-align: center;'>
<h1 style='font-size:3em; font-weight:normal;'>Sign in</h1>
@BODY@
</div>
</body>
</html>`;


export class ClientOauth
    extends td.JsonRecord
{
    @td.json public state: string = "";
    @td.json public client_id: string = "";
    @td.json public redirect_uri: string = "";
    @td.json public scope: string = "";
    @td.json public response_type: string = "";
    @td.json public display: string = "";
    @td.json public provider: string = "";
    @td.json public td_state: string = "";
    @td.json public u: string = "";
    static createFromJson(o: JsonObject) { let r = new ClientOauth(); r.fromJson(o); return r; }
    
    public toQueryString()
    {
        return toQueryString({
            state: this.state,
            client_id: this.client_id,
            redirect_uri: this.redirect_uri,
            response_type: this.response_type,
        })
    }
}

export class UserInfo
    extends td.JsonRecord
{
    @td.json public id: string = "";
    @td.json public name: string = "";
    @td.json public email: string = "";
    @td.json public realname: string = "";
    @td.json public redirectPrefix: string = "";
    @td.json public state: string = "";
    @td.json public userData: string = "";
    static createFromJson(o:JsonObject) { let r = new UserInfo(); r.fromJson(o); return r; }
}

export class OauthRequest
    extends td.JsonRecord
{
    @td.json public state: string = "";
    @td.json public client_id: string = "";
    @td.json public redirect_uri: string = "";
    @td.json public scope: string = "";
    @td.json public response_type: string = "";
    @td.json public display: string = "";
    @td.json public access_token: string = "";
    @td.json public nonce: string = "";
    @td.json public response_mode: string = "";
    @td.json public _provider: string = "";
    @td.json public _client_oauth: JsonObject;
    @td.json public _info: JsonObject;
    static createFromJson(o:JsonObject) { let r = new OauthRequest(); r.fromJson(o); return r; }

    public async getAccessCodeAsync(code_: string, clientSecret: string, url: string) : Promise<JsonObject>
    {
        let js: JsonObject;
        let tokenReq = new TokenReq();
        tokenReq.fromJson(this.toJson());
        tokenReq.code = code_;
        tokenReq.grant_type = "authorization_code";
        tokenReq.client_secret = clientSecret;
        // And now send the request
        let grant = td.createRequest(url);
        grant.setMethod("post");
        grant.setContent(toQueryString(tokenReq.toJson()));
        grant.setHeader("Content-type", "application/x-www-form-urlencoded");
        let response = await grant.sendAsync();
        logger.debug("auth response: " + response.statusCode() + " -> " + response.content());
        if (td.startsWith(response.content(), "{")) {
            js = response.contentAsJson();
        }
        else {
            js = fromQueryString(response.content());
        }
        if (js != null && ! js["access_token"] && ! js["id_token"]) {
            js = (<JsonObject>null);
        }
        return js;
    }

    public makeRedirectUrl(token: string) : string
    {
        let url: string;
        let hash = {};
        let clientOauth2 = ClientOauth.createFromJson(this._client_oauth);
        hash["access_token"] = token;
        hash["state"] = clientOauth2.state;
        url = clientOauth2.redirect_uri + "#" + toQueryString(td.clone(hash));
        return url;
    }

}

export interface IOauthRequest {
    state?: string;
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    response_type?: string;
    display?: string;
    access_token?: string;
    nonce?: string;
    response_mode?: string;
    _provider?: string;
    _client_oauth?: ClientOauth;
    _info?: UserInfo;
}

export class TokenReq
    extends td.JsonRecord
{
    @td.json public client_id: string = "";
    @td.json public redirect_uri: string = "";
    @td.json public code: string = "";
    @td.json public client_secret: string = "";
    @td.json public grant_type: string = "";
    static createFromJson(o:JsonObject) { let r = new TokenReq(); r.fromJson(o); return r; }
}

export interface ITokenReq {
    client_id?: string;
    redirect_uri?: string;
    code?: string;
    client_secret?: string;
    grant_type?: string;
}

export class ProviderIndex
{
    public id: string = "";
    public makeLoginUrl: MakeUrlCallback;
    public getProfile: GetProfile;
    public makeCustomToken: MakeUserInfo;
    public name: string = "";
    public order: number = 0;
    public shortname: string;

    static _providers:td.SMap<ProviderIndex> = {};
    static at(n:string)
    {
        if (!ProviderIndex._providers.hasOwnProperty(n)) {
            ProviderIndex._providers[n] = new ProviderIndex();
            ProviderIndex._providers[n].id = n;
        }
        return ProviderIndex._providers[n]
    }

    static all():ProviderIndex[]
    {
        var pp = ProviderIndex._providers
        return Object.keys(pp).map(k => pp[k]).filter(pi => !!pi.makeLoginUrl)
    }

    public setupProvider(makeUrl: MakeUrlCallback, getProfile: GetProfile, defaultCustomToken: MakeUserInfo) : void
    {
        logger.info("adding provider: " + this.id);
        this.makeLoginUrl = makeUrl;
        this.getProfile = getProfile;
        this.shortname = this.id;
        if (this.makeCustomToken == null) {
            this.makeCustomToken = async (profile: JsonObject) => {
                let inf = await defaultCustomToken(profile);
                if (inf != null && ! inf.id) {
                    inf = (<UserInfo>null);
                }
                if (inf != null) {
                    if (! inf.name) {
                        // isn't this brilliant?!
                        inf.name = "0x" + td.sha256(new Buffer(inf.id, "utf8")).substr(0, 8);
                    }
                    if (inf.email == null || ! td.stringContains(inf.email, "@")) {
                        inf.email = "";
                    }
                }
                return inf;
            }
            ;
        }
        this.order = ProviderIndex.length;
    }

}

export interface IProviderOptions {
    makeCustomToken?: MakeUserInfo;
}

export interface IClientOauth {
    state?: string;
    client_id?: string;
    redirect_uri?: string;
    scope?: string;
    response_type?: string;
    display?: string;
    provider?: string;
    td_state?: string;
    u?: string;
}

export interface IInitOptions {
    preDialog?: PreDialog;
    makeJwt?: MakeJwt;
    getData?: GetData;
    setData?: SetData;
    federationMaster?: string;
    federationTargets?: string;
    self?: string;
    requestEmail?: boolean;
    errorCallback?: ErrorCallback;
    redirectOnError?: string;
}

export interface IUserInfo {
    id: string;
    name?: string;
    email?: string;
    redirectPrefix: string;
    state?: string;
    userData?: string;
}


export function init(options_: IInitOptions = {}) : void
{
    globalOptions = options_;
    if (globalOptions.errorCallback == null) {
        globalOptions.errorCallback = async (res: restify.Response, msg: string) => {
            if (!globalOptions.redirectOnError) {
                res.sendError(403, msg);
            }
            else {
                res.redirect(302, globalOptions.redirectOnError);
            }
        }
    }
    if (globalOptions.makeJwt == null) {
        globalOptions.makeJwt = async (profile: UserInfo, oauthReq: OauthRequest) => {
            let jwt: JsonBuilder;
            jwt = {};
            jwt["sub"] = profile.id;
            return jwt;
        }
    }
    logger = td.createLogger("serverauth");
    if (globalOptions.getData == null) {
        logger.info("using in-memory (single instance) storage");
        let d = {}
        globalOptions.getData = key => d[key];
        globalOptions.setData = async (key1: string, value: string) => {
            d[key1] = value;
        }
    }
    if (globalOptions.preDialog == null) {
        globalOptions.preDialog = async (req: restify.Request, res1: restify.Response) => {
            // Do nothing.
        }
    }
    if (globalOptions.federationTargets) {
        fedTargets = globalOptions.federationTargets.split(",");
    }
    else {
        fedTargets = (<string[]>[]);
    }
    tokenSecret = td.serverSetting("TOKEN_SECRET", false);
    initRestify();
    logger.info("Started");
}

export function toQueryString(params: JsonObject) : string
{
    let query: string;
    query = "";
    for (let k of Object.keys(params)) {
        let text = params[k];
        if (orEmpty(text) != "" && ! td.startsWith(k, "_")) {
            if (query != "") {
                query = query + "&";
            }
            query = query + encodeURIComponent(k) + "=" + encodeURIComponent(text);
        }
    }
    return query;
}

function initRestify() : void
{
    let server = restify.server();
    server.get("/oauth/login", async (req: restify.Request, res: restify.Response) => {
        setSelf(req);
        await oauthLoginAsync(req, res);
    });
    server.post("/oauth/callback", async (req1: restify.Request, res1: restify.Response) => {
        let query = fromQueryString(req1.body());
        req1.handle.body = query;
        let state = orEmpty(query["state"]);
        logger.debug("POST at callback: " + JSON.stringify(req1.bodyAsJson()));
        await handleResponseAsync(state, req1, res1);
    });
    server.get("/oauth/callback", async (req2: restify.Request, res2: restify.Response) => {
        logger.debug("GET at callback: " + JSON.stringify(req2.query()));
        await handleResponseAsync(req2.query()["state"], req2, res2);
    });
    if (debug) {
        server.get("/oauth/testlogin", async (req3: restify.Request, res3: restify.Response) => {
            let s3 = req3.serverUrl() + "/oauth/login?state=foobar&response_type=token&redirect_uri=" + encodeURIComponent(req3.serverUrl() + "/oauth/testcallback");
            res3.redirect(303, s3);
        });
        server.get("/oauth/testcallback", async (req4: restify.Request, res4: restify.Response) => {
            let tok = decodeToken(req4.query()["access_token"]);
            if (tok == null) {
                let _new = "<script>\nvar h = document.location.href\nvar h2 = h.replace(/#/, \"?\")\nif (h != h2) \n  document.location = h2\n</script>";
                res4.html(td.replaceAll(chooseProvider_html, "@BODY@", _new));
            }
            else {
                res4.json(tok);
            }
        });
    }
}

var orEmpty = td.orEmpty;

/**
 * Setup Azure Active Directory (Office 365 or Corporate) authentication provider. Requires ``AZURE_AD_CLIENT_ID`` env.
 * This relies on `art->azure key` being valid and used, but doesn't require client secret (which expires every 2 years).
 */
export function addAzureAdClientOnly(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("AZURE_AD_CLIENT_ID", false);
    let prov = ProviderIndex.at("azureadcl");
    prov.name = "Office 365 or Corporate";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        p.response_type = "id_token";
        p.scope = "openid";
        p.nonce = td.createRandomId(12);
        p.response_mode = "form_post";
        url = "https://login.windows.net/common/oauth2/authorize?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;        
        let payload = decodeJwtVerify(req1.bodyAsJson()["id_token"], "RS256", azureKey);
        if (payload["nonce"] == p1.nonce) {
            profile = payload;
        }
        else {
            profile = (<JsonObject>null);
        }
        return profile;
    }
    , async (profile1: JsonObject) => {
        let info: UserInfo;
        info = new UserInfo();
        info.id = "ad:" + td.replaceAll(profile1["oid"], "-", "").toLowerCase();
        info.name = profile1["name"];
        info.email = profile1["unique_name"];
        return info;
    });
    prov.shortname = "ad";
}

function fromQueryString(body: string) : JsonObject
{
    return querystring.parse(body)
}

function setIfEmpty(jsb: JsonBuilder, key: string, value: string) : void
{
    if (! jsb[key]) {
        jsb[key] = value;
    }
}

function now() : number
{
    let value: number;
    value = Math.round(new Date().getTime() / 1000);
    return value;
}

async function handleResponseAsync(state: string, req: restify.Request, res: restify.Response) : Promise<void>
{
    setSelf(req);
    if (td.stringContains(state, ",")) {
        let stateWords = state.split(",");
        if (fedTargets.indexOf(stateWords[0]) >= 0) {
            res.redirect(307, "https://" + stateWords[0] + req.url().replace(/state=[^&]+/g, "state=" + encodeURIComponent(stateWords[1])));
        }
        else if (td.startsWith(stateWords[0], "localhost:")) {
            res.redirect(307, "http://" + stateWords[0] + req.url().replace(/state=[^&]+/g, "state=" + encodeURIComponent(stateWords[1])));
        }
        else {
            res.sendError(403, "invalid fed target");
        }
        return;
    }
    let s = orEmpty(await globalOptions.getData(state));
    if (s == "") {
        res.sendError(404, "Wrong state");
    }
    else {
        let oauthRequest = OauthRequest.createFromJson(JSON.parse(s));
        let prov = ProviderIndex.at(oauthRequest._provider);
        let profile = await prov.getProfile(req, oauthRequest);
        if (profile == null) {
            await globalOptions.errorCallback(res, "Cannot get profile.");
        }
        else {
            logger.debug("profile: " + JSON.stringify(profile));
            let info = await prov.makeCustomToken(profile);
            if (info == null) {
                await globalOptions.errorCallback(res, "Profile not accepted");
            }
            else {
                logger.debug("user info: " + JSON.stringify(info.toJson()));
                info.redirectPrefix = oauthRequest.makeRedirectUrl("TOKEN");
                info.state = state;
                let jsb = await globalOptions.makeJwt(info, oauthRequest);
                if (jsb == null) {
                    res.sendError(403, "User info not accepted");
                }
                else {
                    let token = "";
                    if (typeof jsb == "string") {
                        oauthRequest._info = info.toJson();
                        await globalOptions.setData(state, JSON.stringify(oauthRequest.toJson()));
                        res.redirect(303, td.toString(jsb));
                    }
                    else if (jsb.hasOwnProperty("http redirect")) {
                        oauthRequest._info = info.toJson();
                        await globalOptions.setData(state, JSON.stringify(oauthRequest.toJson()));
                        let hds = jsb["headers"];
                        if (hds != null) {
                            for (let hd of Object.keys(hds)) {
                                res.setHeader(hd, hds[hd]);
                            }
                        }
                        res.redirect(303, jsb["http redirect"]);
                    }
                    else {
                        setIfEmpty(jsb, "iss", globalOptions.self);
                        setIfEmpty(jsb, "jti", td.createRandomId(10));
                        if (jsb["iat"] == null) {
                            jsb["iat"] = now();
                        }
                        // TODO token = nodeJwtSimple.encode(td.clone(jsb), tokenSecret, "HS256");
                        res.redirect(303, oauthRequest.makeRedirectUrl(token));
                    }
                }
            }
        }
    }
}

/**
 * Setup Live Connect / Microsoft Account authentication. Requires ``LIVE_CLIENT_ID`` and ``LIVE_CLIENT_SECRET`` env.
 */
export function addLiveId(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("LIVE_CLIENT_ID", false);
    let clientSecret = td.serverSetting("LIVE_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("liveid");
    prov.name = "Microsoft Account";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        if (globalOptions.requestEmail) {
            p.scope = "wl.signin wl.emails";
        }
        else {
            p.scope = "wl.signin";
        }
        p.response_type = "code";
        url = "https://login.live.com/oauth20_authorize.srf?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://login.live.com/oauth20_token.srf");
        if (js == null) {
            return js;
        }
        let request = td.createRequest("https://apis.live.net/v5.0/me?access_token=" + encodeURIComponent(js["access_token"]));
        let response = await request.sendAsync();
        profile = response.contentAsJson();
        return profile;
    }
    , async (profile1: JsonObject) => {
        let info: UserInfo;
        let inf = new UserInfo();
        if (!profile1["id"]) return <UserInfo>null;
        inf.id = "live:" + profile1["id"];
        inf.name = profile1["name"];
        let eml = profile1["emails"];
        if (eml != null) {
            inf.email = orEmpty(eml["preferred"]);
            if (inf.email == "") {
                inf.email = eml["account"];
            }
        }
        return inf;
        return info;
    });
    prov.shortname = "live";
}

/**
 * Decode JWT token
 */
function decodeToken(token: string) : JsonObject
{
    let tok: JsonObject;
    if (token == null || ! /.+\..+\./.test(token)) {
        tok = (<JsonObject>null);
    }
    else {
        // TODO tok = nodeJwtSimple.decode(token, tokenSecret);
    }
    return tok;
}

function example_init() : void
{
    debug = true;
    if (debug) {
        setupRestifyServer();
        // 
        init({
            makeJwt: async (profile: UserInfo, oauthReq: OauthRequest) => {
                let jwt: JsonBuilder;
                jwt = {};
                jwt["sub"] = profile.id;
                jwt["_name"] = profile.name;
                jwt["_email"] = profile.email;
                return jwt;
            }

        });
        addAzureAd();
        addLiveId();
        addFacebook();
        addGoogle();
    }
}

/**
 * Setup Facebook login. Requires ``FACEBOOK_CLIENT_ID`` and ``FACEBOOK_CLIENT_SECRET`` env.
 */
export function addFacebook(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("FACEBOOK_CLIENT_ID", false);
    let clientSecret = td.serverSetting("FACEBOOK_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("facebook");
    prov.name = "Facebook";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        if (globalOptions.requestEmail) {
            p.scope = "public_profile,email";
        }
        else {
            p.scope = "public_profile";
        }
        p.response_type = "code";
        url = "https://www.facebook.com/dialog/oauth?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://graph.facebook.com/oauth/access_token");
        if (js == null) {
            return js;
        }
        let request = td.createRequest("https://graph.facebook.com/v2.2/me?access_token=" + encodeURIComponent(js["access_token"]));
        let response = await request.sendAsync();
        profile = response.contentAsJson();
        return profile;
    }
    , async (profile1: JsonObject) => {
        let info: UserInfo;
        let inf = new UserInfo();
        if (!profile1["id"]) return <UserInfo>null;
        inf.id = "fb:" + profile1["id"];
        inf.name = profile1["name"];
        inf.email = profile1["email"];
        return inf;
        return info;
    });
    prov.shortname = "fb";
}

/**
 * Setup Google login. Requires ``GOOGLE_CLIENT_ID`` and ``GOOGLE_CLIENT_SECRET`` env.
 */
export function addGoogle(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("GOOGLE_CLIENT_ID", false);
    let clientSecret = td.serverSetting("GOOGLE_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("google");
    prov.name = "Google";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        if (globalOptions.requestEmail) {
            p.scope = "openid email profile";
        }
        else {
            p.scope = "openid profile";
        }
        p.response_type = "code";
        url = "https://accounts.google.com/o/oauth2/auth?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://www.googleapis.com/oauth2/v3/token");
        if (js == null) {
            return js;
        }
        let request = td.createRequest("https://www.googleapis.com/oauth2/v2/userinfo");
        request.setHeader("Authorization", "Bearer " + js["access_token"]);
        let response = await request.sendAsync();
        // The JWT token doesn't have user's name
        if (false) {
            // profile = nodeJwtSimple.decodeNoVerify(js["id_token"]);
        }
        profile = response.contentAsJson();
        return profile;
    }
    , async (profile1: JsonObject) => {
        let inf = new UserInfo();
        if (!profile1["id"]) return <UserInfo>null;
        inf.id = "google:" + profile1["id"];
        inf.name = profile1["name"];
        inf.email = profile1["email"];
        return inf;
    });
}

/**
 * Setup Edmodo login. Requires ``EDMODO_CLIENT_ID`` and ``EDMODO_CLIENT_SECRET`` env.
 */
export function addEdmodo(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("EDMODO_CLIENT_ID", false);
    let clientSecret = td.serverSetting("EDMODO_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("edmodo");
    prov.name = "Edmodo";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        p.scope = "basic";
        p.response_type = "code";
        url = "https://api.edmodo.com/oauth/authorize?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://api.edmodo.com/oauth/token");
        if (js == null) {
            return js;
        }
        let request = td.createRequest("https://api.edmodo.com/users/me");
        request.setHeader("Authorization", "Bearer " + js["access_token"]);
        let response = await request.sendAsync();
        request = td.createRequest(response.header("Location"));
        request.setHeader("Authorization", "Bearer " + js["access_token"]);
        response = await request.sendAsync();
        profile = response.contentAsJson();
        return profile;
    }
    , async (profile1: JsonObject) => {
        let info: UserInfo;
        info = new UserInfo();
        if (!profile1["id"]) return <UserInfo>null;
        info.id = "edmodo:" + profile1["id"];
        info.name = profile1["name"];
        return info;
    });
}

/**
 * Setup Azure Active Directory (Office 365 or Corporate) authentication provider. Requires ``AZURE_AD_CLIENT_ID`` and ``AZURE_AD_CLIENT_SECRET`` env.
 */
export function addAzureAd(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("AZURE_AD_CLIENT_ID", false);
    let clientSecret = td.serverSetting("AZURE_AD_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("azuread");
    prov.name = "Office 365 or Corporate";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        p.scope = "openid";
        p.response_type = "code";
        p.nonce = td.createRandomId(12);
        url = "https://login.windows.net/common/oauth2/authorize?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://login.windows.net/common/oauth2/token");
        if (js == null) {
            return js;
        }
        logger.debug("resp: " + JSON.stringify(js));
        profile = decodeJwt(js["id_token"]);
        return profile;
    }
    , async (profile1: JsonObject) => {
        let info: UserInfo;
        info = new UserInfo();
        if (!profile1["oid"]) return <UserInfo>null;
        info.id = "ad:" + td.replaceAll(profile1["oid"], "-", "").toLowerCase();
        info.name = profile1["name"];
        info.email = profile1["unique_name"];
        return info;
    });
    prov.shortname = "ad";
}

export function base64urlDecode(s: string): Buffer
{
    return new Buffer(s.replace(/-/g, '+').replace(/_/g, '/'), "base64");
}

export function base64urlEncode(buf: Buffer): string
{
    return buf.toString("base64").replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, "")
}

function decodeJwt(jwt: string): JwtPayload {
    if (!jwt) return null;
    let elts = jwt.split('.');
    if (elts.length != 3) return null;
    try {
        return JSON.parse(base64urlDecode(elts[1]).toString("utf8")); 
    } catch (e) {
        console.log(e);
        return null;
    }
}

export interface JwtPayload {
    jti?: string; // JWT ID
    iss?: string; // issuer
    sub?: string; // subject
    aud?: string; // audience
    iat?: number; // issued at
    nbf?: number; // not-before
    exp?: number; // expiration time
}

export function createJwtHS256(payload: JwtPayload, shakey:Buffer)
{
    let hd = {
        "alg": "HS256",
        "typ": "JWT"
    }
    let enc = s => base64urlEncode(new Buffer(JSON.stringify(s), "utf8"))
    let data = enc(hd) + "." + enc(payload)
    let hash = crypto.createHmac("sha256", shakey)
    hash.update(new Buffer(data, "utf8"))
    return data + "." + base64urlEncode(hash.digest())    
}

export function createJwtRS256(payload: JwtPayload, rsakey:string)
{
    let hd = {
        "alg": "RS256",
        "typ": "JWT"
    }
    let enc = s => base64urlEncode(new Buffer(JSON.stringify(s), "utf8"))
    let data = enc(hd) + "." + enc(payload)
    let hash = crypto.createSign("RSA-SHA256")
    hash.update(new Buffer(data, "utf8"))    
    return data + "." + base64urlEncode(<any>hash.sign(rsakey, null))    
}

export function decodeJwtVerify(jwt: string, alg:string, key: any): JwtPayload {
    if (!jwt) return null;
    let elts = jwt.split('.');
    if (elts.length != 3) return null;
    let hd = null
    let payload: JwtPayload = null
    try {
        hd = JSON.parse(base64urlDecode(elts[0]).toString("utf8"));
        payload = JSON.parse(base64urlDecode(elts[1]).toString("utf8"));
    } catch (e) {
        return null;
    }

    if (hd["typ"] !== "JWT") return null;
    if (hd["alg"] !== alg) return null;

    let data = elts[0] + "." + elts[1]
    if (hd["alg"] == "HS256") {
        if (!Buffer.isBuffer(key))
            throw new Error("Bad key");            
        let hash = crypto.createHmac("sha256", key)
        hash.update(new Buffer(data, "utf8"))
        if (base64urlEncode(hash.digest()) !== elts[2]) {
            return null;
        }
        return payload;
    } else if (hd["alg"] == "RS256") {
        if (typeof key != "string")
            throw new Error("Bad key");
        let verify = crypto.createVerify("RSA-SHA256");
        verify.update(data)
        if (!verify.verify(key, <any>base64urlDecode(elts[2])))
            return null;
        return payload;
    } else {
        return null;
    }
}    

async function oauthLoginAsync(req: restify.Request, res: restify.Response) : Promise<void>
{
    validateOauthParameters(req, res);
    if ( ! res.finished()) {
        await globalOptions.preDialog(req, res);
    }
    let clientOauth = ClientOauth.createFromJson(req.query());
    logger.debug("login: " + JSON.stringify(clientOauth.toJson()));
    if ( ! res.finished()) {
        let provider = ProviderIndex.at(orEmpty(clientOauth.provider));
        if (provider.makeLoginUrl == null) {
            let coll2 = ProviderIndex.all();
            if (coll2.length == 1) {
                provider = coll2[0];
            }
            else {
                let s = providerLinks(req.query()).map<string>(info => {
                    return "<a class=provider href=\"" + info.href + "\">" + info.name + "</a><br>\n";
                }).join("");
                let html = td.replaceAll(chooseProvider_html, "@BODY@", s);
                res.html(html);
            }
        }
        if (provider.makeLoginUrl != null) {
            let p = new OauthRequest();
            let state = td.createRandomId(12);
            let redir = globalOptions.self + "/oauth/callback";
            p.state = state;
            p.redirect_uri = redir;
            p.display = "touch";
            p._provider = provider.id;
            p._client_oauth = clientOauth.toJson();
            if (globalOptions.federationMaster) {
                p.redirect_uri = "https://" + globalOptions.federationMaster + "/oauth/callback";
                p.state = myHost + "," + state;
            }
            let url = await provider.makeLoginUrl(req, p);
            p.state = state;
            await globalOptions.setData(p.state, JSON.stringify(p.toJson()));
            logger.debug("redirect url: " + url);
            res.redirect(303, url);
        }
    }
}

export function validateOauthParameters(req: restify.Request, res: restify.Response) : void
{
    let clientOauth = ClientOauth.createFromJson(req.query());
    if (orEmpty(clientOauth.response_type) != "token") {
        res.sendError(400, "Only response_type=token supported.");
    }
    else if (! clientOauth.state) {
        res.sendError(400, "state= required");
    }
    else {
        let url = orEmpty(clientOauth.redirect_uri);
        if ( ! (td.startsWith(url, globalOptions.self) || td.startsWith(url, "http://localhost:"))) {
            res.sendError(400, "invalid redirect_uri; expecting it to start with " + globalOptions.self + " or http://localhost");
        }
        if (orEmpty(clientOauth.client_id) == "no-cookie" && url != globalOptions.self + "/oauth/gettokencallback") {
            res.sendError(400, "invalid no-cookie redirect_uri; expecting it to start with " + globalOptions.self);
        }
    }
}

export function options() : IInitOptions
{
    return globalOptions
}

export async function userInfoByStateAsync(state: string) : Promise<UserInfo>
{
    let info: UserInfo;
    let s = await globalOptions.getData(state);
    if (s == null || s == "") {
        info = (<UserInfo>null);
    }
    else {
        let oauthRequest = OauthRequest.createFromJson(JSON.parse(s));
        info = UserInfo.createFromJson(oauthRequest._info);
    }
    return info;
}

export function setupRestifyServer() : void
{
    let server = restify.server();
    server.use(restify.authorizationParser());
    server.pre(restify.sanitizePath());
    server.use(restify.CORS());
    server.use(restify.bodyParser());
    server.use(restify.gzipResponse());
    server.use(restify.queryParser());
    server.use(restify.conditionalRequest());
}

function setSelf(req: restify.Request) : void
{
    if (!globalOptions.self) {
        globalOptions.self = req.serverUrl();
    }
    if (myHost == "") {
        myHost = (/^[a-z]+:\/\/([^\/]+)/.exec(globalOptions.self) || [])[1].toLowerCase();
    }
}

export interface ProviderLink {
    href: string;
    name: string;
    shortname: string;
    id: string;
}

export function providerLinks(query: JsonObject) : ProviderLink[]
{
    let clientOauth = ClientOauth.createFromJson(query);
    let coll2 = ProviderIndex.all();
    return td.orderedBy(coll2, elt1 => elt1.order).map(elt => {
        clientOauth.provider = elt.id;
        return <ProviderLink>{
            href: "/oauth/login?" + toQueryString(clientOauth.toJson()),
            name: elt.name,
            shortname: elt.shortname,
            id: elt.id
        }
    })
}


/**
 * Setup Yahoo! authentication. Requires ``YAHOO_CLIENT_ID`` and ``YAHOO_CLIENT_SECRET`` env.
 */
export function addYahoo(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("YAHOO_CLIENT_ID", false);
    let clientSecret = td.serverSetting("YAHOO_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("yahoo");
    prov.name = "Yahoo!";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        p.response_type = "code";
        url = "https://api.login.yahoo.com/oauth2/request_auth?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://api.login.yahoo.com/oauth2/get_token");
        if (js == null) {
            return js;
        }
        let request = td.createRequest("https://social.yahooapis.com/v1/user/me/profile");
        request.setHeader("Authorization", "Bearer " + js["access_token"]);
        request.setAccept("application/json");
        let response = await request.sendAsync();
        //logger.info("yahoo resp: " + response.statusCode() + ": " + response.content())        
        profile = response.contentAsJson();
        if (profile) profile = profile["profile"];
        return profile;
    }
    , async (profile1: JsonObject) => {
        let inf = new UserInfo();
        if (!profile1["guid"]) return <UserInfo>null;
        inf.id = "yahoo:" + profile1["guid"];
        inf.name = profile1["nickname"];
        return inf;
    });
}


/**
 * Setup GitHub authentication. Requires ``GITHUB_CLIENT_ID`` and ``GITHUB_CLIENT_SECRET`` env.
 */
export function addGitHub(options_: IProviderOptions = {}) : void
{
    let clientId = td.serverSetting("GITHUB_CLIENT_ID", false);
    let clientSecret = td.serverSetting("GITHUB_CLIENT_SECRET", false);
    let prov = ProviderIndex.at("github");
    prov.name = "GitHub";
    prov.makeCustomToken = options_.makeCustomToken;
    prov.setupProvider(async (req: restify.Request, p: OauthRequest) => {
        let url: string;
        p.client_id = clientId;
        p.response_type = "code";
        p.scope = "user:email";
        url = "https://github.com/login/oauth/authorize?" + toQueryString(p.toJson());
        return url;
    }
    , async (req1: restify.Request, p1: OauthRequest) => {
        let profile: JsonObject;
        let js = await p1.getAccessCodeAsync(req1.query()["code"], clientSecret, "https://github.com/login/oauth/access_token");
        if (js == null) {
            return js;
        }
        let request = td.createRequest("https://api.github.com/user");
        request.setHeader("Authorization", "token " + js["access_token"]);
        request.setHeader("User-Agent", "Touch Develop backend");
        request.setAccept("application/json");
        let response = await request.sendAsync();
        logger.info("gh resp: " + response.statusCode() + ": " + response.content())
        return response.contentAsJson();
    }, async (profile1: JsonObject) => {
        let inf = new UserInfo();
        if (!profile1["id"]) return <UserInfo>null;
        inf.id = "github:" + profile1["id"];
        inf.name = profile1["login"];
        inf.email = profile1["email"];
        inf.realname = profile1["name"];
        return inf;
    });
}
