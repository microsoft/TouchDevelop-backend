/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

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
}

var legacyTable: azureTable.Client;
var legacyBlob: azureBlobStorage.BlobService;
var settingsTable: azureTable.Table;

export async function initAsync()
{
    let pref = "LEGACY"
    legacyTable = await core.specTableClientAsync(pref);    
    legacyBlob = azureBlobStorage.createBlobService({
        storageAccount: td.serverSetting(pref + "_ACCOUNT", false),
        storageAccessKey: td.serverSetting(pref + "_KEY", false)
    });
    
    settingsTable = legacyTable.getTable("svcUSRsettings");
    
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
}

var normalFields = ["AboutMe", "Culture", "Email", "Gender", "HowFound", "Location", "Occupation",
                    "ProgrammingKnowledge", "RealName", "TwitterHandle", "Website"]

async function importSettingsAsync(jsb: {}) {
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
    // TODO reindex user to use lower-case emails!
    
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
        
        if (!u["settings"] || !u["settings"]["email"]) {
            // TODO should try to re-import settings
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
            let ok = await tdliteUsers.setProfileIdAsync(uid, session.profileId);
            
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

