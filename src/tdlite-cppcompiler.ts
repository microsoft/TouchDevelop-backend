/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as crypto from 'crypto';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as azureTable from "./azure-table"
import * as azureBlobStorage from "./azure-blob-storage"
import * as raygun from "./raygun"
import * as core from "./tdlite-core"
import * as tdliteTdcompiler from "./tdlite-tdcompiler"
import * as tdliteScripts from "./tdlite-scripts"
import * as mbedworkshopCompiler from "./mbedworkshop-compiler"
import * as cachedStore from "./cached-store"

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;
var mbedVersion = 2;
var mbedCache = true;
var compileContainer: azureBlobStorage.Container;
var githubCache: cachedStore.Container;
var cppCache: cachedStore.Container;

export class CompileReq
    extends td.JsonRecord {
    @td.json public config: string = "";
    @td.json public source: string = "";
    @td.json public meta: JsonObject;
    @td.json public repohash: string = "";
    static createFromJson(o: JsonObject) { let r = new CompileReq(); r.fromJson(o); return r; }
}

export interface ICompileReq {
    config: string;
    source: string;
    meta: JsonObject;
    repohash: string;
}

export class CompileResp
    extends td.JsonRecord {
    @td.json public statusurl: string = "";
    static createFromJson(o: JsonObject) { let r = new CompileResp(); r.fromJson(o); return r; }
}

export interface ICompileResp {
    statusurl: string;
}

export class CompileStatus
    extends td.JsonRecord {
    @td.json public success: boolean = false;
    @td.json public hexurl: string = "";
    @td.json public mbedresponse: JsonBuilder;
    @td.json public messages: JsonObject[];
    @td.json public bugReportId: string = "";
    static createFromJson(o: JsonObject) { let r = new CompileStatus(); r.fromJson(o); return r; }
}

export interface ICompileStatus {
    success: boolean;
    hexurl: string;
    mbedresponse: JsonBuilder;
    messages: JsonObject[];
}

export class CompilerConfig
    extends td.JsonRecord {
    @td.json public repourl: string = "";
    @td.json public platform: string = "";
    @td.json public hexfilename: string = "";
    @td.json public hexcontenttype: string = "";
    @td.json public target_binary: string = "";
    @td.json public internalUrl: string = "";
    @td.json public internalKey: string = "";
    static createFromJson(o: JsonObject) { let r = new CompilerConfig(); r.fromJson(o); return r; }
}

export interface ICompilerConfig {
    repourl: string;
    platform: string;
    hexfilename: string;
    hexcontenttype: string;
    target_binary: string;
    internalUrl: string;
}

export async function initAsync() {
    mbedworkshopCompiler.init();
    mbedworkshopCompiler.setVerbosity("debug");

    compileContainer = await core.blobService.createContainerIfNotExistsAsync("compile", "hidden");
    githubCache = await cachedStore.createContainerAsync("cachegithub");
    cppCache = await cachedStore.createContainerAsync("cachecpp");

    core.addRoute("POST", "admin", "mbedint", async(req9: core.ApiRequest) => {
        core.checkPermission(req9, "root");
        if (req9.status == 200) {
            let ccfg = CompilerConfig.createFromJson(core.getSettings("compile")[req9.argument]);
            let jsb2 = td.clone(req9.body);
            let response2 = await mbedintRequestAsync(ccfg, jsb2);
            req9.response = response2.contentAsJson();
        }
    });

    core.addRoute("POST", "compile", "extension", async(req) => {
        //if (!core.checkPermission(req, "root")) return;
        await mbedCompileExtAsync(req);
    }, { noSizeCheck: true })

    core.addRoute("GET", "*script", "hex", async(req) => {
        let pub = req.rootPub

        if (core.orFalse(req.queryOptions["applyupdates"])) {
            pub = await tdliteScripts.updateScriptAsync(pub)
        }

        if (pub["pub"]["unmoderated"]) {
            req.status = httpCode._400BadRequest
            return
        }

        let ver = await core.getCloudRelidAsync(false);
        // include some randomness (TDC_ACCESS_TOKEN) to make these non-predictable just in case
        let key = core.sha256(ver + "." + pub["id"] + "." + core.rewriteVersion + "." + td.serverSetting("TDC_ACCESS_TOKEN"))
        let name = pub["pub"]["name"] || "script"
        name = name.replace(/[^a-zA-Z0-9]+/g, "-")
        let blobName = key + "/microbit-" + name + ".hex"

        let curr = await cppCache.getAsync(key + "-hexstatus")
        if (curr == null) {
            if (await core.throttleAsync(req, "compile", 20))
                return;
            // create status file first to avoid races
            let doIt = false
            curr = await cppCache.updateAsync(key + "-hexstatus", async(v) => {
                doIt = !v["url"]
                v["url"] = core.currClientConfig.primaryCdnUrl + "/compile/" + blobName
            })
            if (!doIt) {
                // race detected; wait a while and then redirect - hopefully the other guy is ready by now
                await td.sleepAsync(10)
            } else {
                let json = await tdliteTdcompiler.queryCloudCompilerAsync("q/" + pub["id"] + "/hexcompile");
                if (json["compiled"]) {
                    let res = await compileContainer.createGzippedBlockBlobFromBufferAsync(blobName, new Buffer(json["data"], "utf8"), {
                        contentType: json["contentType"],
                        smartGzip: false
                    })
                }
            }
        }

        req.headers = {
            "location": curr["url"]
        }
        req.status = httpCode._302MovedTemporarily;
    });


}


export async function mbedCompileAsync(req: core.ApiRequest): Promise<void> {
    let compileReq = CompileReq.createFromJson(req.body);
    let name = "my script";
    if (compileReq.meta != null) {
        name = withDefault(compileReq.meta["name"], name);
    }
    name = name.replace(/[^a-zA-Z0-9]+/g, "-");
    let cfg = core.getSettings("compile");
    let sha = core.sha256(JSON.stringify(compileReq.toJson()) + "/" + mbedVersion + "/" + cfg["__version"]).substr(0, 32);
    let info = await compileContainer.getBlobToTextAsync(sha + ".json");
    let compileResp = new CompileResp();
    compileResp.statusurl = compileContainer.url() + "/" + sha + ".json";
    logger.info("mbed compile: " + compileResp.statusurl);
    let hit = false;
    if (info.succeded()) {
        let js = JSON.parse(info.text());
        if (mbedCache && js["success"]) {
            hit = true;
        }
        else {
            await compileContainer.deleteBlobAsync(sha + ".json");
            logger.tick("MbedCacheHitButRetry");
        }
    }
    if (hit) {
        logger.tick("MbedCacheHit");
        req.response = compileResp.toJson();
    }
    else if (cfg[compileReq.config.replace(/-fota$/, "")] == null) {
        logger.info("compile config doesn't exists: " + compileReq.config)
        req.status = httpCode._412PreconditionFailed;
    }
    else {
        if (compileReq.source.length > 200000) {
            req.status = httpCode._413RequestEntityTooLarge;
        }
        let numrepl = 0;
        let src = td.replaceFn(compileReq.source, /#(\s*include\s+[<"]([a-zA-Z0-9\/\.\-]+)[">]|if\s+|ifdef\s+|else\s+|elif\s+|line\s+)?/g, (elt: string[]) => {
            let result: string;
            let body = orEmpty(elt[1]);
            if (elt.length > 1 && body != "") {
                result = "#" + body;
            }
            else {
                result = "\\x23";
                numrepl += 1;
            }
            return result;
        });
        src = td.replaceAll(src, "%:", "\\x25\\x3A");
        if (numrepl > 0) {
            logger.info("replaced some hashes, " + src.substr(0, 500));
        }
        await core.throttleAsync(req, "compile", 20);
        if (req.status == 200) {
            let isFota = false;
            if (compileReq.config.endsWith("-fota")) {
                isFota = true;
                compileReq.config = compileReq.config.replace(/-fota$/g, "");
            }
            let json0 = cfg[compileReq.config];
            if (json0 == null) {
                req.status = httpCode._404NotFound;
                return;
            }
            let ccfg = CompilerConfig.createFromJson(json0);
            if (isFota) {
                ccfg.target_binary = td.replaceAll(orEmpty(ccfg.target_binary), "-combined", "");
            }
            if (!ccfg.repourl) {
                req.status = httpCode._404NotFound;
                return;
            }
            ccfg.hexfilename = td.replaceAll(ccfg.hexfilename, "SCRIPT", name);
            if (orEmpty(ccfg.internalUrl) != "") {
                if (/^[\w.\-]+$/.test(orEmpty(compileReq.repohash)) && compileReq.repohash.length < 60) {
                    ccfg.repourl = compileReq.repohash;
                }
                if (/^[a-f0-9]+$/.test(ccfg.repourl) && ccfg.repourl.length == 64) {
                    // OK, looks like image ID
                }
                else {
                    let tags = core.getSettings("compiletag");
                    if (tags == null) {
                        tags = ({});
                    }
                    let imgcfg = tags[compileReq.config + "-" + ccfg.repourl];
                    if (imgcfg == null) {
                        imgcfg = tags[ccfg.repourl];
                    }
                    if (imgcfg == null) {
                        imgcfg = "";
                    }
                    let imgid = orEmpty(td.toString(imgcfg));
                    if (imgid == "") {
                        logger.info("cannot find repo: " + ccfg.repourl);
                        req.status = httpCode._404NotFound;
                        return;
                    }
                    logger.debug("found image: " + ccfg.repourl + " -> " + imgid);
                    ccfg.repourl = imgid;
                }
                let jsb = {};
                jsb["maincpp"] = src;
                jsb["op"] = "build";
                jsb["image"] = ccfg.repourl;
                /* async */ mbedintDownloadAsync(sha, jsb, ccfg);
                req.response = compileResp.toJson();
            }
            else if (!ccfg.target_binary) {
                req.status = httpCode._404NotFound;
            }
            else {
                if (/^[\w.\-]+$/.test(orEmpty(compileReq.repohash))) {
                    ccfg.repourl = ccfg.repourl.replace(/#.*/g, "#" + compileReq.repohash);
                }
                logger.debug("compile at " + ccfg.repourl);
                let compile = mbedworkshopCompiler.createCompilation(ccfg.platform, ccfg.repourl, ccfg.target_binary);
                compile.replaceFiles["/source/main.cpp"] = src;
                let started = await compile.startAsync();
                if (!started) {
                    logger.tick("MbedWsCompileStartFailed");
                    req.status = httpCode._424FailedDependency;
                }
                else {
                    /* async */ mbedwsDownloadAsync(sha, compile, ccfg);
                    req.response = compileResp.toJson();
                }
            }
        }
    }
}

async function githubFetchAsync(ccfg: CompilerConfig, path: string): Promise<string> {
    let metaUrl = ccfg.repourl
        .replace(/^https:\/\/github.com/, "https://raw.githubusercontent.com")
        .replace(/\.git#.*/, "/" + path)
    let key = core.sha256(metaUrl)

    let res = await githubCache.getAsync(key)

    if (res == null) {
        logger.debug("download metainfo: " + metaUrl)
        let resp = await td.createRequest(metaUrl).sendAsync();
        if (resp.statusCode() != 200) return <string>null;
        res = { url: metaUrl, path: path, text: resp.content() }
        await githubCache.justInsertAsync(key, res);
    }

    return <string>res["text"]
}

interface CompileExtReq {
    config: string;
    tag: string;
    replaceFiles: {};
    dependencies?: {};
}

interface IntCompileStatus {
    finished: boolean;
    starttime: number;
    success: boolean;
    version: number;
}

async function mbedCompileExtAsync(req: core.ApiRequest): Promise<void> {

    await core.throttleAsync(req, "compile", 5); // pay for the initial processing
    if (req.status != 200) return;

    let buf = new Buffer(req.body["data"], "base64")
    // the request is base64 encoded in data field to avoid any issues with sha256 client-side computation yielding different results    
    let sha = td.sha256(buf)

    if (buf.length > 200000) {
        req.status = httpCode._413RequestEntityTooLarge;
        return;
    }
    
    let buildTimeout = 120

    let hexurl = compileContainer.url() + "/" + sha + ".hex";
    req.response = { ready: false, hex: hexurl }
    let now = await core.nowSecondsAsync();
    let currStatus = <IntCompileStatus>await cppCache.getAsync(sha + "-status");
    if (currStatus) {
        // if not success, we let them retry after two minutes (below) 
        if (currStatus.finished && currStatus.success) {
            // the client should have come here themselves...
            req.response = { ready: true, hex: hexurl }
            return;
        }
        if (now - currStatus.starttime < buildTimeout) {
            return;
        }
    }

    let shouldStart = false;

    await cppCache.updateAsync(sha + "-status", async(entry: IntCompileStatus) => {
        let starttime = entry.starttime
        if (now - starttime < buildTimeout) {
            logger.info("race on compile start for " + sha)
            shouldStart = false;
        } else {
            entry.starttime = now;
            entry.finished = false;
            shouldStart = true;
        }
    })

    if (!shouldStart) {
        return;
    }

    let compileReq: CompileExtReq = JSON.parse(buf.toString("utf8"))

    let cfg = core.getSettings("compile");

    if (cfg[compileReq.config] == null) {
        logger.info("compile config doesn't exists: " + compileReq.config)
        req.status = httpCode._412PreconditionFailed;
    }
    else {
        await core.throttleAsync(req, "compile", 50);

        if (req.status != 200) return;

        let ccfg = CompilerConfig.createFromJson(cfg[compileReq.config]);
        if (!ccfg.repourl) {
            req.status = httpCode._404NotFound;
            return;
        }

        let tag = orEmpty(compileReq.tag)

        ccfg.hexfilename = "";
        if (!ccfg.target_binary) {
            req.status = httpCode._404NotFound;
            return;
        }
        if (/^[\w.\-]+$/.test(tag)) {
            ccfg.repourl = ccfg.repourl.replace(/#.*/g, "#" + compileReq.tag);
        } else {
            req.status = httpCode._400BadRequest;
            return;
        }

        let metainfo = await githubFetchAsync(ccfg, tag + "/generated/metainfo.json");
        if (metainfo == null) {
            req.status = httpCode._412PreconditionFailed;
            return;
        }

        let modulejson = {
            "name": ccfg.target_binary.replace(/-combined/, "").replace(/\.hex$/, ""),
            "version": "0.0.0",
            "description": "Auto-generated. Do not edit.",
            "license": "n/a",
            "dependencies": compileReq.dependencies || {},
            "targetDependencies": {},
            "bin": "./source"
        }

        let repoSlug = ccfg.repourl.replace(/^https?:\/\/[^\/]+\//, "").replace(/\.git#/, "#")
        let pkgName = repoSlug.replace(/#.*/, "").replace(/^.*\//, "")
        modulejson.dependencies[pkgName] = repoSlug
        compileReq.replaceFiles["/module.json"] = JSON.stringify(modulejson, null, 2) + "\n"

        let result2 = await compileContainer.createGzippedBlockBlobFromBufferAsync(sha + "-metainfo.json", new Buffer(metainfo, "utf8"), {
            contentType: "application/json; charset=utf-8"
        });

        logger.debug("compile at " + ccfg.repourl + " module.json: " + compileReq.replaceFiles["/module.json"]);

        let mappedFiles =
            Object.keys(compileReq.replaceFiles).map(k => {
                return {
                    name: k.replace(/^\/+/, ""),
                    text: compileReq.replaceFiles[k]
                }
            })

        let jsb = {
            op: "buildex",
            files: mappedFiles,
            gittag: ccfg.repourl.replace(/.*#/, ""),
            empty: true,
        };
        
        /* async */ mbedintDownloadAsync(sha, jsb, ccfg, true);

        req.response = {
            ready: false,
            started: true,
            hex: hexurl
        }

    }
}

async function mbedwsDownloadAsync(sha: string, compile: mbedworkshopCompiler.CompilationRequest, ccfg: CompilerConfig, saveSt = false): Promise<void> {
    logger.newContext();
    let task = await compile.statusAsync(true);
    // TODO: mbed seems to need a second call
    await td.sleepAsync(1);
    task = await compile.statusAsync(false);
    let st = new CompileStatus();
    logger.measure("MbedWsCompileTime", logger.contextDuration());
    st.success = task.success;
    if (task.success) {
        let bytes = await task.downloadAsync(compile);
        if (bytes.length == 0) {
            st.success = false;
            logger.tick("MbedEmptyDownload");
        }
        else {
            let hexname = sha + "/" + ccfg.hexfilename;
            if (!ccfg.hexfilename)
                hexname = sha + ".hex";
            st.hexurl = compileContainer.url() + "/" + hexname;

            let result = await compileContainer.createGzippedBlockBlobFromBufferAsync(hexname, bytes, {
                contentType: ccfg.hexcontenttype
            });
            logger.tick("MbedHexCreated");
        }
    }

    var err: any = null;
    if (!task.success) {
        err = new Error("Compilation failed");
        st.bugReportId = raygun.mkReportId()
        err.tdMeta = { reportId: st.bugReportId }
        let payload = JSON.parse(JSON.stringify(task.payload).replace(/\w+@github.com/g, "[...]@github.com"))
        delete payload["replace_files"];
        err.bugAttachments = [
            core.withDefault(payload.result ? payload.result.exception : null, "Cannot find exception")
                .replace(/(\\r)?\\n/g, "\n")
                .replace(/['"], ["']/g, "\n"),
            JSON.stringify(payload, null, 1)
        ];
        for (let k of Object.keys(compile.replaceFiles)) {
            err.bugAttachments.push(k + ":\n" + compile.replaceFiles[k])
        }
        st.mbedresponse = { result: { exception: "ReportID: " + st.bugReportId } }
    }

    let result2 = await compileContainer.createBlockBlobFromJsonAsync(sha + ".json", st.toJson());

    if (saveSt)
        await cppCache.updateAsync(sha + "-status", async(entry: IntCompileStatus) => {
            entry.finished = true;
            entry.success = task.success;
        })

    if (err)
        throw err;
}

async function mbedintDownloadAsync(sha: string, jsb2: JsonBuilder, ccfg: CompilerConfig, saveSt = false): Promise<void> {
    logger.newContext();
    jsb2["hexfile"] = "source/" + ccfg.target_binary;
    jsb2["target"] = ccfg.platform;
    let response = await mbedintRequestAsync(ccfg, jsb2);
    let respJson = response.contentAsJson();
    let st = new CompileStatus();
    logger.measure("MbedIntCompileTime", logger.contextDuration());
    // Just in case...
    if (response.statusCode() != 200 || respJson == null) {
        setMbedresponse(st, "Code: " + response.statusCode() + " / " + (response.content() || "???").slice(0, 300));
    }
    else {
        let hexfile = respJson["hexfile"];
        let msg = orEmpty(respJson["stderr"]) + orEmpty(respJson["stdout"]);
        if (hexfile == null) {
            setMbedresponse(st, withDefault(msg, "no hex"));
        }
        else {
            st.success = true;
            let hexname = ccfg.hexfilename ? sha + "/" + ccfg.hexfilename : sha + ".hex"
            st.hexurl = compileContainer.url() + "/" + hexname;
            let result = await compileContainer.createGzippedBlockBlobFromBufferAsync(hexname, new Buffer(hexfile, "utf8"), {
                contentType: ccfg.hexcontenttype
            });
            logger.tick("MbedHexCreated");
        }
    }
    let result2 = await compileContainer.createBlockBlobFromJsonAsync(sha + ".json", st.toJson());

    if (saveSt)
        await cppCache.updateAsync(sha + "-status", async(entry: IntCompileStatus) => {
            entry.finished = true;
            entry.success = st.success;
        })

}

function setMbedresponse(st: CompileStatus, msg: string): void {
    let jsb = ({ "result": {} });
    jsb["result"]["exception"] = msg;
    st.mbedresponse = jsb;
}

async function mbedintRequestAsync(ccfg: CompilerConfig, jsb2: JsonBuilder): Promise<td.WebResponse> {
    jsb2["requestId"] = azureTable.createRandomId(128);
    let request = td.createRequest(ccfg.internalUrl);
    let iv = crypto.randomBytes(16);
    let key = new Buffer(ccfg.internalKey || td.serverSetting("MBEDINT_KEY", false), "hex");
    let cipher = crypto.createCipheriv("aes256", key, iv);
    request.setHeader("x-iv", iv.toString("hex"));
    let enciphered = cipher.update(new Buffer(JSON.stringify(jsb2), "utf8"));
    let cipherFinal = cipher.final();
    request.setContentAsBuffer(Buffer.concat([enciphered, cipherFinal]));
    request.setMethod("post");
    let response = await request.sendAsync();
    let buf = response.contentAsBuffer();
    let inpiv = response.header("x-iv");
    if (response.statusCode() == 200) {
        var ciph = crypto.createDecipheriv("AES256", key, new Buffer(inpiv, "hex"));
        var b0 = ciph.update(buf)
        var b1 = ciph.final()
        var dat = Buffer.concat([b0, b1]).toString("utf8");
        (<any>response)._content = dat;
    }
    return response;
}
