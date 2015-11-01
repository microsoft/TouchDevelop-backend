/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

var asArray = td.asArray;

import * as azureBlobStorage from "./azure-blob-storage"
import * as parallel from "./parallel"
import * as restify from "./restify"
import * as cachedStore from "./cached-store"
import * as indexedStore from "./indexed-store"
import * as wordPassword from "./word-password"
import * as core from "./tdlite-core"
import * as nodemailer from "./nodemailer"
import * as sendgrid from "./sendgrid"
import * as tdliteData from "./tdlite-data"
import * as audit from "./tdlite-audit"
import * as search from "./tdlite-search"
import * as tdliteGroups from "./tdlite-groups"
import * as tdlitePointers from "./tdlite-pointers"
import * as tdliteLegacy from "./tdlite-legacy"

var orFalse = core.orFalse;
var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;

export var users: indexedStore.Store;
export var passcodesContainer: cachedStore.Container;
var emailKeyid: string = "EMAIL";
var settingsOptionsJson = tdliteData.settingsOptionsJson;
var useSendgrid: boolean = false;

export interface IUser
{
    id: string;
    kind: string;
    pub: IPubUser;
    settings: any;
    login: string;
    altLogins: string[];
    credit: number;
    emailcode: string; // verification code
    firstcode: string; // code used to create the account
    totalcredit: number;
    permissions: string;
    secondaryid: string;
    nopublish: boolean;
    lastlogin: number; // seconds since epoch
    awaiting: boolean; // awaiting admission to the system
    groups: td.SMap<number>;
    owngroups: td.SMap<number>;
    termsversion: string;
    migrationtoken: string;
    importworkspace: string; // set to non-empty if we're still importing workspace for this user from the legacy system
    lastNotificationId: string;
    notifications: number;
}

export interface IPubUser
{
    name: string;
    haspicture: boolean;
    time: number;
    about: string;
    features: number;
    activedays: number;
    receivedpositivereviews: number;
    subscribers: number;
    score: number;
    isadult: boolean;
    avatar: string;    
}    

export class PubUser
    extends core.IdObject
{
    @td.json public name: string = "";
    @td.json public haspicture: boolean = false;
    @td.json public time: number = 0;
    @td.json public about: string = "";
    @td.json public features: number = 0;
    @td.json public activedays: number = 0;
    @td.json public receivedpositivereviews: number = 0;
    @td.json public subscribers: number = 0;
    @td.json public score: number = 0;
    @td.json public isadult: boolean = false;
    @td.json public avatar: string = "";
    static createFromJson(o:JsonObject) { let r = new PubUser(); r.fromJson(o); return r; }
}

export class PubUserSettings
    extends td.JsonRecord
{
    @td.json public nickname: string = "";
    @td.json public aboutme: string = "";
    @td.json public website: string = "";
    @td.json public notifications: boolean = false;
    @td.json public notifications2: string = "";
    @td.json public picturelinkedtofacebook: string = "";
    @td.json public picture: string = "";
    @td.json public gender: string = "";
    @td.json public realname: string = "";
    @td.json public yearofbirth: number = 0;
    @td.json public location: string = "";
    @td.json public culture: string = "";
    @td.json public howfound: string = "";
    @td.json public programmingknowledge: string = "";
    @td.json public occupation: string = "";
    @td.json public twitterhandle: string = "";
    @td.json public email: string = "";
    @td.json public emailverificationsent: boolean = false;
    @td.json public emailverified: boolean = false;
    @td.json public emailnewsletter2: string = "";
    @td.json public emailfrequency: string = "";
    @td.json public editorMode: string = "";
    @td.json public school: string = "";
    @td.json public wallpaper: string = "";
    @td.json public permissions: string = "";
    @td.json public credit: number = 0;
    @td.json public userid: string = "";
    @td.json public avatar: string = "";
    @td.json public previousemail: string = "";
    static createFromJson(o:JsonObject) { let r = new PubUserSettings(); r.fromJson(o); return r; }
}

export async function initAsync() : Promise<void>
{
    await nodemailer.initAsync();
    if (core.hasSetting("SENDGRID_API_KEY")) {
        useSendgrid = true;
        await sendgrid.initAsync("", "");
    }

    passcodesContainer = await cachedStore.createContainerAsync("passcodes", {
        noCache: true
    });

    users = await indexedStore.createStoreAsync(core.pubsContainer, "user");
    core.registerPubKind({
        store: users,
        deleteWithAuthor: false,
        importOne: importUserAsync
    })
    await core.setResolveAsync(users, async (fetchResult: indexedStore.FetchResult, apiRequest: core.ApiRequest) => {
        resolveUsers(fetchResult, apiRequest);
    });
    await users.createIndexAsync("seconadaryid", entry => orEmpty(entry["secondaryid"]));
    core.addRoute("GET", "secondaryid", "*", async (req: core.ApiRequest) => {
        core.checkPermission(req, "user-mgmt");
        if (req.status == 200) {
            await core.anyListAsync(users, req, "secondaryid", req.verb);
        }
    });
    
    if (core.encrypt("foobar", emailKeyid) == "foobar") {
        await users.createIndexAsync("email", entry => orEmpty(entry["settings"] ? entry["settings"]["email"] : "").toLowerCase());
        await users.createIndexAsync("previousemail", entry => orEmpty(entry["settings"] ? entry["settings"]["previousemail"] : "").toLowerCase());
        core.addRoute("GET", "useremail", "*", async(req: core.ApiRequest) => {
            core.checkPermission(req, "user-mgmt");
            if (req.status == 200) {
                await core.anyListAsync(users, req, "email", req.verb.toLowerCase());
            }
        });
        core.addRoute("GET", "userpreviousemail", "*", async(req: core.ApiRequest) => {
            core.checkPermission(req, "user-mgmt");
            if (req.status == 200) {
                await core.anyListAsync(users, req, "previousemail", req.verb.toLowerCase());
            }
        });
    }
    
    // ### all
    core.addRoute("POST", "*user", "permissions", async (req: core.ApiRequest) => {
        core.checkMgmtPermission(req, "user-mgmt");
        if (req.status == 200) {
            let perm = td.toString(req.body["permissions"]);
            if (perm != null) {
                perm = core.normalizePermissions(perm);
                core.checkPermission(req, "root");
                if (req.status != 200) {
                    return;
                }
                await audit.logAsync(req, "set-perm", {
                    data: perm
                });
                if (core.isAlarming(perm)) {
                    await audit.logAsync(req, "set-perm-high", {
                        data: perm
                    });
                }
                await updateAsync(req.rootId, async (entry: IUser) => {
                    entry.permissions = perm;
                    await sendPermissionNotificationAsync(req, entry);
                });
            }
            let credit = td.toNumber(req.body["credit"]);
            if (credit != null) {
                await audit.logAsync(req, "set-credit", {
                    data: credit.toString()
                });
                await updateAsync(req.rootId, async (entry: IUser) => {
                    entry.credit = credit;
                    entry.totalcredit = credit;
                });
            }
            let nopublish = td.toBoolean(req.body["nopublish"]);
            if (nopublish != null) {
                await audit.logAsync(req, "set-nopublish", {
                    data: nopublish.toString()
                });
                await updateAsync(req.rootId, async(entry: IUser) => {
                    entry.nopublish = nopublish;
                });
            }
            req.response = {};
        }
    });
    core.addRoute("GET", "*user", "permissions", async (req: core.ApiRequest) => {
        core.checkMgmtPermission(req, "user-mgmt");
        if (req.status == 200) {
            let jsb = {};
            for (let s of ["permissions", "login"]) {
                jsb[s] = orEmpty(req.rootPub[s]);
            }
            for (let s1 of ["credit", "totalcredit", "lastlogin"]) {
                jsb[s1] = core.orZero(req.rootPub[s1]);
            }
            jsb["nopublish"] = core.orFalse(req.rootPub["nopublish"]);
            req.response = jsb;
        }
    });
    // This is for test users for load testing nd doe **system accounts**
    core.addRoute("POST", "users", "", async (req4: core.ApiRequest) => {
        core.checkPermission(req4, "root");
        if (req4.status == 200) {
            let opts = req4.body;
            let pubUser = new PubUser();
            pubUser.name = withDefault(opts["name"], "Dummy" + td.randomInt(100000));
            pubUser.about = withDefault(opts["about"], "");
            pubUser.time = await core.nowSecondsAsync();
            let jsb1: IUser = <any>{};            
            jsb1.pub = <IPubUser> pubUser.toJson();
            jsb1.settings = {};            
            jsb1.permissions = ",preview,";
            jsb1.secondaryid = cachedStore.freshShortId(12);
            await core.generateIdAsync(jsb1, 4);
            await users.insertAsync(jsb1);
            let pass2 = wordPassword.generate();
            req4.rootId = jsb1.id;            
            req4.rootPub = td.clone(jsb1);
            await setPasswordAsync(req4, pass2, "");
            let jsb3 = td.clone(await core.resolveOnePubAsync(users, req4.rootPub, req4));
            jsb3["password"] = pass2;
            req4.response = td.clone(jsb3);
        }
    });
    core.addRoute("POST", "*user", "addauth", async (req5: core.ApiRequest) => {
        let tokenJs = req5.userinfo.token;
        if (orEmpty(req5.body["key"]) != core.tokenSecret) {
            req5.status = httpCode._403Forbidden;
        }
        else if (tokenJs == null) {
            req5.status = httpCode._404NotFound;
        }
        else {
            let s2 = tokenJs.reason;
            if (td.startsWith(s2, "id/")) {
                await passcodesContainer.updateAsync(s2, async (entry3: JsonBuilder) => {
                    entry3["userid"] = req5.rootId;
                });
                req5.response = ({});
            }
            else {
                req5.status = httpCode._400BadRequest;
            }
        }
    });
    core.addRoute("POST", "*user", "swapauth", async (req: core.ApiRequest) => {
        core.checkPermission(req, "root");
        if (req.status != 200) {
            return;
        }
        if (req.rootId == req.argument) {
            req.status = httpCode._412PreconditionFailed;
            return;
        }
        let otherUser = await getAsync(req.argument);
        if (otherUser == null) {
            req.status = httpCode._404NotFound;
            return;
        }
        let rootUser = req.rootUser();
        let rootPassId = rootUser.login;
        let rootPass = await passcodesContainer.getAsync(rootPassId);
        let otherPassId = otherUser.login;
        let otherPass = await passcodesContainer.getAsync(otherPassId);
        if (rootPass == null || otherPass == null) {
            req.status = httpCode._424FailedDependency;
            return;
        }
        if (rootUser.altLogins || otherUser.altLogins) {
            req.status = httpCode._412PreconditionFailed;
            return;            
        }
        await passcodesContainer.updateAsync(rootPassId, async (entry4: JsonBuilder) => {
            entry4["userid"] = otherUser.id;
        });
        await passcodesContainer.updateAsync(otherPassId, async (entry5: JsonBuilder) => {
            entry5["userid"] = rootUser.id;
        });
        await updateAsync(rootUser.id, async (entry6) => {
            entry6.login = otherPassId;
        });
        await updateAsync(otherUser["id"], async (entry7) => {
            entry7.login = rootPassId;
        });
        req.response = {
            oldrootpass: rootPass,
            oldotherpass: otherPass
        };
    });
    core.addRoute("GET", "*user", "resetpassword", async (req9: core.ApiRequest) => {
        await core.checkFacilitatorPermissionAsync(req9, req9.rootId);
        if (req9.status == 200) {
            req9.response = {
                passwords: td.range(0, 10).map<string>(elt => wordPassword.generate()) 
            }
        }
    });
    core.addRoute("POST", "*user", "resetpassword", async (req10: core.ApiRequest) => {
        await core.checkFacilitatorPermissionAsync(req10, req10.rootId);
        if (req10.status == 200) {
            let pass = orEmpty(req10.body["password"]);
            let prevPass = orEmpty(req10.rootPub["login"]);
            if (pass.length < 10) {
                req10.status = httpCode._412PreconditionFailed;
            }
            else if ( ! td.startsWith(prevPass, "code/")) {
                req10.status = httpCode._405MethodNotAllowed;
            }
            else {
                await setPasswordAsync(req10, pass, prevPass);
            }
        }
    });
    core.addRoute("POST", "updatecodes", "", async (req11: core.ApiRequest) => {
        core.checkPermission(req11, "root");
        if (req11.status != 200) {
            return;
        }
        let codes = req11.body["codes"];
        await parallel.forBatchedAsync(codes.length, 50, async (x1: number) => {
            let s5 = td.toString(codes[x1]);
            await passcodesContainer.updateAsync(core.normalizeAndHash(s5), async (entry8: JsonBuilder) => {
                assert(td.stringContains(entry8["permissions"], ","), "");
                entry8["permissions"] = req11.body["permissions"];
            });
        }
        , async () => {
        });
        req11.response = ({});
    });
    core.addRoute("POST", "generatecodes", "", async (req12: core.ApiRequest) => {
        let perm1 = core.normalizePermissions(td.toString(req12.body["permissions"]));
        let grps = orEmpty(req12.body["groups"]);
        let addperm = "";
        if (grps != "") {
            addperm = ",user-mgmt";
        }
        if (perm1 == "") {
            perm1 = "educator";
        }
        if (core.isAlarming(perm1)) {
            req12.status = httpCode._402PaymentRequired;
        }
        let numCodes = td.toNumber(req12.body["count"]);
        if (numCodes > 1000) {
            req12.status = httpCode._413RequestEntityTooLarge;
        }
        core.checkPermission(req12, "gen-code," + perm1 + addperm);
        if (req12.status == 200) {
            let coll = (<string[]>[]);
            let credit1 = td.toNumber(req12.body["credit"]);
            await audit.logAsync(req12, "generatecodes", {
                data: numCodes + "x" + credit1 + perm1,
                newvalue: req12.body
            });
            await parallel.forAsync(numCodes, async (x2: number) => {
                let id = cachedStore.freshShortId(12);
                if (req12.body.hasOwnProperty("code")) {
                    id = td.toString(req12.body["code"]);
                }
                let s3 = core.normalizeAndHash(id);
                await passcodesContainer.updateAsync(s3, async (entry9: JsonBuilder) => {
                    entry9["kind"] = "activationcode";
                    entry9["userid"] = req12.userid;
                    if (perm1 != "") {
                        entry9["permissions"] = perm1;
                    }
                    entry9["groups"] = grps;
                    entry9["orig_credit"] = credit1;
                    entry9["credit"] = credit1;
                    entry9["time"] = await core.nowSecondsAsync();
                    entry9["description"] = orEmpty(req12.body["description"]);
                    if (req12.body.hasOwnProperty("singlecredit")) {
                        entry9["singlecredit"] = td.toNumber(req12.body["singlecredit"]);
                    }
                });
                coll.push(id);
            });
            let fetchResult1 = users.singleFetchResult(({}));
            fetchResult1.items = td.arrayToJson(coll);
            req12.response = fetchResult1.toJson();
        }
    });
    
    core.addRoute("POST", "*user", "settings", async (req4: core.ApiRequest) => {
        let logcat = "admin-settings";
        let updateOwn = false;
        if (req4.rootId == req4.userid) {
            core.checkPermission(req4, "adult");
            if (req4.status == 200) {
                await core.throttleAsync(req4, "settings", 120);
                logcat = "user-settings";
                updateOwn = true;
            }
        }
        else {
            await core.checkFacilitatorPermissionAsync(req4, req4.rootId);
        }
        if (req4.status == 200) {
            let nick = orEmpty(req4.body["nickname"]).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
            if (new RegExp(core.serviceSettings.blockedNicknameRx).test(nick)) {
                core.checkPermission(req4, "official");
            }
        }
        if (req4.status == 200) {
            let bld = await users.reindexAsync(req4.rootId, async(entry: IUser) => {
                let sett = await buildSettingsAsync(entry);                
                let newEmail = td.toString(req4.body["email"]);
                if (newEmail != null) {
                    if (updateOwn) {
                        if (sett.emailverified) {
                            sett.previousemail = sett.email;
                        }
                        sett.emailverified = false;
                        sett.email = newEmail;
                        let id = td.createRandomId(16).toLowerCase();
                        entry.emailcode = id;
                        if (/^[^@]+@[^@]+$/.test(newEmail)) {
                            let txt = "Please follow the link below to verify your new email address on " + core.myHost + "\n\n" +
                                "      " + core.self + "verify/" + req4.rootId + "/" + id + "\n\n" +
                                "Thanks!\n";
                            /* async */ nodemailer.sendAsync(newEmail, core.serviceSettings.emailFrom,
                                    "email verification on " + core.myHost, txt)
                                .then(() => { }, e => {
                                    logger.info(`nodemailer send failed: ${newEmail}: ${e.message}`)
                                })
                        }
                    }
                    else {
                        sett.email = newEmail;
                        sett.emailverified = true;
                        sett.previousemail = "";
                        entry.emailcode = "";
                    }
                }
                
                let settings = sett.toJson();                
                core.setFields(settings, req4.body, ["aboutme", "culture", "editorMode", "emailfrequency", "emailnewsletter2", 
                    "gender", "howfound", "location", "nickname", "notifications", "notifications2", "occupation", "picture", 
                    "picturelinkedtofacebook", "programmingknowledge", "realname", "school", "twitterhandle", "wallpaper", 
                    "website", "yearofbirth", "avatar"]);
                applyUserSettings(entry, settings);
                req4.response = settings;
            });
            await search.scanAndSearchAsync(bld);            
            await audit.logAsync(req4, logcat, {
                oldvalue: req4.rootPub,
                newvalue: td.clone(bld)
            });
        }
    });
    core.addRoute("GET", "*user", "settings", async (req5: core.ApiRequest) => {
        if (req5.rootId == req5.userid) {
        }
        else {
            await core.checkFacilitatorPermissionAsync(req5, req5.rootId);
        }
        if (req5.status == 200) {
            if (req5.userid != req5.rootId) {
                await audit.logAsync(req5, "view-settings");
            }
            let jsb = (await buildSettingsAsync(req5.rootUser())).toJson();
            if (orEmpty(req5.queryOptions["format"]) != "short") {
                core.copyJson(settingsOptionsJson, jsb);
            }
            req5.response = jsb;
        }
    });

    core.addRoute("POST", "*user", "progress", async (req: core.ApiRequest) => {
        core.meOnly(req);
        if (req.status == 200) {
            req.response = {};
        }
    });

    core.addRoute("DELETE", "*user", "login", async(req: core.ApiRequest) => {
        if (!core.checkPermission(req, "root")) return;
        let u = req.rootUser();
        if (!u.login) {
            req.status = httpCode._404NotFound
            return;            
        }
        let logins = (u.altLogins || []).concat([u.login])
        for (let login of logins) {
            await passcodesContainer.updateAsync(login, async(v) => {
                v["userid"] = "";
            })
        }    
        await updateAsync(req.rootId, async(v) => {
            delete v.login;
            delete v.altLogins;
        })
        req.response = {};
    });
}

export function applyUserSettings(userjson: IUser, settings: {}) {
    for (let k of ["culture", "email", "previousemail", "gender", "location", "occupation",
        "programmingknowledge", "realname", "school"]) {
        let val = settings[k];
        if (orEmpty(val) != "") {
            settings[k] = core.encrypt(val, emailKeyid);
        }
    }
    let value = td.clone(settings);
    userjson.settings = value;
    let sett = PubUserSettings.createFromJson(value);
    sett.nickname = sett.nickname.substr(0, 25);
    userjson.pub.name = sett.nickname;
    userjson.pub.about = sett.aboutme;
    userjson.pub.avatar = sett.avatar;
}

export function normalizeUser(v: IUser)
{
    if (!v || v.kind != "user") return
    if (!v.groups) v.groups = {};
    if (!v.owngroups) v.owngroups = {};
    v.credit = core.orZero(v.credit);
    v.totalcredit = core.orZero(v.totalcredit);
}

export async function updateAsync(id:string, f:(v:IUser) => Promise<void>)
{
    return <IUser>await core.pubsContainer.updateAsync(id, async(v: IUser) => {
        normalizeUser(v);
        await f(v);  
    })
}

export async function getAsync(id:string)
{
    let r = <IUser>await core.getPubAsync(id, "user");
    normalizeUser(r)
    return r
}

export function resolveUsers(entities: indexedStore.FetchResult, req: core.ApiRequest) : void
{
    let coll = (<PubUser[]>[]);
    if (orFalse(req.queryOptions["imported"])) {
        entities.items = td.arrayToJson(asArray(entities.items).filter(elt => ! elt["login"]));
    }
    for (let jsb0 of entities.items) {
        let jsb = <IUser>jsb0;
        let user = new PubUser();
        coll.push(user);
        user.fromJson(jsb.pub);
        user.id = jsb.id;
        user.kind = jsb.kind;
        if ( ! core.fullTD) {
            user.time = 0;
        }
        user.isadult = core.hasPermission(jsb, "adult");
    }
    entities.items = td.arrayToJson(coll);
}


export async function buildSettingsAsync(userJson: IUser) : Promise<PubUserSettings>
{
    let settings = new PubUserSettings();
    let user = new PubUser();
    user.fromJson(userJson.pub);
    let js = userJson.settings;
    if (js != null) {
        let jsb = td.clone(js);
        for (let kk of Object.keys(jsb)) {
            let vv = jsb[kk];
            if (td.startsWith(orEmpty(vv), "EnC$")) {
                jsb[kk] = core.decrypt(vv);
            }
        }
        settings.fromJson(td.clone(jsb));
    }
    settings.userid = userJson["id"];
    settings.nickname = user.name;
    settings.aboutme = user.about;
    settings.avatar = user.avatar || "";
    let perms = {};
    for (let s of orEmpty(userJson.permissions).split(",")) {
        if (s != "") {
            perms[s] = 1;
            let js2 = core.settingsPermissions[s];
            if (js2 != null) {
                td.jsonCopyFrom(perms, js2);
            }
        }
    }
    settings.permissions = "," + Object.keys(perms).join(",") + ",";
    settings.credit = core.orZero(userJson.credit);
    return settings;
}

export interface IRedirectAndCookie
{
    url:string;
    cookie:string;
}

async function setPasswordAsync(req: core.ApiRequest, pass: string, prevPass: string) : Promise<void>
{
    pass = core.normalizeAndHash(pass);
    if (! prevPass) {
        prevPass = pass;
    }
    let ok = false;
    await passcodesContainer.updateAsync(pass, async (entry: JsonBuilder) => {
        let kind = orEmpty(entry["kind"]);
        if (kind == "" || kind == "reserved") {
            entry["kind"] = "userpointer";
            entry["userid"] = req.rootId;
            ok = true;
        }
        else {
            ok = false;
        }
    });
    if (ok) {
        await updateAsync(req.rootId, async (entry1) => {
            entry1.login = pass;
        });
        if (prevPass != pass) {
            await passcodesContainer.updateAsync(prevPass, async (entry2: JsonBuilder) => {
                entry2["kind"] = "reserved";
            });
        }
        req.response = {};
    }
    else {
        req.status = httpCode._400BadRequest;
    }
}

async function sendPermissionNotificationAsync(req: core.ApiRequest, r: IUser) : Promise<void>
{
    await core.refreshSettingsAsync();
    if (core.isAlarming(r.permissions)) {
        if (!r.settings)
            r.settings = {};
        let name_ = withDefault(core.decrypt(r.settings["realname"]), r.pub.name);
        let subj = "[TDLite] permissions for " + name_ + " set to " + r["permissions"];
        let body = "By code.";
        if (req.userid != "") {
            let entry2 = req.userinfo.json;
            body = "Permissions set by: " + entry2.pub.name + " " + core.self + req.userid;
        }
        body = body + "\n\nTarget user: " + core.self + r.id;
        await parallel.forJsonAsync(core.serviceSettings.alarmingEmails, async (json: JsonObject) => {
            let email = td.toString(json);
            await sendgrid.sendAsync(email, "noreply@touchdevelop.com", subj, body);
        });
    }
}

async function importUserAsync(req: core.ApiRequest, body: JsonObject) : Promise<void>
{
    let user = new PubUser();
    user.fromJson(body);
    user.url = "";
    user.features = 0;
    user.activedays = 0;
    user.subscribers = 0;
    user.receivedpositivereviews = 0;
    user.score = 0;
    user.haspicture = false;

    let jsb:IUser = <any> {};
    jsb.pub = <IPubUser>user.toJson();
    jsb.id = user.id;
    jsb.secondaryid = cachedStore.freshShortId(12);
    await users.insertAsync(jsb);    
    await tdliteLegacy.importSettingsAsync(jsb);
}

export async function createNewUserAsync(username: string, email: string, profileId: string, perms: string, realname: string, awaiting: boolean) : Promise<IUser>
{
    let userjs:IUser = <any>{};
    let pubUser = new PubUser();
    pubUser.name = username;
    let settings = new PubUserSettings();
    settings.email = core.encrypt(email, emailKeyid);
    settings.realname = core.encrypt(realname, emailKeyid);
    settings.emailverified = orEmpty(settings.email) != "";
    userjs.pub = <IPubUser> pubUser.toJson();
    userjs.settings = settings.toJson();
    userjs.login = profileId;
    userjs.permissions = perms;
    userjs.secondaryid = cachedStore.freshShortId(12);
    if (awaiting) {
        userjs.awaiting = awaiting;
    }
    let dictionary = core.setBuilderIfMissing(userjs, "groups");
    let dictionary2 = core.setBuilderIfMissing(userjs, "owngroups");
    await core.generateIdAsync(userjs, core.fullTD ? 4 : 8);
    await users.insertAsync(userjs);
    await passcodesContainer.updateAsync(profileId, async (entry: JsonBuilder) => {
        entry["kind"] = "userpointer";
        entry["userid"] = userjs["id"];
    });
    await sendPermissionNotificationAsync(core.emptyRequest, userjs);
    return userjs;
}


export async function setProfileIdFromLegacyAsync(uid: string, profileId: string) {
    let final = await updateAsync(uid, async(v) => {
        if (!v.login)
            v.login = profileId;
        if (v.login == profileId)
            v.importworkspace = "2";
    })

    if (final.login != profileId) return false;

    await passcodesContainer.updateAsync(profileId, async(entry: JsonBuilder) => {
        entry["kind"] = "userpointer";
        entry["userid"] = uid;
    });

    return true;
}

export async function applyCodeAsync(userjson: IUser, codeObj: JsonObject, passId: string, auditReq: core.ApiRequest) : Promise<void>
{
    let userid = userjson.id;
    let credit = codeObj["credit"];
    let singleCredit = codeObj["singlecredit"];
    if (singleCredit != null) {
        credit = Math.min(credit, singleCredit);
    }
    let perm = withDefault(codeObj["permissions"], "preview,");
    await updateAsync(userid, async(entry: IUser) => {
        entry.credit += credit;
        entry.totalcredit += credit;
        if ( ! core.hasPermission(entry, perm)) {
            let existing = core.normalizePermissions(orEmpty(entry.permissions));
            entry.permissions = existing + "," + perm;
        }
        if (! entry.firstcode) {
            entry.firstcode = passId;
        }
        await sendPermissionNotificationAsync(core.emptyRequest, entry);
    });
    await passcodesContainer.updateAsync(passId, async (entry1: JsonBuilder) => {
        entry1["credit"] = entry1["credit"] - credit;
    });
    await audit.logAsync(auditReq, "apply-code", {
        userid: codeObj["userid"],
        subjectid: userjson["id"],
        publicationid: passId.replace(/^code\//g, ""),
        publicationkind: "code",
        oldvalue: codeObj
    });
    for (let grpid of orEmpty(codeObj["groups"]).split(",")) {
        if (grpid != "") {
            let grp = await core.getPubAsync(grpid, "group");
            if (grp != null) {
                await tdliteGroups.addUserToGroupAsync(userid, grp, auditReq);
            }
        }
    }
}

export async function handleEmailVerificationAsync(req: restify.Request, res: restify.Response) : Promise<void>
{
    let lang = await tdlitePointers.handleLanguageAsync(req, res, true);
    let coll = (/^\/verify\/([a-z]+)\/([a-z]+)/.exec(req.url()) || []);
    let userJs = await getAsync(coll[1]);
    let msg = "";
    if (userJs == null) {
        msg = core.translateMessage("Cannot verify email - no such user.", lang);
    }
    else if (orEmpty(userJs.emailcode) != coll[2]) {
        msg = core.translateMessage("Cannot verify email - invalid or expired code.", lang);
    }
    else {
        msg = core.translateMessage("Thank you, your email was updated.", lang);
        await updateAsync(userJs.id, async (entry) => {
            let jsb = entry["settings"];
            jsb["emailverified"] = true;
            jsb["previousemail"] = "";
            entry.emailcode = "";
        });
    }
    res.sendText(msg, "text/plain");
}
