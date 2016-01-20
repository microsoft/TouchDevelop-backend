/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

import * as restify from './restify';

var logger: td.AppLogger;
var apiRoot = "https://api.crowdin.com/api/project/touchdevelop/"
var suff = ""

function init(): Promise<void> {
    if (logger != null) return;
    logger = td.createLogger("crowdin");
    suff = "?key=" + td.serverSetting("CROWDIN_KEY");
    logger.info("initialized");
}

export async function multipartPostAsync(uri: string, data: any, filename: string = null, filecontents: string = null) {
    // tried and failed to use request module...
    
    init();

    var boundry = "--------------------------0461489f461126c5"
    var form = ""

    function add(name: string, val: string) {
        form += boundry + "\r\n"
        form += "Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n"
        form += val + "\r\n"
    }

    function addF(name: string, val: string) {
        form += boundry + "\r\n"
        form += "Content-Disposition: form-data; name=\"files[" + name + "]\"; filename=\"blah.json\"\r\n"
        form += "\r\n"
        form += val + "\r\n"
    }

    Object.keys(data).forEach(k => add(k, data[k]))
    if (filename)
        addF(filename, filecontents)

    form += boundry + "--\r\n"

    let req = td.createRequest(uri)
    req.setMethod("POST");
    req.setContent(form);
    req.setContentType("multipart/form-data; boundary=" + boundry.slice(2))

    let resp = await req.sendAsync()
    return resp;
}

export async function uploadTranslationAsync(filename: string, jsondata: {}) {
    init();

    let cnt = 0

    function incr() {
        if (cnt++ > 10) {
            throw new Error("Too many API calls for " + filename);
        }
    }

    async function createDirAsync(name: string) {
        await createDir0Async(name);
    }

    async function createDir0Async(name: string) {
        logger.info(`create directory ${name}`)
        incr();
        let resp = await multipartPostAsync(apiRoot + "add-directory" + suff, { json: "", name: name });
        if (resp.statusCode() == 200)
            return;

        let data: any = resp.contentAsJson() || { error: {} }

        if (resp.statusCode() == 404 && data.error.code == 17) {
            logger.info(`parent directory missing for ${name}`)
            var par = name.replace(/\/[^\/]+$/, "")
            if (par != name) {
                await createDirAsync(par);
                await createDirAsync(name); // retry
                return
            }
        }

        throw new Error(`cannot create dir ${name}: ${resp.toString() } ${JSON.stringify(data) }`)
    }

    async function startAsync() {
        await uploadAsync("update-file", { update_option: "update_as_unapproved" })
    }

    async function uploadAsync(op: string, opts: any) {
        opts["type"] = "auto";
        opts["json"] = "";
        incr();
        let resp = await multipartPostAsync(apiRoot + op + suff, opts, filename, JSON.stringify(jsondata))
        await handleResponseAsync(resp);
    }

    async function handleResponseAsync(resp: td.WebResponse) {
        let code = resp.statusCode();
        let data: any = resp.contentAsJson() || { error: {} }

        logger.debug(`response ${resp.statusCode() } ${JSON.stringify(data) }`)

        if (code == 404 && data.error.code == 8) {
            logger.info(`create new translation file: ${filename}`)
            await uploadAsync("add-file", {})
        }
        else if (code == 404 && data.error.code == 17) {
            await createDirAsync(filename.replace(/\/[^\/]+$/, ""));
            await startAsync();
        } else if (code == 200) {
            return
        } else {
            throw new Error(`Error, upload translation: ${filename}, ${resp}, ${JSON.stringify(data) }`)
        }
    }

    await startAsync();
}

var inlineTags: td.SMap<number> = {
    b: 1,
    strong: 1,
    em: 1,
}

export function translate(html: string, locale: td.SMap<string>) {
    let missing = {}

    function translateOne(toTranslate: string): string {
        let spm = (/^(\s*)([^]*?)(\s*)$/.exec(toTranslate) || []);
        let text = spm[2].replace(/\s+/g, " ");
        if (text == "" || /^(@\w+@|\{[^\{\}]+\}|[^a-zA-Z]*|(&nbsp;)+)$/.test(text))
            return null;
        if (locale.hasOwnProperty(text))
            text = locale[text];
        else
            missing[text] = "";
        return spm[1] + text + spm[3];
    }

    html = html.replace(/<([\/\w]+)([^<>]*)>/g, (full: string, tagname: string, args: string) => {
        let key = tagname.replace(/^\//, "").toLowerCase();
        if (inlineTags[key] === 1)
            return "&llt;" + tagname + args + "&ggt;";
        return full;
    });

    function ungt(s: string) {
        return s.replace(/&llt;/g, "<").replace(/&ggt;/g, ">");
    }

    html = "<faketag>" + html;
    html = html.replace(/(<([\/\w]+)([^<>]*)>)([^<>]+)/g, (full: string, fullTag: string, tagname: string, args: string, str: string) => {
        if (tagname == "script" || tagname == "style")
            return ungt(full)

        let tr = translateOne(ungt(str));
        if (tr == null)
            return ungt(full);
        return fullTag + tr;
    });

    html = html.replace(/(<[^<>]*)(placeholder|alt|title)="([^"]+)"/g, (full: string, pref: string, attr: string, text: string) => {
        let tr = translateOne(text);
        if (tr == null) return full;
        return pref + attr + '="' + text.replace(/"/g, "''") + '"';
    });

    html = html.replace(/^<faketag>/g, "");
    return {
        text: html,
        missing: missing
    }
}

