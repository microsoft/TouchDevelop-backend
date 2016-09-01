/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as azureBlobStorage from "./azure-blob-storage"
import * as cachedStore from "./cached-store"
import * as indexedStore from "./indexed-store"
import * as restify from "./restify"
import * as core from "./tdlite-core"
import * as audit from "./tdlite-audit"
import * as tdliteTdCompiler from "./tdlite-tdcompiler"
import * as tdlitePointers from "./tdlite-pointers"
import * as tdliteUsers from "./tdlite-users"
import * as tdliteScripts from "./tdlite-scripts"

export type StringTransformer = (text: string) => Promise<string>;

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;
var releases: indexedStore.Store;
var filesContainer: azureBlobStorage.Container;
var mainReleaseName: string = "";
// TODO this is used in tdlite-pointers; it should use a different container instead
export var cacheRewritten: cachedStore.Container;
var appContainer: azureBlobStorage.Container;

export class PubRelease
    extends core.Publication {
    @td.json public releaseid: string = "";
    @td.json public labels: IReleaseLabel[];
    @td.json public commit: string = "";
    @td.json public branch: string = "";
    @td.json public pkgversion: string = "";
    @td.json public buildnumber: number = 0;
    @td.json public version: string = "";
    @td.json public name: string = "";
    @td.json public cdnUrl: string = "";
    @td.json public baserelease: string = "";
    @td.json public target: string = "";
    @td.json public type: string = "";
    static createFromJson(o: JsonObject) { let r = new PubRelease(); r.fromJson(o); return r; }
}

export interface IReleaseLabel {
    name: string;
    userid: string;
    time: number;
    releaseid: string;
    relid: string;
    numpokes: number;
}

export function appContainerUrl() {
    return appContainer.url();
}

export async function initAsync(): Promise<void> {
    mainReleaseName = withDefault(td.serverSetting("MAIN_RELEASE_NAME", true), "current");
    cacheRewritten = await cachedStore.createContainerAsync("cacherewritten", {
        inMemoryCacheSeconds: 15,
        redisCacheSeconds: 3600
    });
    appContainer = await core.blobService.createContainerIfNotExistsAsync("app", "hidden");
    filesContainer = await core.blobService.createContainerIfNotExistsAsync("files", "hidden");

    releases = await indexedStore.createStoreAsync(core.pubsContainer, "release");
    await core.setResolveAsync(releases, async(fetchResult: indexedStore.FetchResult, apiRequest: core.ApiRequest) => {
        await core.addUsernameEtcAsync(fetchResult);
        let coll = (<PubRelease[]>[]);
        let labels = <IReleaseLabel[]>[];
        let entry3 = core.getSettings("releases");
        if (entry3 != null && entry3["ids"] != null) {
            let js = entry3["ids"];
            for (let k of Object.keys(js)) {
                labels.push(js[k]);
            }
        }
        for (let jsb of fetchResult.items) {
            let rel = PubRelease.createFromJson(jsb["pub"]);
            rel.labels = labels.filter(elt => elt.releaseid == rel.releaseid);
            let ver = orEmpty(rel.version);
            if (ver == "") {
                rel.name = rel.releaseid.replace(/.*-/g, "");
            }
            else {
                rel.name = withDefault(rel.branch, rel.releaseid.replace(/.*-\d*/g, "")) + " " + ver;
            }
            rel.cdnUrl = core.currClientConfig.primaryCdnUrl + "/app/" + rel.releaseid + "/c/"
            coll.push(rel);
        }
        fetchResult.items = td.arrayToJson(coll);
    }, { byUserid: true });

    await releases.createIndexAsync("target", entry => entry["pub"]["target"] || "none");
    core.addRoute("GET", "releases", "bytarget", async(req: core.ApiRequest) => {
        await core.anyListAsync(releases, req, "target", req.argument);
    });

    core.addRoute("GET", "releasecfg", "*", async(req: core.ApiRequest) => {
        req.response = {

        }
    });

    core.addRoute("POST", "releases", "", async(req: core.ApiRequest) => {
        let baseid = orEmpty(req.body["baserelease"])

        if (baseid)
            core.checkPermission(req, "upload-target");
        else
            core.checkPermission(req, "upload");

        if (req.status == 200) {
            let baseRel = null
            if (baseid) {
                baseRel = await core.getPubAsync(baseid, "release")
                if (!baseRel) {
                    req.status = httpCode._404NotFound
                    return
                }
                // no uploading of targets against other targets
                if (baseRel["pub"]["baserelease"]) {
                    req.status = httpCode._400BadRequest
                    return
                }
            }

            let rel = new PubRelease();
            rel.userid = req.userid;
            rel.time = await core.nowSecondsAsync();
            rel.releaseid = td.toString(req.body["releaseid"]);
            rel.commit = orEmpty(req.body["commit"]);
            rel.branch = orEmpty(req.body["branch"]);
            rel.pkgversion = orEmpty(req.body["pkgversion"]);
            rel.buildnumber = core.orZero(req.body["buildnumber"]);
            rel.baserelease = baseid
            rel.target = orEmpty(req.body["target"])
            if (!core.isValidTargetName(rel.target)) rel.target = ""
            rel.type = orEmpty(req.body["type"]) && baseRel ? "target" : ""

            if (!baseid && req.body["type"] === "fulltarget")
                rel.type = "fulltarget"

            if (core.pxt) {
                rel.releaseid = ""
            } else {
                if (!looksLikeReleaseId(rel.releaseid)) {
                    req.status = httpCode._412PreconditionFailed;
                    return
                }
            }

            await core.updateSettingsAsync("releaseversion", async(entry: JsonBuilder) => {
                let x = core.orZero(entry[core.releaseVersionPrefix]) + 1;
                entry[core.releaseVersionPrefix] = x;
                rel.version = core.releaseVersionPrefix + "." + x + "." + rel.buildnumber;
            });
            let jsb = {};
            await core.generateIdAsync(jsb, 5);
            if (!rel.releaseid) rel.releaseid = jsb["id"];
            jsb["pub"] = rel.toJson();
            let key = "rel-" + rel.releaseid;

            if (rel.baserelease && !rel.type) {
                let files = ["index.html", "worker.js", "embed.js", "run.html", "docs.html", "release.manifest"]
                let cdnUrl = core.currClientConfig.primaryCdnUrl + "/app/" + rel.baserelease + "/c/"
                for (let fn of files) {
                    let res = await appContainer.getBlobToTextAsync(rel.baserelease + "/" + fn)
                    if (!res.succeded()) continue
                    let idx = res.text()
                    idx = idx.replace('"./embed.js"', `"/app/embed.js?r=${rel.releaseid}"`)
                    idx = idx.replace(/"\.\//g, "\"" + cdnUrl)
                    idx = idx.replace(/"sim\//, "\"./")
                    let contentType = /html/.test(fn) ? "text/html; charset=utf8" : "application/javascript; charset=utf8"
                    await saveFileToCdnAsync(rel.releaseid, fn, contentType, new Buffer(idx, "utf8"))
                }
            }

            let ok = await core.tryInsertPubPointerAsync(key, jsb["id"]);
            if (ok) {
                await releases.insertAsync(jsb);
                await core.returnOnePubAsync(releases, td.clone(jsb), req);
            }
            else {
                let entry1 = await core.getPointedPubAsync(key, "release");
                await core.returnOnePubAsync(releases, entry1, req);
            }
        }
    });

    async function saveFileToCdnAsync(relid: string, fn: string, contentType: string, buf: Buffer) {
        let result = await appContainer.createBlockBlobFromBufferAsync(relid + "/" + fn, buf, {
            contentType: contentType
        });
        result = await appContainer.createGzippedBlockBlobFromBufferAsync(relid + "/c/" + fn, buf, {
            contentType: contentType,
            cacheControl: "public, max-age=31556925",
            smartGzip: true
        });
    }

    core.addRoute("POST", "*release", "files", async(req2: core.ApiRequest) => {
        let rel = PubRelease.createFromJson(req2.rootPub["pub"]);
        let isTrg = !!rel.baserelease
        core.checkPermission(req2, isTrg ? "upload-target" : "upload");
        if (req2.status == 200) {
            let body = req2.body;
            let buf = new Buffer(orEmpty(body["content"]), orEmpty(body["encoding"]));
            let fn = td.toString(body["filename"])
            if (isTrg && !/\.json$/.test(fn) && !/^sim/.test(fn)) {
                req2.status = httpCode._415UnsupportedMediaType
                return
            }
            let request = td.createRequest(filesContainer.url() + "/overrideupload/" + fn);
            let response = await request.sendAsync();
            if (response.statusCode() == 200) {
                buf = response.contentAsBuffer();
            }
            await saveFileToCdnAsync(rel.releaseid, fn, td.toString(body["contentType"]), buf)
            req2.response = ({ "status": "ok" });
        }
    }, { sizeCheckExcludes: "content" });

    core.addRoute("POST", "*release", "label", async(req3: core.ApiRequest) => {
        let name = orEmpty(req3.body["name"]);
        if (!isKnownReleaseName(name)) {
            req3.status = httpCode._412PreconditionFailed;
        }
        if (req3.status == 200) {
            core.checkPermission(req3, "lbl-" + name);
        }
        if (req3.status == 200) {
            let rel3 = PubRelease.createFromJson(req3.rootPub["pub"]);
            let lab: IReleaseLabel = <any>{};
            lab.name = name;
            lab.time = await core.nowSecondsAsync();
            lab.userid = req3.userid;
            lab.releaseid = rel3.releaseid;
            lab.relid = rel3.id;
            lab.numpokes = 0;
            await audit.logAsync(req3, "lbl-" + lab.name);
            await core.updateSettingsAsync("releases", async(entry2: JsonBuilder) => {
                let jsb2 = entry2["ids"];
                if (jsb2 == null) {
                    jsb2 = {};
                    entry2["ids"] = jsb2;
                }
                jsb2[lab.name] = lab;
                core.bareIncrement(entry2, "updatecount");
            });
            if (name == "cloud") {
                /* async */ pokeReleaseAsync(name, 15);
                /* async */ tdliteTdCompiler.deployCompileServiceAsync(rel3, req3);
            }
            req3.response = ({});
        }
    });
    core.addRoute("POST", "pokecloud", "", async(req4: core.ApiRequest) => {
        await pokeReleaseAsync("cloud", 0);
        req4.response = {}
    });
    core.addRoute("POST", "upload", "files", async(req4: core.ApiRequest) => {
        if (td.startsWith(orEmpty(req4.body["filename"]).toLowerCase(), "override")) {
            core.checkPermission(req4, "root");
        }
        else {
            core.checkPermission(req4, "web-upload");
        }
        if (req4.status == 200) {
            let body1 = req4.body;
            let buf1 = new Buffer(orEmpty(body1["content"]), orEmpty(body1["encoding"]));
            let result1 = await filesContainer.createGzippedBlockBlobFromBufferAsync(td.toString(body1["filename"]), buf1, {
                contentType: body1["contentType"],
                cacheControl: "public, max-age=3600",
                smartGzip: true
            });
            req4.response = ({ "status": "ok" });
        }
    }, { sizeCheckExcludes: "content" });

    core.addRoute("GET", "language", "touchdevelop.tgz", async(req: core.ApiRequest) => {
        let r = core.getSettings("releases")["ids"] || {}
        let labl = <IReleaseLabel>r["cloud"]
        if (labl) {
            req.status = httpCode._302MovedTemporarily;
            req.headers = {
                "location": core.currClientConfig.primaryCdnUrl + "/app/" + labl.releaseid + "/touchdevelop.tgz"
            }
        } else {
            req.status = httpCode._404NotFound;
        }
    });
}


function looksLikeReleaseId(s: string): boolean {
    let b: boolean;
    b = /^\d\d\d\d\d\d\d\d\d\d[a-zA-Z\d\.\-]+$/.test(s);
    return b;
}

async function rewriteIndexAsync(rel: string, relid: string, text: string) {
    let relpub = await core.getPointedPubAsync("rel-" + relid, "release");
    let prel = PubRelease.createFromJson(relpub["pub"]);
    let ccfg = clientConfigForRelease(prel);
    ccfg.releaseLabel = rel;
    let ver = orEmpty(relpub["pub"]["version"]);
    let shortrelid = td.toString(relpub["id"]);
    if (core.basicCreds == "") {
        text = td.replaceAll(text, "data-manifest=\"\"", "manifest=\"app.manifest?releaseid=" + encodeURIComponent(rel) + "\"");
    }
    let suff = "?releaseid=" + encodeURIComponent(relid) + "\"";
    text = td.replaceAll(text, "\"browsers.html\"", "\"/app/browsers.html" + suff);
    text = td.replaceAll(text, "\"error.html\"", "\"/app/error.html" + suff);
    text = td.replaceAll(text, "\"./", "\"" + core.currClientConfig.primaryCdnUrl + "/app/" + relid + "/c/");
    let verPref = "var tdVersion = \"" + ver + "\";\n" + "var tdConfig = " + JSON.stringify(ccfg.toJson(), null, 2) + ";\n";
    text = td.replaceAll(text, "var rootUrl = ", verPref + "var tdlite = \"url\";\nvar rootUrl = ");
    if (rel != "current") {
        text = td.replaceAll(text, "betaFriendlyId = \"\"", "betaFriendlyId = \"beta " + withDefault(ver, relid.replace(/.*-/g, "")) + "\"");
    }
    return text;
}

export async function serveWebAppAsync(req: restify.Request, res: restify.Response): Promise<void> {
    let rel = "cloud";
    let entry = core.getSettings("releases");
    let js = entry["ids"][rel];
    let relid = js["releaseid"];

    if (await core.throttleCoreAsync(core.sha256(req.remoteIp()) + ":webapp", 10)) {
        res.sendError(httpCode._429TooManyRequests, "Too many web app reqs");
        return;
    }

    let m = /^\/userapp\/(([^\/]*)\/)?([a-z]+)(=?)($|\?)/.exec(req.url())
    if (!m) {
        res.redirect(httpCode._302MovedTemporarily, "/invalid-webapp")
        return;
    }
    let usernameInUrl = m[2] || ""
    let wid = m[3]
    let eq = m[4]

    let scr = await core.getPubAsync(wid, "script");
    if (!scr) {
        res.redirect(httpCode._302MovedTemporarily, "/no-such-webapp")
        return;
    }

    let userjson = await tdliteUsers.getAsync(scr["pub"]["userid"]);
    if (!userjson) {
        // strange...
        res.redirect(httpCode._302MovedTemporarily, "/no-such-webapp-user")
        return;
    }

    let uname = userjson.pub.name.replace(/[^A-Za-z0-9]/g, "") || "someone"

    if (usernameInUrl != uname) {
        res.redirect(httpCode._302MovedTemporarily, "/userapp/" + uname + "/" + wid + eq)
        return;
    }

    if (!eq) {
        let ujson = await core.pubsContainer.getAsync(scr["updateKey"])
        let uid = ujson["scriptId"]
        if (uid != scr["id"]) {
            let uscr = await core.getPubAsync(uid, "script");
            if (uscr && uscr["pub"]["time"] > scr["pub"]["time"])
                scr = uscr;
        }
    }

    wid = scr["id"];

    await rewriteAndCacheAsync(rel + "-" + wid, relid, "webapp.html", "text/html", res, async(text) => {
        text = await rewriteIndexAsync(rel, relid, text);
        text = text.replace("precompiled.js?a=", "/api/" + wid + "/webapp.js")
        return text;
    });
}

export async function serveReleaseAsync(req: restify.Request, res: restify.Response): Promise<void> {
    let coll = (/^([^\?]+)(\?.*)$/.exec(req.url()) || []);
    let fn = req.url();
    let query = "";
    if (coll[1] != null) {
        fn = coll[1];
        query = coll[2];
    }
    fn = fn.replace(/^\/app\//g, "");
    if (fn.endsWith("/")) {
        res.redirect(301, "/app/" + fn.replace(/\/+$/g, "") + query);
        return;
    }
    let rel = mainReleaseName;
    if (isKnownReleaseName(fn)) {
        rel = fn;
        fn = "";
    }
    rel = withDefault(req.query()["releaseid"], withDefault(req.query()["r"], rel));

    let targetFromHost = ""
    let host = (req.header("host") || "").toLowerCase()
    if (core.serviceSettings.targetsDomain && host.startsWith("trg-") && host.endsWith("." + core.serviceSettings.targetsDomain)) {
        targetFromHost = host.slice(4, host.length - 1 - core.serviceSettings.targetsDomain.length)
    }
    let targetIsMatching = false

    let relid = "";
    if (looksLikeReleaseId(rel)) {
        relid = rel;
    }
    else {
        let entry = core.getSettings("releases");
        let js = entry["ids"][rel];
        if (js == null) {
            let entry3 = await core.getPubAsync(rel, "release");
            if (entry3 == null) {
                res.sendError(404, "no such release: " + rel);
                return
            }
            else {
                if (targetFromHost && entry3["pub"]["target"] === targetFromHost)
                    targetIsMatching = true
                relid = entry3["pub"]["releaseid"];
            }
        }
        else {
            relid = js["releaseid"];
        }
    }

    if (fn == "simulator.html" || fn == "sim.manifest" || fn == "siminstructions.html") {
        if (!targetIsMatching) {
            res.sendError(404, "simulator.html only available on trg-..., not on " + targetFromHost);
            return
        }
    } else {
        targetIsMatching = false
    }

    if (!targetIsMatching && targetFromHost) {
        // do not serve anything except for simulator.html from "trg-XYZ.mydomain.net"
        res.redirect(301, core.self + req.url().slice(1));
        return;
    }

    if (relid != "") {
        if (fn == "" && relid == "2519967637668242448-920d9e58.a88e.4fa8.bcd1.9be5ba29da9f-workerjs") {
            let s = await tdlitePointers.simplePointerCacheAsync("/worker.js", []) || "";
            res.sendText(s, "application/javascript");
        }
        else if (fn == "") {
            if (core.pxt && (rel == "current" || rel == "latest" || rel == "beta"))
                res.redirect(httpCode._302MovedTemporarily, "/microbit");
            await rewriteAndCacheAsync(rel, relid, "index.html", "text/html", res, async(text: string) => {
                return await rewriteIndexAsync(rel, relid, text)
            });
        }
        else if (fn == "simulator.html" || fn == "sim.manifest") {
            await rewriteAndCacheAsync(rel, relid, fn, /html/.test(fn) ? "text/html" : "text/cache-manifest", res, async(text2: string) => {
                return await getLegacyRewrittenIndexAsync("/app/sim.manifest?r=" + relid, relid, fn)
            });
        }
        else if (/\.manifest$/.test(fn)) {
            await rewriteAndCacheAsync(rel, relid, "app.manifest", "text/cache-manifest", res, async(text: string) => {
                let result1: string;
                text = td.replaceAll(text, "../../../", core.currClientConfig.primaryCdnUrl + "/");
                text = td.replaceAll(text, "./", core.currClientConfig.primaryCdnUrl + "/app/" + relid + "/c/");
                text = text + "\n# v" + core.rewriteVersion + "\n";
                result1 = text;
                return result1;
            });
        }
        else if (/\.browsers$/.test(fn)) {
            res.redirect(httpCode._301MovedPermanently, "/app/browsers.html");
        }
        else if (/\.error$/.test(fn)) {
            res.redirect(httpCode._301MovedPermanently, "/app/error.html");
        }
        else if (fn == "error.html" || fn == "browsers.html") {
            await rewriteAndCacheAsync(rel, relid, fn, "text/html", res, async(text2: string) => {
                return td.replaceAll(text2, "\"./", "\"" + core.currClientConfig.primaryCdnUrl + "/app/" + relid + "/c/");
            });
        }
        /*
        else if (fn == "worker.js" || fn == "embed.js") {
            await rewriteAndCacheAsync(rel, relid, fn, "application/javascript", res, async(text2: string) => {
                if (core.pxt) {
                    let xrel = await core.getPubAsync(relid, "release")
                    text2 = patchSimHtml(text2, xrel)
                }
                return td.replaceAll(text2, "\"./", "\"" + core.currClientConfig.primaryCdnUrl + "/app/" + relid + "/c/");
            });
        }
        */
        else {
            res.sendError(404, "get file from CDN");
        }
    }
}

function patchSimHtml(idx: string, rel: JsonObject) {
    if (!rel) return idx
    let pub = rel["pub"]
    let dom = core.serviceSettings.targetsDomain
    idx = idx.replace(/\/sim\/simulator\.html/, `https://trg-${pub["target"]}.${dom}/app/simulator.html?r=${rel["id"]}`);
    return idx
}

function isKnownReleaseName(fn: string): boolean {
    let b: boolean;
    b = /^(beta|current|latest|cloud)$/.test(fn);
    return b;
}

export async function getLegacyRewrittenIndexAsync(manifest: string, id: string, srcFile: string) {
    let relpub = await core.getPubAsync(id, "release");
    if (!relpub) return "Release deleted."

    let prel = PubRelease.createFromJson(relpub["pub"]);

    let baserelid = prel.releaseid

    let info = await appContainer.getBlobToTextAsync(prel.releaseid + "/" + srcFile);
    let text = info.text()

    if (!info.text()) return srcFile + " missing"

    let baseRel = null
    if (prel.baserelease) {
        baseRel = await core.getPubAsync(prel.baserelease, "release")
        if (baseRel) baserelid = baseRel["id"]
    }

    let ccfg = clientConfigForRelease(prel);
    ccfg.releaseLabel = manifest;
    let ver = orEmpty(relpub["pub"]["version"]);
    if (manifest /*&& core.basicCreds == ""*/) {
        text = td.replaceAll(text, "data-manifest=\"\"", `manifest="${manifest}"`);
    }
    let suff = "?r=" + encodeURIComponent(id);
    //text = td.replaceAll(text, "\"browsers.html\"", "\"/app/browsers.html" + suff);
    //text = td.replaceAll(text, "\"error.html\"", "\"/app/error.html" + suff);    
    text = td.replaceAll(text, '"embed.js"', '"/app/embed.js' + suff + '"');
    //logger.debug(`after repl: ${text}`)
    let simCdn = core.currClientConfig.primaryCdnUrl + "/app/" + prel.releaseid + "/c/"
    let trgCdn = core.currClientConfig.primaryCdnUrl + "/app/" + baserelid + "/c/"
    text = td.replaceAll(text, "\"./", "\"" + simCdn);
    text = patchSimHtml(text, relpub)
    text = td.replaceAll(text, "/sim/", simCdn);
    text = td.replaceAll(text, "/cdn/", trgCdn);
    text = td.replaceAll(text, "@TRGREL@", prel.releaseid);
    text = td.replaceAll(text, "@BASEREL@", baserelid);

    let cfg = ccfg.toJson()
    cfg["targetVersion"] = prel.pkgversion
    cfg["ksVersion"] = (baseRel ? baseRel["pub"]["pkgversion"] : null)
    let verPref = `
        var tdVersion = "${ver}";
        var tdConfig = ${JSON.stringify(cfg, null, 2) };
    `;
    text = td.replaceAll(text, "var rootUrl = ", verPref + "var tdlite = \"url\";\nvar rootUrl = ");
    return text;
}

function getSimUrl(trg: string, relid: string) {
    let dom = core.serviceSettings.targetsDomain
    return `https://trg-${trg}.${dom}/sim/${relid}`
}

// The one used for PXT.IO releases
export async function getRewrittenIndexAsync(relprefix: string, id: string, srcFile: string) {
    let sanitize = (s: string) => s.replace(/[^\w \.\-\/]/g, "_")

    relprefix = sanitize(relprefix)

    let relpub = await core.getPubAsync(id, "release");
    if (!relpub) return "Release deleted."

    let prel = PubRelease.createFromJson(relpub["pub"]);
    
    let isSim = /^sim/.test(srcFile)

    // no cache manifest on versioned releases - they just clog storage
    let manifest = relprefix + (isSim ? "simmanifest" : "manifest")
    if (/v\d+\./.test(relprefix)) manifest = ""
    
    if (core.basicCreds) manifest = ""

    if (!prel.type)
        return await getLegacyRewrittenIndexAsync(manifest, id, srcFile)

    let baserelid = prel.releaseid

    let baseRelJson = prel.type == "fulltarget" ? relpub : await core.getPubAsync(prel.baserelease, "release")
    if (!baseRelJson)
        return "Base release deleted: " + prel.baserelease
    let baseRel = PubRelease.createFromJson(baseRelJson["pub"])
    baserelid = baseRelJson["id"]

    let srcRelId = /^sim/.test(srcFile) ? prel.releaseid : baserelid

    let info = await appContainer.getBlobToTextAsync(srcRelId + "/" + srcFile);
    let text = info.text()

    if (!info.text()) return srcFile + " missing in " + srcRelId

    let domain = tdlitePointers.domainOfTarget(prel.target) || core.myHost

    let simCdn = core.currClientConfig.primaryCdnUrl + "/app/" + prel.releaseid + "/c/"

    let simdom = core.serviceSettings.targetsDomain
    let appCdn = core.currClientConfig.primaryCdnUrl + "/app/"
    let ccfg = {
        relprefix: relprefix,
        workerjs: relprefix + "worker",
        tdworkerjs: relprefix + "tdworker",
        monacoworkerjs: relprefix + "monacoworker",
        pxtVersion: sanitize(baseRel.pkgversion),
        pxtRelId: baseRel.id,
        pxtCdnUrl: appCdn + baseRel.id + "/c/",
        targetUrl: "https://" + domain,
        targetVersion: sanitize(prel.pkgversion),
        targetRelId: prel.id,
        targetCdnUrl: appCdn + prel.id + "/c/",
        targetId: prel.target,
        runUrl: relprefix + "run",
        docsUrl: relprefix + "docs",
        partsUrl: `https://trg-${prel.target}.${simdom}${relprefix}siminstructions`,
        simUrl: `https://trg-${prel.target}.${simdom}${relprefix}simulator`
    }

    let cfgStr = JSON.stringify(ccfg, null, 4)
    ccfg["cfg"] = cfgStr
    ccfg["manifest"] = manifest ? `manifest="${manifest}"` : ""
    ccfg["targetname"] = baseRel.name;

    text = text.replace(/@(\w+)@/g, (f, id) => {
        if (ccfg.hasOwnProperty(id)) return ccfg[id]
        else return f
    })

    return text;
}

export async function getJsonReleaseFileAsync(relid: string, fn: string): Promise<{}> {
    let path = "jsoncache/" + relid + "/" + fn
    let entry = await cacheRewritten.getAsync(path);
    if (entry) return entry
    let res = await appContainer.getBlobToTextAsync(relid + "/" + fn)
    let txt = res.text()
    if (txt) {
        let ret = JSON.parse(txt)
        await cacheRewritten.justInsertAsync(path, ret)
        return ret
    } else {
        return null as any;
    }
}

async function rewriteAndCacheAsync(rel: string, relid: string, srcFile: string, contentType: string, res: restify.Response, rewrite: StringTransformer): Promise<void> {
    let path = relid + "/" + rel + "/" + core.myChannel + "/" + srcFile;
    let entry2 = await cacheRewritten.getAsync(path);
    if (entry2 == null || entry2["version"] != core.rewriteVersion) {
        let lock = await core.acquireCacheLockAsync(path);
        if (lock == "") {
            await rewriteAndCacheAsync(rel, relid, srcFile, contentType, res, rewrite);
            return;
        }

        let info = await appContainer.getBlobToTextAsync(relid + "/" + srcFile);
        if (info.succeded()) {
            let text = await rewrite(info.text());
            await cacheRewritten.updateAsync(path, async(entry: JsonBuilder) => {
                entry["version"] = core.rewriteVersion;
                entry["text"] = text;
            });
            res.sendText(text, contentType);
        }
        else {
            res.sendError(404, "missing file");
        }
        await core.releaseCacheLockAsync(lock);
    }
    else {
        res.sendText(entry2["text"], contentType);
    }
    logger.measure("ServeApp@" + srcFile, logger.contextDuration());
}

export async function pokeReleaseAsync(relLabel: string, delay: number): Promise<void> {
    await td.sleepAsync(delay);
    await core.updateSettingsAsync("releases", async(entry: JsonBuilder) => {
        let jsb = entry["ids"][relLabel];
        jsb["numpokes"] = jsb["numpokes"] + 1;
    });
}

export function clientConfigForRelease(prel: PubRelease): core.ClientConfig {
    let ccfg: core.ClientConfig;
    ccfg = core.ClientConfig.createFromJson(core.currClientConfig.toJson());
    ccfg.tdVersion = prel.version;
    ccfg.releaseid = prel.releaseid;
    ccfg.relid = prel.id;
    return ccfg;
}

var faviconIco: Buffer;
export async function getFaviconAsync() {
    if (faviconIco == null) {
        let res = await filesContainer.getBlobToBufferAsync("favicon.ico");
        faviconIco = res.buffer();
    }
    return faviconIco;
}
