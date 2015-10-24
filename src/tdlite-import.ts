/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

var asArray = td.asArray;

import * as parallel from "./parallel"
import * as core from "./tdlite-core"

export type StringTransformer = (text: string) => Promise<string>;

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;
var importRunning: boolean = false;

export class RecImportResponse
    extends td.JsonRecord
{
    @td.json public problems: number = 0;
    @td.json public imported: number = 0;
    @td.json public present: number = 0;
    @td.json public attempts: number = 0;
    @td.json public ids: JsonBuilder;
    @td.json public force: boolean = false;
    @td.json public fulluser: boolean = false;
    static createFromJson(o:JsonObject) { let r = new RecImportResponse(); r.fromJson(o); return r; }
}

export interface IRecImportResponse {
    problems: number;
    imported: number;
    present: number;
    attempts: number;
    ids: JsonBuilder;
    force: boolean;
    fulluser: boolean;
}

async function importAnythingAsync(req: core.ApiRequest) : Promise<void>
{
    let coll = asArray(req.body);
    await parallel.forAsync(coll.length, async (x: number) => {
        let js = coll[x];
        let apiRequest = await importOneAnythingAsync(js);
        coll[x] = apiRequest.status;
    });
    req.response = td.arrayToJson(coll);
}


export async function initAsync() : Promise<void>
{
    core.addRoute("GET", "tdtext", "*", async (req1: core.ApiRequest) => {
        if (/^[a-z]+$/.test(req1.verb)) {
            let s = await td.downloadTextAsync("https://www.touchdevelop.com/api/" + req1.verb + "/text?original=true");
            req1.response = s;
        }
        else {
            req1.status = httpCode._400BadRequest;
        }
    });
    core.addRoute("POST", "import", "", async (req2: core.ApiRequest) => {
        core.checkPermission(req2, "root");
        if (req2.status == 200) {
            if (importRunning) {
                req2.status = httpCode._503ServiceUnavailable;
            }
            else {
                importRunning = true;
                await importAnythingAsync(req2);
                importRunning = false;
            }
        }
    });
    core.addRoute("POST", "import", "pubs", async (req2: core.ApiRequest) => {
        await importPubsAsync(req2);
    });
    core.addRoute("POST", "import", "*", async (req2: core.ApiRequest) => {
        await importListAsync(req2);
    });
    core.addRoute("GET", "importsync", "", async (req5: core.ApiRequest) => {
        let key = req5.queryOptions["key"];
        if (key != null && key == td.serverSetting("LOGIN_SECRET", false)) {
            if (importRunning) {
                req5.status = httpCode._503ServiceUnavailable;
            }
            else {
                importRunning = true;
                await importFromPubloggerAsync(req5);
                importRunning = false;
            }
        }
        else {
            req5.status = httpCode._402PaymentRequired;
        }
    });
    core.addRoute("POST", "recimport", "*", async (req3: core.ApiRequest) => {
        core.checkPermission(req3, "root");
        let id = req3.verb;
        if (req3.status == 200 && ! /^[a-z]+$/.test(id)) {
            req3.status = httpCode._412PreconditionFailed;
        }
        if (req3.status == 200) {
            let resp = new RecImportResponse();
            resp.ids = {};
            resp.force = core.orFalse(req3.queryOptions["force"]);
            resp.fulluser = core.orFalse(req3.queryOptions["fulluser"]);
            await importRecAsync(resp, id);
            req3.response = resp.toJson();
        }
    });
}

async function importFromPubloggerAsync(req: core.ApiRequest) : Promise<void>
{
    let entry = await core.pubsContainer.getAsync("cfg-lastsync");
    let start = 0;
    if (entry != null) {
        start = entry["start"];
    }
    let resp = {};
    let coll2 = (<JsonObject[]>[]);
    let continuation = "&fake=blah";
    let lastTime = start;
    while (continuation != "") {
        logger.info("download from publogger: " + start + " : " + continuation);
        let js2 = await td.downloadJsonAsync("http://tdpublogger.azurewebsites.net/syncpubs?count=30&start=" + start + continuation);
        await parallel.forJsonAsync(js2["items"], async (json: JsonObject) => {
            lastTime = json["notificationtime"];
            await importDownloadPublicationAsync(json["id"], resp, coll2);
        });
        let cont = orEmpty(js2["continuation"]);
        if (coll2.length > 30 || cont == "") {
            continuation = "";
        }
        else {
            continuation = "&continuation=" + cont;
        }
    }
    for (let js4 of coll2) {
        let apiRequest = await importOneAnythingAsync(js4);
        resp[js4["id"]] = apiRequest.status;
    }
    await core.pubsContainer.updateAsync("cfg-lastsync", async (entry1: JsonBuilder) => {
        let r = core.orZero(entry1["start"]);
        entry1["start"] = Math.max(r, lastTime);
    });
    req.response = td.clone(resp);
}

async function importOneAnythingAsync(js: JsonObject) : Promise<core.ApiRequest>
{
    let apiRequest: core.ApiRequest;
    let entry = await core.pubsContainer.getAsync(js["id"]);
    apiRequest = new core.ApiRequest();
    apiRequest.status = 200;
    if ( ! core.isGoodEntry(entry)) {
        let kind = orEmpty(js["kind"])
        let desc = core.getPubKind(kind)

        if (!desc)
            apiRequest.status = httpCode._422UnprocessableEntity;
        else if (desc.importOne)
            await desc.importOne(apiRequest, js)
        else
            apiRequest.status = httpCode._405MethodNotAllowed;


        logger.info("import " + kind + " /" + js["id"] + ": " + apiRequest.status);
    }
    else {
        apiRequest.status = httpCode._409Conflict;
    }
    return apiRequest;
}

var tdbaseUrl = "https://www.touchdevelop.com/api/"
var allowedLists = [
    "new-scripts",
    "comments",
    "art",
    "screenshots",
    "groups",
    "reviews",
    "users",
    "tags",
]

async function importPubsAsync(req: core.ApiRequest) {
    if (!core.checkPermission(req, "root"))
        return;

    let coll: {}[] = [];
    let resp = {};
    for (let pub of req.argument.split(/[,\s]+/).filter(e => !!e)) {
        await importDownloadPublicationAsync(pub, resp, coll);
    }
    for (let suppl of coll) {
        let apiRequest = await importOneAnythingAsync(suppl);
        resp[suppl["id"]] = apiRequest.status;
    }

    req.response = {
        continuation: "",
        publications: resp,
    };
}

async function importListAsync(req: core.ApiRequest) {
    if (!core.checkPermission(req, "root"))
        return;

    let list = req.verb;

    if (allowedLists.indexOf(list) < 0) {
        req.status = httpCode._404NotFound;
        return;
    }

    let count = core.orZero(req.queryOptions["count"]);
    let max = 100;
    //if (/scripts/.test(list)) max = 50;    
    count = td.clamp(20, max, count)

    let continuation = orEmpty(req.queryOptions["continuation"]);
    if (continuation)
        continuation = "&continuation=" + encodeURIComponent(continuation);
    let url = `${tdbaseUrl}${list}?count=${count}${continuation}`;
    let js = await td.downloadJsonAsync(url);

    if (!js) {
        logger.warning("bad response from TD: " + url)
        req.status = httpCode._424FailedDependency;
        return;
    }

    let resp = {};
    await parallel.forJsonAsync(js["items"], async(e) => {
        try {
            if (e["kind"] == "script" && await core.getPubAsync(e["id"], "script")) {
                resp[e["id"]] = 409;
                return;
            }
            let suppl = await core.retryWithTimeoutAsync(1, 15000, () => downloadSupplementalAsync(e, resp));
            if (suppl) {
                let apiRequest = await importOneAnythingAsync(suppl);
                resp[e["id"]] = apiRequest.status;
            }
        } catch (ee) {
            if (/TIMEDOUT/.test(ee.message))
                resp[e["id"]] = 500;
            else throw ee;
        }
    }, 20);

    req.response = {
        continuation: js["continuation"],
        publications: resp,
    };
}

async function downloadSupplementalAsync(js: JsonObject, resp: JsonBuilder): Promise<JsonObject> {
    let id = js["id"];
    let url = tdbaseUrl + id;
    if (js["kind"] == "script") {
        let jsb = td.clone(js);
        jsb["baseid"] = "";
        if (js["rootid"] != id) {
            let js3 = await td.downloadJsonAsync(url + "/base");
            if (js3)
                jsb["baseid"] = js3["id"];
        }
        let s2 = "";
        if (jsb["time"] < 1420099200) {            
            let tmp = await td.downloadJsonAsync("https://tdlite.blob.core.windows.net/scripttext/" + id)
            if (tmp) {
                
                s2 = orEmpty(tmp["text"]);
            } else {
                logger.debug("missed on tdlite: " + id)
            }
        }
        if (!s2)
            s2 = await td.downloadTextAsync(url + "/text?original=true");
        jsb["text"] = s2;        
        return jsb;
    }
    else if (/^(runbucket|run|webapp)$/.test(js["kind"])) {
        return <{}>null;
    }
    else {
        return js;
    }
}

async function importDownloadPublicationAsync(id: string, resp: JsonBuilder, coll2: JsonObject[]): Promise<void> {
    let existingEntry = await core.pubsContainer.getAsync(id);
    if (!core.isGoodEntry(existingEntry)) {
        let url = tdbaseUrl + id;
        let js = await td.downloadJsonAsync(url);
        if (js == null) {
            resp[id] = httpCode._404NotFound;
        }
        else {
            let js2 = await downloadSupplementalAsync(js, resp);
            if (js2) coll2.push(js2);
        }
    } else {
        resp[id] = httpCode._409Conflict;
    }
}

export async function importRecAsync(resp: RecImportResponse, id: string) : Promise<void>
{
    resp.attempts += 1;
    let full = resp.fulluser;
    resp.fulluser = false;

    if (! id || resp.ids.hasOwnProperty(id)) {
    }
    else {
        resp.ids[id] = 0;
        let isThere = core.isGoodEntry(await core.pubsContainer.getAsync(id));
        if (isThere && ! resp.force && ! full) {
            resp.ids[id] = 409;
            resp.present += 1;
        }
        else {
            let tdapi = "https://www.touchdevelop.com/api/";
            let js = await td.downloadJsonAsync(tdapi + id);
            if (js == null) {
                resp.problems += 1;
            }
            else {
                let coll = []
                coll.push(/* async */ importRecAsync(resp, js["userid"]));
                let kind = js["kind"];
                if (kind == "script") {
                    let jsb = td.clone(js);
                    if (js["rootid"] != js["id"]) {
                        let js2 = await td.downloadJsonAsync(tdapi + id + "/base");
                        if (js2 != null) {
                            jsb["baseid"] = js2["id"];
                        }
                    }
                    await importRecAsync(resp, jsb["baseid"]);
                    let s = await td.downloadTextAsync(tdapi + id + "/text?original=true&ids=true");
                    jsb["text"] = withDefault(s, "no text");
                    js = td.clone(jsb);
                }

                if ( ! isThere) {
                    let apiRequest = await importOneAnythingAsync(js);
                    if (apiRequest.status == 200) {
                        resp.imported += 1;
                    }
                    else {
                        resp.problems += 1;
                    }
                }

                if (kind == "script") {
                    for (let js3 of js["librarydependencyids"]) {
                        coll.push(/* async */ importRecAsync(resp, td.toString(js3)));
                    }
                    for (let js31 of js["mergeids"]) {
                        coll.push(/* async */ importRecAsync(resp, td.toString(js31)));
                    }
                }

                coll.push(/* async */ importDepsAsync(resp, js, tdapi, id, "art"));
                coll.push(/* async */ importDepsAsync(resp, js, tdapi, id, "comments"));
                for (let task of coll) {
                    await task;
                }
                resp.ids[id] = 200;
                if (full && kind == "user") {
                    /* async */ importUserScriptsAsync(resp, tdapi, id);
                }
            }
        }
    }
}

async function importDepsAsync(resp: RecImportResponse, js: JsonObject, tdapi: string, id: string, kind: string) : Promise<void>
{
    if (core.orZero(js[kind]) > 0) {
        let js4 = await td.downloadJsonAsync(tdapi + id + "/" + kind + "?count=1000");
        await parallel.forJsonAsync(js4["items"], async (json: JsonObject) => {
            await importRecAsync(resp, json["id"]);
        });
    }
}

async function importUserScriptsAsync(resp: RecImportResponse, tdapi: string, id: string) : Promise<void>
{
    let keepGoing = true;
    let cont = "";
    while (keepGoing) {
        let js4 = await td.downloadJsonAsync(tdapi + id + "/scripts?applyupdates=true&count=50" + cont);
        await parallel.forJsonAsync(js4["items"], async (json: JsonObject) => {
            await importRecAsync(resp, json["id"]);
        });
        let r = orEmpty(js4["continuation"]);
        logger.info("import batch for " + id + " cont= " + r);
        if (r != "") {
            cont = "&continuation=" + r;
        }
        else {
            keepGoing = false;
        }
    }
}

