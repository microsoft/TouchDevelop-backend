/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

var asArray = td.asArray;

import * as cachedStore from "./cached-store"
import * as parallel from "./parallel"
import * as core from "./tdlite-core"
import * as tdliteScripts from "./tdlite-scripts"
import * as tdliteReleases from "./tdlite-releases"
import * as tdliteImport from "./tdlite-import"
import * as tdshell from "./tdshell"

var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;
var cacheCompiler: cachedStore.Container;
var doctopics = {};
var doctopicsByTopicid = {};
export var doctopicsCss: string = "";
var cloudRelid: string = "";

export async function initAsync()
{
    cacheCompiler = await cachedStore.createContainerAsync("cachecompiler", {
        redisCacheSeconds: 600
    });
    core.addRoute("POST", "importdocs", "", async (req4: core.ApiRequest) => {
        core.checkPermission(req4, "root");
        if (req4.status == 200) {
            await importDoctopicsAsync(req4);
        }
    });
    
    core.addRoute("GET", "*script", "webapp.js", async(req) => {
        if (await core.throttleAsync(req, "webappjs", 10))
            return;
        let json = await queryCloudCompilerAsync("q/" + req.rootId + "/webapp");
        req.response = json["compiled"];
        req.responseContentType = "application/javascript";
    });
    
    // TODO this stuff should be migrated and done from here directly, not forwarded to noderunner
    core.addRoute("POST", "deploy", "*", async(req) => {
        if (!core.checkPermission(req, "azure-deploy")) return;
        
        let response = await tdshell.sendEncryptedAsync(td.serverSetting("TDC_ENDPOINT"), "worker", {
            method: "POST",
            url: "/deploy/" + req.verb,
            body: req.body
        })
                        
        let resp = {
            code: response.statusCode(),
            headers: {},
            resp: null
        }
        
        if (response.contentAsJson())
            resp = <any>response.contentAsJson();
        
        if (!resp.resp)
            req.status = httpCode._400BadRequest;
        else
            req.response = resp.resp;        
    }, { noSizeCheck: true })
}

export async function forwardToCloudCompilerAsync(req: core.ApiRequest, api: string) : Promise<void>
{
    let resp = await queryCloudCompilerAsync(api);
    if (resp == null) {
        req.status = httpCode._400BadRequest;
    }
    else {
        req.response = resp;
    }
}

export async function queryCloudCompilerAsync(api: string) : Promise<JsonObject>
{
    let totalResp: JsonObject;
    let js = (<JsonObject>null);
    let canCache = /^[\w\/\-]+$/.test(api);
    if (canCache) {
        js = await cacheCompiler.getAsync(api);
    }
    let ver = await core.getCloudRelidAsync(false);
    logger.debug(`cache=${js ? js["version"] : "none"}`)
    if (js != null && js["version"] == ver) {
        totalResp = js["resp"];
    }
    else {
        let response = await tdshell.sendEncryptedAsync(td.serverSetting("TDC_ENDPOINT"), "worker", {
            method: "GET",
            url: "/" + api
        })
        let resp = response.contentAsJson()
        if (!resp)
            resp = {
                code: response.statusCode(),
                headers: {},
                resp: null
            }
        logger.debug(`cloud compiler: ${api} -> ${resp["code"]}`);
        let respData = resp["resp"] 
        let headers = resp["headers"] || {}
        if (respData && resp["code"] == 200) {
            if (td.startsWith(headers["content-type"] || "", "application/json")) {
                totalResp = JSON.parse(respData);
            }
            else {
                totalResp = respData;
            }
        }
        else {
            totalResp = (<JsonObject>null);
            canCache = false;
        }
        logger.debug(`v=${ver}, cache=${canCache} api=${api} hd=${headers["x-touchdevelop-relid"]}`);                                 
        if (canCache && headers["x-touchdevelop-relid"] == ver) {            
            let jsb = {
                version: ver,
                resp: totalResp
            };
            await cacheCompiler.justInsertAsync(api, jsb);
            logger.debug("insert cache")
        }
    }
    return totalResp;
}

/**
 * TODO include access token for the compile service
 */
export async function deployCompileServiceAsync(rel: tdliteReleases.PubRelease, req: core.ApiRequest) : Promise<void>
{
    let cfg = {};
    let clientConfig = tdliteReleases.clientConfigForRelease(rel);
    clientConfig.doNothingText = core.fullTD ? "..." : "add code here"
    cfg["TDC_AUTH_KEY"] = "";
    cfg["TDC_ACCESS_TOKEN"] = td.serverSetting("TDC_ACCESS_TOKEN", false);
    cfg["TDC_LITE_STORAGE"] = tdliteReleases.appContainerUrl().replace(/\/[^\/]+$/g, "");
    cfg["TDC_API_ENDPOINT"] = clientConfig.rootUrl.replace(/(test|stage|live)/, "www") + "/api/";
    cfg["TD_RELEASE_ID"] = rel.releaseid;
    cfg["TD_CLIENT_CONFIG"] = JSON.stringify(clientConfig.toJson());
    let jsSrc = "";
    for (let k of Object.keys(cfg)) {
        jsSrc = jsSrc + "process.env." + k + " = " + JSON.stringify(cfg[k]) + ";\n";
    }
    jsSrc = jsSrc + "require(\"./noderunner.js\");\n";
    let deployData = {
        "files": [ {
            "path": "script/compiled.js",
            "content": jsSrc
        }, {
            "path": "script/noderunner.js",
            "url": tdliteReleases.appContainerUrl() + "/" + rel.releaseid + "/c/noderunner.js"
        }] 
    };
    let file = {};        
    //    logger.debug("cloud JS: " + JSON.stringify(deployData, null, 2));
    
    let endpoint = td.serverSetting("TDC_ENDPOINT")

    let response = await tdshell.sendEncryptedAsync(endpoint, "deploy", deployData);
    logger.info("cloud deploy: " + response.toString());

    let response2 = await tdshell.sendEncryptedAsync(endpoint, "setconfig", {
        AppSettings: [{ Name: "TD_RESTART_INTERVAL", Value: "900" }]
    })
    logger.info("cloud deploy cfg: " + response2.toString());

    // ### give it time to come up and reindex docs
    // TODO enable this back
    /*
        await td.sleepAsync(60);
        await importDoctopicsAsync(req);
        // await tdliteIndex.indexDocsAsync();
        logger.info("docs reindexed");
    */
}

export async function cacheCloudCompilerDataAsync(ver: string) : Promise<void>
{
    if (cloudRelid != ver) {
        let resp2 = /* async */ queryCloudCompilerAsync("css");
        doctopicsCss = (await resp2)["css"];
        cloudRelid = ver;
    }
}

async function importDoctopicsAsync(req: core.ApiRequest) : Promise<void>
{
    await cacheCloudCompilerDataAsync(await core.getCloudRelidAsync(true));
    let ids = asArray(doctopics).map<string>(elt => orEmpty(elt["scriptId"])).filter(elt1 => elt1 != "");
    let fetchResult = await tdliteScripts.scripts.fetchFromIdListAsync(ids, (<JsonObject>null));
    let jsb = {};
    for (let s of ids) {
        jsb[s] = true;
    }
    for (let js of fetchResult.items) {
        delete jsb[js["id"]];
    }

    let resp = new tdliteImport.RecImportResponse();
    resp.ids = {};
    ids = Object.keys(jsb);
    await parallel.forAsync(ids.length, async (x: number) => {
        await tdliteImport.importRecAsync(resp, ids[x]);
    });
    req.response = resp.toJson();
}

function topicLink(doctopic: JsonObject) : string
{
    let s: string;
    s = "<a href='/docs/" + doctopic["id"] + "'>" + core.htmlQuote(doctopic["name"]) + "</a>";
    return s;
}

function topicList(doctopic: JsonObject, childId: string, childRepl: string) : string
{
    let html: string;
    html = "<li class='active'>" + topicLink(doctopic);
    let children = doctopic["childTopics"];
    if (children != null && children.length > 0) {
        html = html + "<ul class='nav'>";
        for (let js of children) {
            let id = td.toString(js);
            if (id == childId) {
                html = html + childRepl;
            }
            else {
                if (childId == "") {
                    html = html + "<li>";
                }
                else {
                    html = html + "<li class='hidden-xs'>";
                }
                html = html + topicLink(doctopicsByTopicid[id]) + "</li>\n";
            }
        }
        html = html + "</ul>";
    }
    html = html + "</li>\n";
    let r = orEmpty(doctopic["parentTopic"]);
    if (r != "") {
        html = topicList(doctopicsByTopicid[r], doctopic["id"], html);
    }
    return html;
}

