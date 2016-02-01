/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as util from 'util';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as restify from './restify';
import * as parallel from './parallel';
import * as tdliteData from './tdlite-data';

var uploadCache: td.SMap<string> = {};
var uploadPromises: td.SMap<Promise<string>> = {};
var nunjucks = require("nunjucks");
var clientConfig: any;
var i18nPtrs = {}

function mimeType(fn: string) {
    let ext = fn.replace(/.*\./, "").toLowerCase()
    return Object.keys(tdliteData.artContentTypes).filter(k => tdliteData.artContentTypes[k] == ext)[0]
}

function getFiles() {
    let res = []
    function loop(path: string) {
        for (let fn of fs.readdirSync(path)) {
            if (fn[0] == ".") continue;
            let fp = path + "/" + fn
            let st = fs.statSync(fp)
            if (st.isDirectory()) loop(fp)
            else if (st.isFile()) res.push(fp.replace(/^web/, ""))
        }
    }
    loop("web")
    return res
}

function tdliteKey() {
    var mm = /^(http.*)\?access_token=(.*)/.exec(process.env['TD_UPLOAD_KEY'])
    if (!mm) {
        console.log("invalid or missing $TD_UPLOAD_KEY")
        process.exit(1)
    }

    return { liteUrl: mm[1], key: mm[2] }
}

function mkReq(path: string) {
    let k = tdliteKey();
    let r = td.createRequest(k.liteUrl + "api/" + path)
    r.setHeader("X-TD-Access-Token", k.key);
    return r;
}

function error(msg: string) {
    console.log("ERROR: " + msg)
    process.exit(1)
}

function replContent(str: string, waitFor: Promise<string>[]) {
    return str.replace(/[\.\/]*(\/static\/[\w\.\-\/]+)/g, (m, x) => {
        let repl = uploadPromises[x];
        if (!repl) {
            error("file not uploaded? " + x)
        }
        if (waitFor) waitFor.push(repl)
        else return (<any>repl).value();
        return "";
    })
}

function rewriteUrl(id: string): string {
    for (let url of clientConfig.altCdnUrls)
        id = id.replace(url, clientConfig.primaryCdnUrl);
    return id;
}

async function uploadArtAsync(fn: string): Promise<string> {
    await td.sleepAsync(0.001);

    let contentType = mimeType(fn.replace(/\.html/, ".txt"))
    if (!contentType) {
        error("content type not understood: " + fn)
        return ""
    }

    let buf = fs.readFileSync("web" + fn)

    if (/\.html/.test(fn)) {
        let tmp = nunjucks.render(fn.replace(/^\/+/, ""), { somevar: 1 })

        if (tmp.indexOf("<!-- TD-NO-TRANSLATE -->") == -1)
            i18nPtrs[fn] = 1;

        buf = new Buffer(tmp, "utf8")
    }

    if (/^text/.test(contentType)) {
        let str = buf.toString("utf8");
        let waitFor: Promise<any>[] = [];
        replContent(str, waitFor);
        for (let p of waitFor) await p;
        str = replContent(str, null);
        buf = new Buffer(str, "utf8");
    }

    let sha = td.sha256(buf).slice(0, 32)
    if (uploadCache[sha])
        return uploadCache[sha];

    let r = await mkReq("arthash/" + sha).sendAsync()
    let it = r.contentAsJson()["items"][0]
    if (it) {
        let id0 = rewriteUrl(it.bloburl);
        console.log(`already present: ${fn} at ${id0}`)
        uploadCache[sha] = id0
        return id0
    }

    let ext = fn.replace(/.*\./, "").toLowerCase()
    if (ext == "html") ext = "txt";

    let req = mkReq("art");
    req.setContentAsJson({
        content: buf.toString("base64"),
        contentType: contentType,
        description: "#template",
        name: fn.replace(/.*\//, "")
    })
    req.setMethod("post")
    let resp = await req.sendAsync();
    if (resp.statusCode() != 200) {
        error("bad status code: " + resp.toString())
        return ""
    }

    let id = rewriteUrl(resp.contentAsJson()["bloburl"])
    console.log(`upload: ${fn} -> ${id}`)
    uploadCache[sha] = id
    return id
}

function pathToPtr(path: string) {
    return "ptr-" + path.replace(/\.html$/, "").replace(/^\/+/, "").replace(/[^a-zA-Z0-9@]/g, "-")
}

async function getPtrAsync(path: string) {
    let id = pathToPtr(path)
    let rdreq = mkReq(id)
    let curr = await rdreq.sendAsync();

    if (curr.statusCode() == 200) {
        return curr.contentAsJson();
    } else {
        return <{}>null;
    }
}

async function uploadRedirectAsync(fn: string) {
    let path = fn.replace(/\.redir.txt$/, "")
    let url = fs.readFileSync("web" + fn, "utf8").trim()
    if (!/^(\/|https?:\/\/)[\w\.\@\#\-\/\?]+/.test(url)) {
        throw new Error("bad URL: " + url + " in " + fn)
    }
    let curr = await getPtrAsync(path);
    let artid = ""
    let target = url

    if (/^\/static\//.test(url)) {
        await td.sleepAsync(1);
        let task = uploadPromises[url]
        if (!task) {
            throw new Error("redirection: " + fn + " -> " + url + ": art not found")
        }
        let bloburl = await task
        let m = /\/pub\/([a-z]+)/.exec(bloburl)
        url = ""
        artid = m[1]
        target = "art:" + artid
    }

    if (curr && (curr["redirect"] || "") == url && (curr["artid"] || "") == artid) {
        console.log(`${fn}: already set to ${target}`)
        return
    }

    let req = mkReq("pointers")
    req.setMethod("post")
    req.setContentAsJson({
        path: path,
        redirect: url,
        artid: artid
    })
    let resp = await req.sendAsync();
    console.log(`${fn}: ${target} -> ${resp.statusCode() }`)
}

async function uploadFileAsync(fn: string) {
    if (/\.redir\.txt$/.test(fn)) {
        await uploadRedirectAsync(fn);
        return;
    }

    let task = /* async */ uploadArtAsync(fn);
    uploadPromises[fn] = task;
    let bloburl = await task;
    if (!/\/static\//.test(fn)) {
        let m = /\/pub\/([a-z]+)/.exec(bloburl)
        let id = m[1]
        let path = fn.replace(/\.html$/, "")
        let curr = await getPtrAsync(path);

        if (curr && curr["htmlartid"] == id) {
            console.log(`${fn}: already set to ${id}`)
            return
        }

        let req = mkReq("pointers")
        req.setMethod("post")
        req.setContentAsJson({
            path: path,
            htmlartid: id
        })
        let resp = await req.sendAsync();
        console.log(`${fn}: ${id} -> ${resp.statusCode() }`)
    }
}

async function uploadAsync() {
    let branch = process.env["TRAVIS_BRANCH"]
    if (branch && branch != "master")
        return;
    let tmppath = "web/_temp"
    if (!fs.existsSync(tmppath))
        fs.mkdirSync(tmppath)
    let cachepath = tmppath + "/uploadcache.json"
    if (fs.existsSync(cachepath))
        uploadCache = JSON.parse(fs.readFileSync(cachepath, "utf8"))
    let files = getFiles().filter(fn => !/^\/_/.test(fn))

    let resp = await mkReq("clientconfig").sendAsync()
    clientConfig = resp.contentAsJson()

    await parallel.forJsonAsync(files, uploadFileAsync)

    let ptrs = Object.keys(i18nPtrs).map(pathToPtr)
    ptrs.sort()
    let req = mkReq("i18n/pointers")
    req.setMethod("post")
    req.setContentAsJson({
        pointers: ptrs
    })
    let resp2 = await req.sendAsync();
    console.log(`i18n: ${resp2.statusCode() } ${util.inspect(resp2.contentAsJson()) }`)

    fs.writeFileSync(cachepath, JSON.stringify(uploadCache, null, 2))
}

async function serveAsync() {
    let s = restify.server()
    s.get("/", async(req, res) => {
        let hrefs = ""
        let lst = getFiles().filter(f => !/^\/(_layouts|_includes|static)\//.test(f))
        lst.sort()
        for (let fn of lst) {
            fn = fn.replace(/\.html$/, "")
            hrefs += `<a style="font-size:20px;line-height:1.5em" href="${fn}">${fn}</a><br>\n`
        }
        res.html(hrefs)
    })
    s.routeRegex("GET", "/.*", async(req, res) => {
        let fn = req.url().replace(/\?.*/, "");
        if (/^(\/[\w][\w\.\-]+)+$/.test(fn)) {
            if (fs.existsSync("web" + fn + ".html"))
                fn += ".html"
            if (fs.existsSync("web" + fn)) {
                if (/^\/static\//.test(fn)) {
                    res.sendBuffer(fs.readFileSync("web" + fn),
                        mimeType(fn) || "application/octet-stream", {});
                } else {
                    let tmp = nunjucks.render(fn.replace(/^\/+/, ""), { somevar: 1 })
                    res.html(tmp)
                }
            } else {
                res.sendError(404, "No such file");
            }
        } else {
            res.sendError(400, "");
        }
    })

    await restify.startAsync();
}

function i18n() {
    let res = "";
    for (let fn of fs.readdirSync("src")) {
        if (/\.ts$/.test(fn)) {
            let str = fs.readFileSync("src/" + fn, "utf8")
            str.replace(/translateMessage\("([^"]+)"/g, (full: string, msg: string) => {
                res += "<div>" + msg + "</div>\n"
                return ""
            })
        }
    }
    fs.writeFileSync("web/i18n-messages.html", res, "utf8")
}

async function main() {
    nunjucks.configure("web", {
        autoescape: true,
        noCache: true
    })


    let cmd = process.argv[2];
    if (cmd == "serve")
        await serveAsync();
    else if (cmd == "upload" || cmd == "push")
        await uploadAsync();
    else if (cmd == "i18n")
        i18n();
    else
        console.log("bad usage")
}

main();
