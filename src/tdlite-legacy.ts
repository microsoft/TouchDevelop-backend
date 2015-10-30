/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as zlib from 'zlib';

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

var logger = core.logger;
var httpCode = core.httpCode;

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
var largeinstalledContainer: azureBlobStorage.Container;

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
    largeinstalledContainer = legacyBlob.getContainer("largeinstalled");
    
    core.addRoute("POST", "*user", "importsettings", async (req: core.ApiRequest) => {
        if (!core.checkPermission(req, "operator")) return;
        req.response = await importSettingsAsync(req.rootPub)
    });
   
    core.addRoute("POST", "import", "usersettings", async(req: core.ApiRequest) => {
        if (!core.checkPermission(req, "operator")) return;
        let entities = await tdliteUsers.users.getIndex("all").fetchAsync("all", req.queryOptions);
        let resp = {}
        await parallel.forJsonAsync(entities.items, async(v) => {
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
        await core.pubsContainer.updateAsync(req.rootId, async(v) => {
            v["importworkspace"] = "1";
        })
        req.response = {};                
    });   
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

    let res = await tdliteWorkspace.saveScriptAsync(userid, tdliteWorkspace.PubBody.createFromJson(body), toTime(v.LastUpdated));
    if (res["error"])
        throw new Error("save error: " + res["error"]);
}

export async function importWorkspaceAsync(userjson: {}) {
    if (!userjson["importworkspace"])
        return;
    
    let userid = userjson["id"];
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
        await core.pubsContainer.updateAsync(userid, async(v) => {
            v["importworkspace"] = "";
        })
    } else {
        logger.info(`workspace import will continue for ${userid}; ${left} entries left`)
    }
    
    await core.pokeSubChannelAsync("installed:" + userid);    
}

var normalFields = ["Nickname", "AboutMe", "Culture", "Email", "Gender", "HowFound", "Location", "Occupation",
                    "ProgrammingKnowledge", "RealName", "TwitterHandle", "Website"]

export async function importSettingsAsync(jsb: {}) {
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


    await tdliteUsers.users.reindexAsync(id, async(v) => {
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

export async function handleLegacyAsync(req: restify.Request, session: tdliteLogin.LoginSession, params: {}): Promise<void> {
    if (session.askLegacy) {
        params["SESSION"] = session.state;
        params["LEGACYMSG"] = "";
    }
    
    let sett = n => td.orEmpty(req.query()["fld_" + n]).toLowerCase().trim();
    let legEmail = sett("legacyemail");
    let legId = sett("legacyid")
    let legCode = sett("legacyemailcode")
    let lang = params["LANG"];
    let err = m => params["LEGACYMSG"] = core.translateMessage(m, lang);
    
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
    };


    
    if (sett("legacyskip")) {
        session.askLegacy = false;
    } else if (sett("legacyrestart")) {
        session.askLegacy = true;
        session.legacyCodes = null;
    } else if (legEmail) {
        let users = await tdliteUsers.users.getIndex("email").fetchAllAsync(legEmail)
        if (users.length == 0) {
            err("We couldn't find this email.")
            return;
        }
        
        await sendCodeEmailAsync(users);
    } else if (legId) {
        legId = legId.replace(/^\/+/, "")
        if (!/^[a-z]+$/.test(legId)) {
            err("Invalid characters in legacy user ID.")
            return
        }
        
        let u = await core.getPubAsync(legId, "user");
        if (!u) {
            err("We couldn't find this user ID.")
            return;
        }
        
        // refresh settings
        await importSettingsAsync(u);
        u = await core.getPubAsync(legId, "user");        
        
        if (!u["settings"] || !u["settings"]["email"]) {
            err("No email associated with that user ID. Please go to www.touchdevelop.com and set your email first.")
            return;
        }
        
        await sendCodeEmailAsync([u]);
    } else if (legCode) {
        if (!/^\d+$/.test(legCode)) {
            err("Invalid characters in legacy email code")
            return
        }
        
        if (session.legacyCodes && session.legacyCodes.hasOwnProperty(legCode)) {
            let uid = session.legacyCodes[legCode]            
            let ok = await tdliteUsers.setProfileIdFromLegacyAsync(uid, session.profileId);
            
            if (!ok) {            
                alreadyBound();
                return
            }
            
            session.userid = uid
            session.askLegacy = false
            
        } else {
            err("The code is invalid; please try again")
            return            
        }
    } else {
        return
    }
    
    await session.saveAsync();
}

