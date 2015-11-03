/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import * as querystring from 'querystring';

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
import * as azureTable from "./azure-table"
import * as tdliteUsers from "./tdlite-users"
import * as tdliteLogin from "./tdlite-login"
import * as tdliteWorkspace from "./tdlite-workspace"
import * as tdliteScripts from "./tdlite-scripts"
import * as tdliteImport from "./tdlite-import"
import * as serverAuth from "./server-auth"

var logger = core.logger;
var httpCode = core.httpCode;
var emailLinkingEnabled = false;

interface LegacySettings {
    AboutMe: string;
    Culture: string;
    EditorMode: string;
    Email: string;
    Gender: string;
    HowFound: string;
    Location: string;
    Occupation: string;
    ProgrammingKnowledge: string;
    RealName: string;
    TwitterHandle: string;
    Website: string;
    YearOfBirth: number;
    FacebookId: string;
    Nickname: string;
}

var legacyTable: azureTable.Client;
var legacyBlob: azureBlobStorage.BlobService;
var settingsTable: azureTable.Table;
var workspaceTable: azureTable.Table;
var identityTable: azureTable.Table;
var largeinstalledContainer: azureBlobStorage.Container;

type IUser = tdliteUsers.IUser;

export async function initAsync()
{
    let pref = "LEGACY"
    legacyTable = await core.specTableClientAsync(pref);    
    legacyBlob = azureBlobStorage.createBlobService({
        storageAccount: td.serverSetting(pref + "_ACCOUNT", false),
        storageAccessKey: td.serverSetting(pref + "_KEY", false)
    });
    
    settingsTable = legacyTable.getTable("svcUSRsettings");    
    workspaceTable = legacyTable.getTable("svcUSRscripts");
    identityTable = legacyTable.getTable("svcUSRidentity");
    largeinstalledContainer = legacyBlob.getContainer("largeinstalled");
    
    core.addRoute("POST", "*user", "importsettings", async (req: core.ApiRequest) => {
        if (!core.checkPermission(req, "operator")) return;
        req.response = await importSettingsAsync(req.rootUser())
    });
   
    core.addRoute("POST", "import", "usersettings", async(req: core.ApiRequest) => {
        if (!core.checkPermission(req, "operator")) return;
        let entities = await tdliteUsers.users.getIndex("all").fetchAsync("all", req.queryOptions);
        let resp = {}
        await parallel.forJsonAsync(entities.items, async(v:IUser) => {
            let r = await importSettingsAsync(v);
            resp[v["id"]] = r["code"];
        }, 25);
        req.response = {
            continuation: entities.continuation,
            publications: resp
        };
    });
    
    core.addRoute("POST", "import", "useremail", async(req: core.ApiRequest) => {
        if (!core.checkPermission(req, "operator")) return;
        let entities = await tdliteUsers.users.getIndex("all").fetchAsync("all", req.queryOptions);
        let resp = {}
        await parallel.forJsonAsync(entities.items, async(v) => {
            let s = v["settings"]
            resp[v["id"]] = 200;
            if (!s) return
            let e:string = s["email"]
            if (!e) return
            if (e.toLowerCase() != e) {
                await tdliteUsers.users.reindexAsync(v["id"], async(v) => {
                    v["settings"]["email"] = v["settings"]["email"].toLowerCase();
                }, true);
                //resp[v["id"]] = 200;
            }         
        }, 25);
        req.response = {
            continuation: entities.continuation,
            publications: resp
        };
    });
    
    core.addRoute("POST", "*user", "importworkspace", async (req: core.ApiRequest) => {
        if (!core.checkPermission(req, "operator")) return;
        await tdliteUsers.updateAsync(req.rootId, async(v) => {
            v.importworkspace = "1";
        })
        req.response = {};                
    });
    
    core.addRoute("POST", "migrationtoken", "", async(req) => {
        let tok = td.orEmpty(req.body["access_token"])        
        if (!tok || !core.fullTD) {
            req.status = httpCode._400BadRequest;
            return;
        }
        
        let q = td.createRequest("https://api.touchdevelop.com/me?access_token=" + encodeURIComponent(tok))
        let resp = await q.sendAsync()
        let json = resp.contentAsJson()
        if (!json) { 
            req.status = httpCode._403Forbidden;
            return;
        }
        
        let uid = json["id"]
        let userjson = await tdliteUsers.getAsync(uid);
        if (!userjson) {
            userjson = <IUser> await tdliteImport.reimportPub(uid, "user");
            if (!userjson) {
                req.status = httpCode._424FailedDependency;
                return;
            }    
        }
        
        if (userjson["login"]) {
            req.status = httpCode._409Conflict;
            return;            
        }
        
        userjson = await tdliteUsers.updateAsync(uid, async(v) => {            
            if (!v.migrationtoken) {
                v.migrationtoken = "1" + uid + "." + td.createRandomId(32);
            }
        })
        
        req.response = {
            userid: uid,
            migrationtoken: userjson.migrationtoken
        }        
    })
    
    restify.server().post("/oauth/legacycallback", async(req, res) => {
        let body = req.handle.body;
        if (typeof body == "string")
            body = querystring.parse(body);
        let token = null
        if (body)
            token = decodeJWT(body["wresult"]);
        if (!token) {
            res.sendError(httpCode._400BadRequest, "no token");
            return;
        }
        if (token.header.alg !== "HS256") {
            res.sendError(httpCode._415UnsupportedMediaType, "bad alg");
            return;
        }
        let key = new Buffer(td.serverSetting("ACCESS_CONTROL_SERVICE_JWT_KEY"), "base64")
        let hmac = crypto.createHmac("sha256", key)
        hmac.update(token.tosign)
        let digest = hmac.digest("hex")
        if (digest !== token.sig) {
            logger.warning("acs signature mismatch; " + JSON.stringify(token.payload))
            res.sendError(httpCode._403Forbidden, "signature mismatch");
            return;
        }
        let idprov = token.payload["identityprovider"];
        let name = token.payload["nameid"];
        

        let session = await tdliteLogin.LoginSession.loadAsync(req.query()["token"])
        if (!session) {
            logger.info("session not found; id=" + req.query()["token"])
            res.sendError(httpCode._412PreconditionFailed, "Session not found: " + req.query()["token"])
            return
        }
        
        let encode = (s: string) => s.replace(/[^a-zA-Z0-9\.]/g, m => "%" + ("000" + m.charCodeAt(0).toString(16).toUpperCase()).slice(-4))
        let ent = await identityTable.getEntityAsync(encode(name), encode(idprov))
        if (!ent) {            
            session.storedMessage = "Cannot find that user account in the legacy system. Maybe try linking other provider?"
            logger.tick("Login_legacyNotFound")
            logger.warning("cannot find ACS user: " + encode(name) + ":" + encode(idprov))
            await session.saveAndRedirectAsync(req);
            return;
        }

        let userjson = await reimportUserAsync(td.orEmpty(ent["UserId"]))

        if (!userjson) {
            // log crash
            logger.error("cannot import user: " + JSON.stringify(ent))
            res.sendError(httpCode._500InternalServerError, "cannot import user; sorry");
            return;
        }

        let ok = await session.setMigrationUserAsync(userjson["id"])
        if (!ok) {
            session.storedMessage = "This user account was already bound to identity in the new system. Maybe try linking other provider?"
            logger.tick("Login_legacyBound")
        } else {
            logger.tick("Login_legacyOK")
        }        
        
        await session.saveAndRedirectAsync(req);                
    });
}

async function reimportUserAsync(uid: string) {
    let userjson = await tdliteUsers.getAsync(uid)
    if (!userjson)
        userjson = <IUser>await tdliteImport.reimportPub(uid, "user");
    return userjson;
}

function decodeJWT(wresult: string) {
    let mtch = />([^<>]+)<\/wsse:BinarySecurityToken>/.exec(wresult)
    if (!mtch) return null;

    let jwt = new Buffer(mtch[1], "base64").toString("utf8")
    if (!jwt) return null;
    let words = jwt.split('.');

    if (words.length != 3) return null;

    try {
        return {
            header: JSON.parse(serverAuth.base64urlDecode(words[0]).toString("utf8")),
            payload: JSON.parse(serverAuth.base64urlDecode(words[1]).toString("utf8")),
            tosign: words[0] + "." + words[1],
            sig: serverAuth.base64urlDecode(words[2]).toString("hex")
        }
    } catch (e) {
        return null;
    }
}


function decompress(buf: Buffer)
{
    if (!buf) return "";
    
    if (buf.length <= 1) return "";
    
    if (buf[0] == 0) {
        buf = buf.slice(1);
    } else if (buf[0] == 1 || buf[0] == 2) {
        let len = buf.readInt32LE(1);
        if (buf[0] == 1)
            buf = zlib.inflateRawSync(buf.slice(5));
        else
            buf = zlib.gunzipSync(buf.slice(5));
        assert(len == buf.length)       
    } else {
        assert(false)       
    }
    
    return buf.toString("utf8");
}

function decompressBlob(buf: Buffer) {
    let json = [];
    if (buf.readInt32LE(0) == 1) {
        for (let pos = 4; pos < buf.length;) {
            if (!buf[pos++]) {
                json.push(null);
                continue;
            }

            let len = buf.readInt32LE(pos);
            pos += 4;
            json.push(decompress(buf.slice(pos, pos + len)))
            pos += len;
            
            if (json.length >= 5) break;
        }
    }

    return json;
}

interface WorkspaceEntry {
    PartitionKey:string;
    RowKey:string;    
    IsLarge: boolean;
    LastUpdated: Date;
    PrivateCompressedEditorState: Buffer;
    PrivateCompressedScript: Buffer;
    PrivateCompressedState: Buffer;
    RecentUse: Date;
    ScriptDescription: string;
    ScriptId: string;
    ScriptName: string;
    ScriptStatus: string;
    Uniquifier: string;
}

async function importHeaderAsync(v: WorkspaceEntry) {
    let userid = v.PartitionKey;
    if (v.ScriptStatus == "deleted") return;

    let toTime = (d: Date) => Math.round(d.getTime() / 1000)

    let scrjson = null
    if (v.ScriptId) {
        scrjson = await core.getPubAsync(v.ScriptId, "script")
    }

    let script = ""
    let editorState = ""

    if (v.IsLarge) {
        let blobid = v.PartitionKey + "/" + v.RowKey
        if (v.Uniquifier)
            blobid += "/" + v.Uniquifier
        let info = await largeinstalledContainer.getBlobToBufferAsync(blobid)
        if (info.succeded()) {
            let objs = decompressBlob(info.buffer());
            script = objs[0] || "";
            editorState = objs[2] || "";
        }
        else {
            throw new Error("Blob not found: " + blobid)
        }
    } else {
        script = decompress(v.PrivateCompressedScript)
        editorState = decompress(v.PrivateCompressedEditorState)
    }

    if (scrjson && v.ScriptStatus == "published") {
        let tmp = await tdliteScripts.getScriptTextAsync(scrjson["id"]);
        if (tmp)
            script = tmp["text"];
    }

    if (!script)
        throw new Error("empty script")

    let body: tdliteWorkspace.IPubBody = {
        guid: v.RowKey.slice(1).toLowerCase(),
        name: v.ScriptName,
        scriptId: scrjson ? scrjson["id"] : "",
        userId: scrjson ? scrjson["pub"]["userid"] : userid,
        status: v.ScriptStatus,
        scriptVersion: {
            instanceId: "cloud",
            baseSnapshot: "",
            time: toTime(v.LastUpdated),
            version: 1
        },
        recentUse: toTime(v.RecentUse),
        editor: "",
        meta: {},
        script: script,
        editorState: editorState,
    }

    let res = await tdliteWorkspace.saveScriptAsync(userid, tdliteWorkspace.PubBody.createFromJson(body), toTime(v.LastUpdated)*1000);
    if (res["error"])
        throw new Error("save error: " + res["error"]);
}

export async function importWorkspaceAsync(userjson: IUser) {
    if (!userjson.importworkspace)        
        return;
    
    let userid = userjson.id;
    let query = workspaceTable.createQuery().partitionKeyIs(userid).and("RowKey", "<", "C")
    query.onlyFields = ["RowKey", "ScriptStatus"];
    let entries = <WorkspaceEntry[]>await query.fetchAllAsync()
    let current = await tdliteWorkspace.getInstalledHeadersAsync(userid);
    let currDict = td.toDictionary(current, c => c.guid);
    entries = entries.filter(e => e.ScriptStatus != "deleted")
    logger.debug(`importworkspace size: ${entries.length}`)
    entries = entries.filter(e => !currDict.hasOwnProperty(e.RowKey.replace(/^B/, "").toLowerCase()))
    td.permute(entries)
    let slice = entries.slice(0, 40) 

    await parallel.forJsonAsync(slice, async(v: WorkspaceEntry) => {
        logger.debug(`import: ${v.RowKey}`)
        v = <WorkspaceEntry>await workspaceTable.getEntityAsync(userid, v.RowKey);
        logger.debug(`fetchdone: ${v.RowKey}`)
        await importHeaderAsync(v);
        logger.debug(`importdone: ${v.RowKey}`)
    }, 20)
    
    let left = entries.length - slice.length
    if (left == 0) {
        logger.info("workspace import finished for " + userid)
        await tdliteUsers.updateAsync(userid, async(v) => {
            v.importworkspace = "";
        })
    } else {
        logger.info(`workspace import will continue for ${userid}; ${left} entries left`)
    }
    
    await core.pokeSubChannelAsync("installed:" + userid);    
}

var normalFields = ["Nickname", "AboutMe", "Culture", "Email", "Gender", "HowFound", "Location", "Occupation",
                    "ProgrammingKnowledge", "RealName", "TwitterHandle", "Website"]

export async function importSettingsAsync(jsb: tdliteUsers.IUser) {
    let force = false;

    let s = await tdliteUsers.buildSettingsAsync(jsb);
    let s0 = JSON.stringify(s.toJson())
    let id = td.orEmpty(jsb["id"]);
    let res = await settingsTable.createQuery().partitionKeyIs(id).and("RowKey", "=", "$").fetchAllAsync()
    let code = 200;
    let loginid = "";
    if (res && res[0]) {
        let legacy = <LegacySettings>res[0];
        for (let k of normalFields) {
            if (legacy[k])
                s[k.toLowerCase()] = legacy[k];
        }
        if (legacy.EditorMode) s.editorMode = legacy.EditorMode;
        if (legacy.YearOfBirth) s.yearofbirth = legacy.YearOfBirth;
        if (legacy.FacebookId)
            loginid = "fb:" + legacy.FacebookId;
        
    } else {
        code = 404;
    }

    let s1 = JSON.stringify(s.toJson())


    await tdliteUsers.users.reindexAsync(id, async(v:tdliteUsers.IUser) => {
        tdliteUsers.applyUserSettings(v, s.toJson());
        if (!v["permissions"])
            v["permissions"] = ",user,";
        if (loginid)
            v["legacyLogin"] = loginid;
    }, force)

    let ret = s.toJson();
    ret["code"] = code;
    return ret;
}

function gencode() {
    let numCode = "";
    for (let i = 0; i < 16; i++) {
        numCode = numCode + td.randomRange(0, 9);
    }
    return numCode;
}

async function handleFacebookAsync(session: tdliteLogin.LoginSession) {
    let m = /^id\/fb\/(\d+)$/.exec(session.profileId);
    if (!m) return;

    let ent = await identityTable.getEntityAsync(m[1], "Facebook%002D256157661061452")
    if (!ent) return;

    let userjson = await reimportUserAsync(td.orEmpty(ent["UserId"]))
    if (!userjson) return;
    
    logger.tick("Login_fbauto")
    await session.setMigrationUserAsync(userjson["id"])
    await session.saveAsync()
}
    
// TODO throttling for emails etc

export async function handleLegacyAsync(req: restify.Request, session: tdliteLogin.LoginSession, params: {}): Promise<void> {
    if (session.askLegacy) {
        params["SESSION"] = session.state;
        params["LEGACYMSG"] = "";
        params["INNER"] = session.legacyCodes ? "emailcode" : "legacy";
        
        let prov = serverAuth.ProviderIndex.all().filter(p => p.shortname == session.providerId)[0]        
        params["PROVIDER"] = prov ? prov.name : session.providerId
    } else {
        return
    }
    
    let sett = n => td.orEmpty(req.query()["fld_" + n]).toLowerCase().trim();
    let legEmail = sett("legacyemail");
    let legId = sett("legacyid")
    let legCode = sett("legacyemailcode")
    let lang = params["LANG"];
    let err = m => params["LEGACYMSG"] = core.translateMessage(m, lang);
    let tokM = /^1([a-z]+)\.\w+$/.exec(session.oauthU)
    
    let alreadyBound = () => err("This user account was already tied to the new system.");
    
    let sendCodeEmailAsync = async(users: {}[]) => {
        let email = users[0]["settings"]["email"];
        let codes = {}
        let body = ""
        let numsent = 0
        
        // more than one user should be rather uncommon    
        for (let u of users) {
            if (u["login"]) continue;
            let code = gencode();
            codes[code] = u["id"];
            let msg = "To verify your Touch Develop user @name@, please use the following code:\n\n";
            msg = msg.replace("@name@", `${u["pub"]["name"]} (/${u["id"]})`)
            body += msg + `        ${code}\n\n`
            numsent++;
        }
        
        logger.debug("users: " + numsent + " - " + JSON.stringify(users,null,2))

        if (numsent == 0) {
            alreadyBound();
            return;
        }

        body += "If you didn't request the code, please ignore this email.\n"

        await sendgrid.sendAsync(email, "noreply@touchdevelop.com", "Verification code for touchdevelop.com user", body);

        session.legacyCodes = codes
        params["INNER"] = "emailcode";
    };
    
    if (session.storedMessage) {
        err(session.storedMessage);
        params["INNER"] = "legacy";
        session.storedMessage = null; // only show once
        await session.saveAsync();
        return;
    }
    
    await handleFacebookAsync(session);
    if (session.userCreated())
        return

    if (tokM) {
        let userjson = await tdliteUsers.getAsync(tokM[1]);
        if (userjson && userjson["migrationtoken"] === session.oauthU) {
            let ok = await session.setMigrationUserAsync(userjson["id"]);
            if (!ok) {
                alreadyBound();
                return
            }
            logger.tick("Login_migrationtoken")
        } else {
            err("Invalid migration code. Please start over.")
            return;
        }
    } else if (sett("legacyskip")) {
        logger.tick("Login_skiplegacy")
        session.askLegacy = false;
    } else if (sett("legacyrestart")) {
        session.askLegacy = true;
        session.legacyCodes = null;
        params["INNER"] = "legacy";
    } else if (sett("legacyacct")) {
        logger.tick("Login_legacystart")
        params["INNER"] = "legacylogin"
    } else if (sett("linkacct")) {
        logger.tick("Login_linkaccts")
        let redirUrl = "/oauth/providers?" + session.getRestartQuery();
        req.response.redirect(httpCode._302MovedTemporarily, redirUrl)
    } else if (emailLinkingEnabled && legEmail) {
        let users = await tdliteUsers.users.getIndex("email").fetchAllAsync(legEmail)
        if (users.length == 0) {
            err("We couldn't find this email.")
            return;
        }
        
        await sendCodeEmailAsync(users);
    } else if (emailLinkingEnabled && legId) {
        legId = legId.replace(/^\/+/, "")
        if (!/^[a-z]+$/.test(legId)) {
            err("Invalid characters in legacy user ID.")
            return
        }
        
        let u = await tdliteUsers.getAsync(legId);
        if (!u) {
            err("We couldn't find this user ID.")
            return;
        }
        
        // refresh settings
        await importSettingsAsync(u);
        u = await tdliteUsers.getAsync(legId);        
        
        if (!u["settings"] || !u["settings"]["email"]) {
            err("No email associated with that user ID. Please go to www.touchdevelop.com and set your email first.")
            return;
        }
        
        await sendCodeEmailAsync([u]);
    } else if (emailLinkingEnabled && legCode) {
        if (!/^\d+$/.test(legCode)) {
            err("Invalid characters in legacy email code")
            return
        }
        
        if (session.legacyCodes && session.legacyCodes.hasOwnProperty(legCode)) {
            let uid = session.legacyCodes[legCode]            
            let ok = await session.setMigrationUserAsync(uid);            
            if (!ok) {            
                alreadyBound();
                return
            }
            
        } else {
            err("The code is invalid; please try again")
            return            
        }
    } else {
        return
    }
    
    await session.saveAsync();
}

