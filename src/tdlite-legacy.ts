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
