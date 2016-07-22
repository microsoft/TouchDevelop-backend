/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as azureTable from "./azure-table"
import * as azureBlobStorage from "./azure-blob-storage"
import * as restify from "./restify"
import * as parallel from "./parallel"
import * as cachedStore from "./cached-store"
import * as indexedStore from "./indexed-store"
import * as core from "./tdlite-core"
import * as tdliteScripts from "./tdlite-scripts"
import * as tdliteLogin from "./tdlite-login"

var auditLogMaxAgeDays = 365;

var orEmpty = td.orEmpty;
var auditStore: indexedStore.Store;
var auditContainer: cachedStore.Container;
var auditContainerLongTerm: cachedStore.Container;
var httpCode = core.httpCode;

export class PubAuditLog
    extends core.IdObject
{
    @td.json public time: number = 0;
    @td.json public type: string = "";
    @td.json public userid: string = "";
    @td.json public subjectid: string = "";
    @td.json public publicationid: string = "";
    @td.json public publicationkind: string = "";
    @td.json public data: string = "";
    @td.json public oldvalue: JsonObject;
    @td.json public newvalue: JsonObject;
    @td.json public ip: string = "";
    @td.json public tokenid: string = "";
    static createFromJson(o:JsonObject) { let r = new PubAuditLog(); r.fromJson(o); return r; }
}

export interface IPubAuditLog {
    kind?: string;
    time?: number;
    type?: string;
    userid?: string;
    subjectid?: string;
    publicationid?: string;
    publicationkind?: string;
    data?: string;
    oldvalue?: JsonObject;
    newvalue?: JsonObject;
    ip?: string;
    tokenid?: string;
}

export async function logAsync(req: core.ApiRequest, type: string, options_0: IPubAuditLog = {}) : Promise<void>
{
    let options_ = new PubAuditLog(); options_.load(options_0);
    let msg = options_;
    msg.time = await core.nowSecondsAsync();
    if (msg.userid == "") {
        msg.userid = req.userid;
    }
    let pubkind = "";
    if (req.rootPub != null) {
        pubkind = orEmpty(req.rootPub["kind"]);
    }
    if (pubkind == "user" && msg.subjectid == "") {
        msg.subjectid = req.rootId;
    }
    if (msg.publicationid == "") {
        msg.publicationid = req.rootId;
        msg.publicationkind = pubkind;
        if (msg.subjectid == "" && pubkind != "") {
            msg.subjectid = orEmpty(req.rootPub["pub"]["userid"]);
        }
    }
    if (req.userinfo.token != null) {
        msg.tokenid = core.sha256(tdliteLogin.tokenString(req.userinfo.token)).substr(0, 10);
    }
    msg.type = type;
    msg.ip = core.encrypt(req.userinfo.ip, "AUDIT");
    //    msg.oldvalue = core.encryptJson(msg.oldvalue, "AUDIT");
    //    msg.newvalue = core.encryptJson(msg.newvalue, "AUDIT");
    let jsb = {};
    jsb["id"] = azureTable.createLogId();
    jsb["pub"] = msg.toJson();
    core.logger.debug(`inserting audit entry: ${jsb["id"]} (${type})`)
    if (type == "user-agree") {
        await auditContainerLongTerm.justInsertAsync(jsb["id"], jsb);
    }
    await auditStore.insertAsync(jsb);
    await cleanLogAsync();
}

async function cleanLogAsync(): Promise<void>
{
    if (core.fullTD) return; // no audit aging in full TD
    // only try this in 10% of cases
    if (td.randomInt(10) == 0) return;    
    let timestamp = Math.floor(Date.now()/1000 - auditLogMaxAgeDays * 24 * 3600)
    let pastId = (10000000000 - timestamp) + ".xxxxxxxx";
    let q = auditStore.getIndex("all").table.createQuery();
    q = q.partitionKeyIs("all").and("RowKey", ">=", pastId).top(200);
    let res = await q.fetchAllAsync();
    td.permute(res);
    res = res.slice(0, 50);    
    await parallel.forJsonAsync(res, async(ent) => {
        //let ee = await auditStore.container.getAsync(ent["pub"])
        let tm = 10000000000 - parseInt(ent["RowKey"].replace(/\..*/, ""))
        core.logger.debug("delete audit entry: " + ent["pub"] + " @ " + new Date(tm*1000));
        await auditStore.deleteAsync(ent["pub"]);
    })
}

export async function queryPubLogAsync(req: core.ApiRequest)
{
    return await auditStore.getIndex("publicationid").fetchAsync(req.rootId, req.queryOptions);
}

export async function initAsync() : Promise<void>
{
    let auditTableClient = await core.specTableClientAsync("AUDIT_BLOB");
    let auditBlobService = azureBlobStorage.createBlobService({
        storageAccount: td.serverSetting("AUDIT_BLOB_ACCOUNT", false),
        storageAccessKey: td.serverSetting("AUDIT_BLOB_KEY", false)
    });
    auditContainer = await cachedStore.createContainerAsync("audit", {
        blobService: auditBlobService
    });
    auditStore = await indexedStore.createStoreAsync(auditContainer, "auditlog", {
        tableClient: auditTableClient
    });
    
    auditContainerLongTerm = await cachedStore.createContainerAsync("auditlong", {
        blobService: auditBlobService
    });
    
    let store = auditStore;
    (<core.DecoratedStore><any>store).myResolve = async (fetchResult: indexedStore.FetchResult, apiRequest: core.ApiRequest) => {
        core.checkPermission(apiRequest, "audit");
        if (apiRequest.status == 200) {
            let coll = (<PubAuditLog[]>[]);
            for (let jsb of fetchResult.items) {
                let msg = PubAuditLog.createFromJson(jsb["pub"]);
                msg.ip = core.decrypt(msg.ip);
                coll.push(msg);
            }
            fetchResult.items = td.arrayToJson(coll);
        }
        else {
            fetchResult.items = ([]);
        }
    }
    ;
    await store.createIndexAsync("all", entry => "all");
    core.addRoute("GET", "audit", "", async (req: core.ApiRequest) => {
        core.checkPermission(req, "audit");
        if (req.status == 200) {
            await core.anyListAsync(store, req, "all", "all");
        }
    });
    await auditIndexAsync("userid");
    await auditIndexAsync("publicationid");
    await auditIndexAsync("subjectid");
    await auditIndexAsync("type");
    core.addRoute("GET", "audit", "long", async (req: core.ApiRequest) => {
        core.checkPermission(req, "audit");
        if (req.status == 200) {
            let r = await auditContainerLongTerm.getAsync(req.argument);
            req.response = r || { "status": "four oh four" };
        }
    });
    core.addRoute("GET", "audit", "scripttext", async (req: core.ApiRequest) => {
        core.checkPermission(req, "audit");
        if (req.status == 200) {
            let r = await auditContainer.getAsync(req.argument);
            if (!r) {
                req.status = httpCode._404NotFound;
                return;
            }
                
            let ent = PubAuditLog.createFromJson(r["pub"]);
            if (ent.type != "delete" || ent.publicationkind != "script") {
                req.status = httpCode._422UnprocessableEntity;
                return;
            }
            req.response = core.decrypt(ent.oldvalue["text"]);            
        }
    });
}

export async function auditDeleteValueAsync(js: JsonObject) : Promise<JsonObject>
{
    if (js["kind"] == "script") {
        let entry2 = await tdliteScripts.getScriptTextAsync(js["id"]);
        let jsb2 = td.clone(js);
        jsb2["text"] = core.encrypt(entry2["text"], "AUDIT");
        js = td.clone(jsb2);
    }
    return js;
}

export function buildAuditApiRequest(req: restify.Request) : core.ApiRequest
{
    let apiReq = core.buildApiRequest("/api");
    apiReq.userinfo.ip = req.remoteIp();
    return apiReq;
}

async function auditIndexAsync(field: string) : Promise<void>
{
    let store = auditStore;
    await store.createIndexAsync(field, entry => entry["pub"][field]);
    core.addRoute("GET", "audit", field, async (req: core.ApiRequest) => {
        core.checkPermission(req, "audit");
        if (req.status == 200) {
            await core.anyListAsync(store, req, field, req.argument);
        }
    });
}
