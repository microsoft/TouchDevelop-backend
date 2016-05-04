/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

var asArray = td.asArray;

import * as parallel from "./parallel"
import * as restify from "./restify"
import * as indexedStore from "./indexed-store"
import * as core from "./tdlite-core"
import * as tdliteScripts from "./tdlite-scripts"
import * as audit from "./tdlite-audit"
import * as search from "./tdlite-search"
import * as notifications from "./tdlite-notifications"
import * as tdliteTdCompiler from "./tdlite-tdcompiler"
import * as tdliteDocs from "./tdlite-docs"
import * as tdliteData from "./tdlite-data"
import * as tdliteReleases from "./tdlite-releases"
import * as tdliteArt from "./tdlite-art"
import * as tdliteUsers from "./tdlite-users"
import * as tdliteI18N from "./tdlite-i18n"

export type StringTransformer = (text: string) => Promise<string>;

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;

var pointers: indexedStore.Store;
var deployChannels: string[];
export var templateSuffix: string = "";

export class PubPointer
    extends core.Publication {
    @td.json public path: string = "";
    @td.json public scriptid: string = "";
    @td.json public artid: string = "";
    @td.json public htmlartid: string = "";
    @td.json public releaseid: string = "";
    @td.json public redirect: string = "";
    @td.json public description: string = "";
    @td.json public comments: number = 0;
    @td.json public parentpath: string = "";
    @td.json public scriptname: string = "";
    @td.json public scriptdescription: string = "";
    @td.json public breadcrumbtitle: string = "";
    @td.json public customtick: string = "";
    @td.json public searchfeatures: string[] = [];
    static createFromJson(o: JsonObject) { let r = new PubPointer(); r.fromJson(o); return r; }
}

export async function reindexStoreAsync(req: core.ApiRequest, store: indexedStore.Store, processOneAsync: td.Action1<{}>) {
    if (!core.checkPermission(req, "operator")) return;
    let lst = await store.getIndex("all").fetchAsync("all", req.queryOptions);
    let resp = {
        continuation: lst.continuation,
        itemCount: lst.items.length,
        itemsReindexed: 0
    }
    await parallel.forJsonAsync(lst.items, async (e) => {
        await processOneAsync(e);
    }, 20)
    req.response = resp;
}

export async function initAsync(): Promise<void> {
    deployChannels = withDefault(td.serverSetting("CHANNELS", false), core.myChannel).split(",");
    templateSuffix = orEmpty(td.serverSetting("TEMPLATE_SUFFIX", true));

    // TODO cache compiler queries (with expiration)
    pointers = await indexedStore.createStoreAsync(core.pubsContainer, "pointer");
    core.registerPubKind({
        store: pointers,
        deleteWithAuthor: true,
        specialDeleteAsync: (id, entry) => /* async */ clearPtrCacheAsync(entry)
    })
    await core.setResolveAsync(pointers, async (fetchResult: indexedStore.FetchResult, apiRequest: core.ApiRequest) => {
        await core.addUsernameEtcAsync(fetchResult);
        let coll = (<PubPointer[]>[]);
        for (let jsb of fetchResult.items) {
            let ptr = PubPointer.createFromJson(jsb["pub"]);
            coll.push(ptr);
        }
        fetchResult.items = td.arrayToJson(coll);
    }, {
            byUserid: true,
            anonSearch: true
        });

    await pointers.createIndexAsync("rootns", entry => orEmpty(entry["id"]).replace(/^ptr-/, "").replace(/-.*/, ""));

    core.addRoute("GET", "pointers", "*", async (req) => {
        await core.anyListAsync(pointers, req, "rootns", req.verb);
    })

    core.addRoute("GET", "pointers", "doctoc", async (req) => {
        let lst = await pointers.getIndex("rootns").fetchAllAsync("docs");
        lst = lst.filter(e => !!e["pub"]["scriptid"])
        let tot = 0
        let totC = 0
        for (let e of lst) {
            e["children"] = [];
            e["orphan"] = true;
            e["pub"]["path"] = e["pub"]["path"].replace(/^\/+/, "");
            tot++;
        }
        let byPath = td.toDictionary(lst, e => e["pub"]["path"])
        for (let e of lst) {
            let pub = e["pub"]
            let par = pub["parentpath"]
            if (par != pub["path"] && par && byPath.hasOwnProperty(par)) {
                byPath[par]["children"].push(e)
                e["orphan"] = false;
                totC++
            }
        }
        let res = `tot:${tot}, ch:${totC}\n`
        let num = 0
        let dumpList = (ind: string, ee: {}[]) => {
            if (num++ > 1000) return;
            ee.sort((a, b) => td.strcmp(a["id"], b["id"]))
            for (let e of ee) {
                res += ind + e["pub"]["scriptname"] + " /" + e["pub"]["path"] + "\n"
                dumpList(ind + "    ", e["children"])
            }
        }
        dumpList("", lst.filter(e => e["orphan"]))
        req.response = res;
    })

    core.addRoute("GET", "*script", "cardinfo", async (req14: core.ApiRequest) => {
        let jsb1 = await getCardInfoAsync(req14, req14.rootPub);
        req14.response = td.clone(jsb1);
    });
    core.addRoute("POST", "pointers", "", async (req: core.ApiRequest) => {
        await core.canPostAsync(req, "pointer");
        if (req.status == 200) {
            let body = req.body;
            let ptr1 = new PubPointer();
            ptr1.path = orEmpty(body["path"]).replace(/^\/+/g, "");
            ptr1.id = pathToPtr(ptr1.path);
            if (!checkPostPointerPermissions(req))
                return;
            let matches = (/^usercontent\/([a-z]+)$/.exec(ptr1.path) || []);
            if (matches[1] == null) {
                if (td.startsWith(ptr1.path, "users/" + req.userid + "/")) {
                    core.checkPermission(req, "custom-ptr");
                }
                else {
                    core.checkPermission(req, "root-ptr");
                    if (req.status == 200 && !hasPtrPermission(req, ptr1.id)) {
                        req.status = httpCode._402PaymentRequired;
                    }
                }
            }
            else {
                let entry2 = await core.getPubAsync(matches[1], "script");
                if (entry2 == null || entry2["pub"]["userid"] != req.userid) {
                    core.checkPermission(req, "root-ptr");
                }
            }
            if (req.status == 200 && ! /^[\w\/\-@]+$/.test(ptr1.path)) {
                req.status = httpCode._412PreconditionFailed;
            }
            if (req.status == 200) {
                let existing = await core.getPubAsync(ptr1.id, "pointer");
                if (existing != null) {
                    req.rootPub = existing;
                    req.rootId = existing["id"];
                    await updatePointerAsync(req);
                }
                else {
                    ptr1.userid = req.userid;
                    ptr1.userplatform = core.getUserPlatforms(req);
                    let jsb1 = {};
                    jsb1["id"] = ptr1.id;
                    jsb1["pub"] = ptr1.toJson();
                    await setPointerPropsAsync(req, jsb1, body);
                    await pointers.insertAsync(jsb1);
                    await notifications.storeAsync(req, jsb1, "");
                    await search.scanAndSearchAsync(jsb1);
                    await clearPtrCacheAsync(jsb1);
                    await audit.logAsync(req, "post-ptr", {
                        newvalue: td.clone(jsb1)
                    });
                    await core.returnOnePubAsync(pointers, td.clone(jsb1), req);
                }
            }
        }
    });
    core.addRoute("POST", "*pointer", "", async (req1: core.ApiRequest) => {
        await updatePointerAsync(req1);
    });
    core.addRoute("GET", "*pointer", "history", async (req) => {
        if (!core.checkPermission(req, "root-ptr")) return;
        let fetchResult = await audit.queryPubLogAsync(req);
        fetchResult.items = fetchResult.items.filter(e => e["pub"]["type"] == "update-ptr");

        let last = fetchResult.items[fetchResult.items.length - 1]
        if (last && last["pub"]["oldvalue"] && last["pub"]["oldvalue"]["__version"] == 1) {
            let final = td.clone(last);
            let pub = last["pub"]["oldvalue"];
            final["pub"]["newvalue"] = pub;
            final["pub"]["oldvalue"] = null;
            final["pub"]["userid"] = pub["pub"]["userid"];
            final["pub"]["time"] = pub["pub"]["time"];
            fetchResult.items.push(final)
        }

        fetchResult.items = fetchResult.items.map(it => {
            let pub = it["pub"];
            let ptr = it["pub"]["newvalue"];
            let ptrpub = ptr["pub"];
            ptrpub["userid"] = pub["userid"];
            ptrpub["time"] = pub["time"];
            ptr["id"] = ptr["id"] + "@v" + ptr["__version"]
            if (pub["oldvalue"])
                ptr["oldscriptid"] = pub["oldvalue"]["pub"]["scriptid"];
            return ptr;
        });

        await core.addUsernameEtcAsync(fetchResult);
        fetchResult.items = fetchResult.items.map(jsb => {
            let ptr = PubPointer.createFromJson(jsb["pub"]);
            let ret = ptr.toJson();
            ret["oldscriptid"] = jsb["oldscriptid"];
            return ret;
        })

        req.response = fetchResult.toJson();
    });
    tdliteDocs.init(async (v: JsonBuilder) => {
        let wp = orEmpty(v["webpath"]);
        if (wp != "") {
            let ptrId = pathToPtr(wp.replace(/^\//g, ""));
            v["ptrid"] = ptrId;
            let entry = await core.getPubAsync(ptrId, "pointer");
            if (entry != null) {
                let s = entry["pub"]["scriptid"];
                if (orEmpty(s) != "") {
                    v["id"] = s;
                }
            }
        }
        let pubObj = await core.getPubAsync(v["id"], "script");
        if (pubObj != null) {
            v["isvolatile"] = true;
            let jsb2 = await getCardInfoAsync(core.emptyRequest, pubObj);
            // use values from expansion only if there are not present in v
            td.jsonCopyFrom(jsb2, td.clone(v));
            td.jsonCopyFrom(v, td.clone(jsb2));
        }
        let promotag = orEmpty(v["promotag"]);
        if (promotag != "") {
            let apiReq = core.buildApiRequest("/api/promo-scripts/all?count=50");
            let entities = await core.fetchAndResolveAsync(tdliteScripts.scripts, apiReq, "promo", promotag);
            v["promo"] = entities.items;
        }
    });
    core.addRoute("POST", "admin", "reindexpointers", async (req2: core.ApiRequest) => {
        core.checkPermission(req2, "operator");
        if (req2.status == 200) {
            /* async */ pointers.getIndex("all").forAllBatchedAsync("all", 50, async (json) => {
                await parallel.forJsonAsync(json, async (json1: JsonObject) => {
                });
            });
            req2.response = ({});
        }
    });

    core.addRoute("POST", "pointers", "reindex", async (req: core.ApiRequest) => {
        await reindexStoreAsync(req, pointers, async (ptr) => {
            let refx = await pointers.reindexAsync(ptr["id"], async (entry1: JsonBuilder) => {
                await setPointerPropsAsync(core.adminRequest, entry1, {});
            }, true);
            await audit.logAsync(req, "reindex-ptr", {
                oldvalue: ptr,
                newvalue: refx
            });
        });
    });

    restify.server().get("/:userid/oauth", async (req, res) => {
        let lang = await handleLanguageAsync(req);
        let uid = req.param("userid")
        let user = await tdliteUsers.getAsync(uid)

        if (!user) {
            let tmp = await errorHtmlAsync("User account not found", "No such user: /" + uid, lang)
            res.html(tmp, { status: httpCode._404NotFound })
        } else {
            let text = await simplePointerCacheAsync("templates/oauth", lang)
            text = await tdliteDocs.formatAsync(text, {
                id: uid,
                name: user.pub.name
            })
            res.html(text)
        }
    })

    if (core.pxt) {
        restify.server().get("/:scriptid/embed", async (req, res) => {
            let lang = await handleLanguageAsync(req);
            let sid = req.param("scriptid")
            let script = await core.getPubAsync(sid, "script")
            if (script && script["pub"]["target"]) {
                res.redirect(302, "/" + script["pub"]["target"] + "---run?id=" + script["id"])
            } else {
                let tmp = await errorHtmlAsync("Script not found", "No such script: /" + sid, lang)
                res.html(tmp, { status: httpCode._404NotFound })
            }
        })

        core.addRoute("GET", "md", "*", async (req) => {
            let lang = await handleLanguageAsync(req.restifyReq);
            let path = splitLang(pathToPtr(req.origUrl.slice(8)))
            if (path.lang == core.serviceSettings.defaultLang) path.lang = "";
            else if (!path.lang) path.lang = lang;
            let suff = lang ? "@" + lang : ""
            let ptr = await core.getPubAsync(path.base + suff, "pointer")
            if (!ptr && suff)
                ptr = await core.getPubAsync(path.base, "pointer")
            if (!ptr) {
                req.status = httpCode._404NotFound
            } else {
                let artobj = await core.getPubAsync(ptr["pub"]["artid"], "art")
                if (artobj && artobj["contentType"] == "text/markdown") {
                    let text = await getArtTextAsync(artobj)
                    req.responseContentType = artobj["contentType"]
                    req.response = text || "?"
                } else {
                    req.status = httpCode._400BadRequest
                }
            }
        })

        core.addRoute("GET", "oembed", "", async (req: core.ApiRequest) => {
            let id = orEmpty(req.queryOptions["url"]).replace(/^[a-z]+:\/\/[^\/]+/, "").replace(/^\/+/, "")
            let fmt = withDefault(req.queryOptions["format"], "json")
            if (fmt != "json" && fmt != "xml") {
                req.status = httpCode._501NotImplemented
                return
            }
            if (!/^[a-z]+$/.test(id)) {
                req.status = httpCode._404NotFound
                return
            }
            let scr = await core.getPubAsync(id, "script")
            if (!scr) {
                req.status = httpCode._404NotFound
                return
            }
            let target = scr["pub"]["target"]
            if (!target) {
                req.status = httpCode._404NotFound
                return
            }
            let aspect = 1.2 // TODO fetch from target            
            let w = parseInt(req.queryOptions["maxwidth"] || "0") || 0
            let h = parseInt(req.queryOptions["maxheight"] || "0") || 0
            if (w && h) {
                if (h * aspect > w)
                    h = w / aspect
                else
                    w = h * aspect
            } else if (w) {
                h = w / aspect
            } else if (h) {
                w = h * aspect
            } else {
                w = 480
                h = w / aspect
            }
            w = Math.floor(w)
            h = Math.floor(h)

            req.response = {
                "version": "1.0",
                "type": "rich",
                "provider_name": "PXT/" + target,
                "provider_url": core.self,
                "width": w,
                "height": h,
                "title": scr["pub"]["name"],
                // "author_name": "...", // TODO
                "author_url": core.self + scr["pub"]["userid"],
                "html": `<iframe width="${w}" height="${h}" src="${core.self}${scr["id"]}/embed" frameborder="0"></iframe>`
            }

            if (fmt == "xml") {
                let xml = `<?xml version="1.0" encoding="utf-8" standalone="yes"?><oembed>\n`
                for (let k of Object.keys(req.response)) {
                    let v = req.response[k] + ""
                    xml += `<${k}>${core.htmlQuote(v)}</${k}>\n`
                }
                xml += "</oembed>\n"
                req.response = xml
                req.responseContentType = "text/xml; charset=utf-8"
            }
        });
    }
}

export function pathToPtr(fn: string): string {
    let s: string;
    if (!fn) {
        return "";
    }
    s = "ptr-" + fn.replace(/^\/+/g, "").replace(/[^a-zA-Z0-9@]/g, "-").toLowerCase();
    return s;
}

async function extractMarkdownProps(artobj: {}, ptr: {}) {
    let pub = ptr["pub"]
    let textObj = await getArtTextAsync(artobj)

    if (!textObj) return

    let pubinfo = {}
    let dummy = tdliteDocs.renderMarkdown("", textObj, {}, pubinfo)

    pub["scriptname"] = pubinfo["title"] || "?"
    pub["scriptdescription"] = pubinfo["description"] || ""
    pub["breadcrumbtitle"] = pubinfo["short"] || pub["scriptname"]

    let parentTopic = null
    let currid = pub["path"];
    for (let i = 0; i < 5; i++) {
        currid = currid.replace(/[^\/]*$/g, "").replace(/\/$/g, "");
        if (currid == "") {
            break;
        }
        parentTopic = await core.getPubAsync(pathToPtr(currid), "pointer");
        if (parentTopic != null) {
            break;
        }
    }

    if (parentTopic != null) {
        let parentRedir = orEmpty(parentTopic["pub"]["redirect"]);
        if (parentRedir != "") {
            parentTopic = await core.getPubAsync(pathToPtr(parentRedir), "pointer");
        }
    }
    if (parentTopic != null) {
        pub["parentpath"] = parentTopic["pub"]["path"];
    }
}

async function setPointerPropsAsync(req: core.ApiRequest, ptr: JsonBuilder, body: JsonObject): Promise<void> {
    let pub = ptr["pub"];
    let empty = new PubPointer().toJson();
    for (let k of Object.keys(empty)) {
        if (!pub.hasOwnProperty(k)) {
            pub[k] = empty[k];
        }
    }
    core.setFields(pub, body, ["description", "scriptid", "redirect", "artid", "artcontainer", "releaseid", "htmlartid", "customtick", "path"]);
    pub["path"] = pub["path"].replace(/^\/+/, "");
    pub["parentpath"] = "";
    pub["scriptname"] = "";
    pub["scriptdescription"] = "";
    pub["searchfeatures"] = []
    let scriptobj = await core.getPubAsync(pub["scriptid"], "script");
    let artobj = scriptobj ? null : await core.getPubAsync(pub["artid"], "art")

    if (artobj == null) pub["artid"] = "";
    if (scriptobj == null) pub["scriptid"] = "";

    if (artobj && artobj["contentType"] == "text/markdown") {
        await extractMarkdownProps(artobj, ptr)
    }

    if (scriptobj) {
        for (let fn of ["target", "editor"]) {
            if (scriptobj["pub"][fn])
                pub["searchfeatures"].push("@" + fn + "-" + scriptobj["pub"][fn])
        }
        if (scriptobj["pub"]["islibrary"])
            pub["searchfeatures"].push("@library")
        pub["scriptname"] = scriptobj["pub"]["name"];
        pub["scriptdescription"] = scriptobj["pub"]["description"];
        await core.pubsContainer.updateAsync(scriptobj["id"], async (entry: JsonBuilder) => {
            entry["lastPointer"] = pub["id"];
        });
        let entry1 = await tdliteScripts.getScriptTextAsync(scriptobj["id"]);
        let parentTopic = (<JsonObject>null);
        if (entry1 != null) {
            let coll = (/{parent[tT]opic:([\w\/@\-]+)}/.exec(orEmpty(entry1["text"])) || []);
            let r = orEmpty(coll[1]);
            if (r != "") {
                parentTopic = await core.getPubAsync(pathToPtr(r), "pointer");
            }
            coll = (/{bread[Cc]rumb[tT]itle:([^{}]+)}/.exec(orEmpty(entry1["text"])) || []);
            pub["breadcrumbtitle"] = withDefault(coll[1], pub["scriptname"]);
        }
        if (parentTopic == null) {
            let currid = pub["path"];
            for (let i = 0; i < 5; i++) {
                currid = currid.replace(/[^\/]*$/g, "").replace(/\/$/g, "");
                if (currid == "") {
                    break;
                }
                parentTopic = await core.getPubAsync(pathToPtr(currid), "pointer");
                if (parentTopic != null) {
                    break;
                }
            }
        }
        if (parentTopic != null) {
            let parentRedir = orEmpty(parentTopic["pub"]["redirect"]);
            if (parentRedir != "") {
                parentTopic = await core.getPubAsync(pathToPtr(parentRedir), "pointer");
            }
        }
        if (parentTopic != null) {
            pub["parentpath"] = parentTopic["pub"]["path"];
        }
    }

    let relobj = await core.getPubAsync(pub["releaseid"], "release");
    if (relobj == null) {
        pub["releaseid"] = "";
    }

    let s = orEmpty(pub["redirect"]);
    if (!core.callerHasPermission(req, "post-raw") && ! /^\/[a-zA-Z0-9\/\-@]+$/.test(s)) {
        pub["redirect"] = "";
    }
}

async function checkPostPointerPermissions(req: core.ApiRequest) {
    if (req.body["htmlartid"])
        core.checkPermission(req, "post-raw");
    if (req.body["customtick"])
        core.checkPermission(req, "operator");
    return req.status == 200;
}

async function updatePointerAsync(req: core.ApiRequest): Promise<void> {
    if (req.userid == req.rootPub["pub"]["userid"]) {
    }
    else {
        core.checkPermission(req, "root-ptr");
        if (req.status == 200 && !hasPtrPermission(req, req.rootId)) {
            req.status = httpCode._402PaymentRequired;
        }
    }

    if (!checkPostPointerPermissions(req))
        return;

    if (req.status == 200) {
        let bld = await search.updateAndUpsertAsync(core.pubsContainer, req, async (entry: JsonBuilder) => {
            await setPointerPropsAsync(req, entry, req.body);
        });
        await audit.logAsync(req, "update-ptr", {
            oldvalue: req.rootPub,
            newvalue: td.clone(bld)
        });
        await clearPtrCacheAsync(bld);
        await core.returnOnePubAsync(pointers, td.clone(bld), req);
    }
}

async function getTargetThemeAsync(targetName: string) {
    let theme = null
    let pref = "ptr-"
    if (targetName) pref = pref + targetName + "-"
    let ptrx = await core.getPubAsync(pref + "theme-json", "pointer")
    if (ptrx && ptrx["pub"]["artid"])
        theme = await tdliteArt.getJsonArtFileAsync(ptrx["pub"]["artid"])
    return theme || {}
}

async function renderMarkdownAsync(ptr: PubPointer, artobj: {}, lang: string, targetName: string) {
    let theme = await getTargetThemeAsync(targetName)
    let textObj = await getArtTextAsync(artobj)
    if (!textObj) textObj = "Art object not found."
    let templ = await getTemplateTextAsync("templates/docs", lang)

    let breadcrumb: tdliteDocs.BreadcrumbEntry[] = [{
        name: ptr.breadcrumbtitle,
        href: "/" + ptr.path
    }]

    let path = ptr.parentpath;
    for (let i = 0; i < 5; i++) {
        let parJson = await core.getPubAsync(pathToPtr(path), "pointer");
        if (parJson == null) {
            break;
        }
        let parptr = PubPointer.createFromJson(parJson["pub"]);
        if (!parptr.breadcrumbtitle) break;
        breadcrumb.push({
            name: parptr.breadcrumbtitle,
            href: "/" + parptr.path
        })
        path = parptr.parentpath;
    }
    for (let e of breadcrumb) {
        if (td.startsWith(e.href.toLowerCase(), "/" + targetName))
            e.href = e.href.slice(targetName.length + 1)
    }
    if (!breadcrumb.some(e => e.href == "/docs"))
        breadcrumb.push({
            name: "Docs",
            href: "/docs"
        })
    breadcrumb.reverse()

    return tdliteDocs.renderMarkdown(templ, textObj, theme, {}, breadcrumb)
}

async function getArtTextAsync(artobj: {}) {
    let redisKey = "arttext:" + artobj["id"]
    let existing = await core.redisClient.getAsync(redisKey)
    if (existing != null) {
        return existing
    }
    let url = tdliteArt.getBlobUrl(artobj)
    let resp = await td.createRequest(url).sendAsync();
    let textObj = resp.content();
    if (textObj != null) {
        await core.redisClient.setpxAsync(redisKey, textObj, 7200 * 1000)
    }
    return textObj
}

async function getHtmlArtAsync(templid: string, lang: string) {
    let artjs = await core.getPubAsync(templid, "art");
    if (artjs == null) {
        return "Template art missing";
    }
    else if (orEmpty(artjs["contentType"]) == "text/plain") {
        let textObj = await getArtTextAsync(artjs)
        if (!textObj) {
            return "Art text not found.";
        }
        else {
            return tdliteI18N.translateHtmlAsync(textObj, lang);
        }
    }

}

export async function getTemplateTextAsync(templatename: string, lang: string): Promise<string> {
    let id = pathToPtr(templatename.replace(/:.*/g, ""));
    let entry3 = await core.getPubAsync(id + lang, "pointer");
    if (entry3 == null && lang != "") {
        entry3 = await core.getPubAsync(id, "pointer");
    }
    if (entry3 == null) {
        return "Template pointer leads to nowhere";
    }
    else if (entry3["pub"]["htmlartid"]) {
        return await getHtmlArtAsync(entry3["pub"]["htmlartid"], lang);
    }
    else {
        let templid = entry3["pub"]["scriptid"];
        let scriptjs = await core.getPubAsync(templid, "script");
        if (scriptjs == null) {
            return "Template script missing";
        }
        else if (orEmpty(scriptjs["pub"]["raw"]) == "html") {
            let textObj = await tdliteScripts.getScriptTextAsync(scriptjs["id"]);
            if (textObj == null) {
                return "Script text not found.";
            }
            else {
                return textObj["text"];
            }
        }
        else {
            return "Template has to be raw html";
            /*
                let resp3 = await tdliteTdCompiler.queryCloudCompilerAsync("q/" + scriptjs["id"] + "/string-art");
                if (resp3 == null) {
                    return "Extracting strings from template failed";
                }
                else {
                    let arts1 = asArray(resp3);
                    let artid = templatename.replace(/^[^:]*:?/g, "");
                    if (artid != "") {
                        arts1 = arts1.filter(elt => elt["name"] == artid);
                    }
                    if (arts1.length == 0) {
                        return "No art matching template name (if any)";
                    }
                    else {
                        return arts1[0]["value"];
                    }
                }
            */
        }
    }
}

async function clearPtrCacheAsync(entry: {}): Promise<void> {
    let id = td.toString(entry["id"])

    await tdliteReleases.cacheRewritten.updateAsync(cacheRoot(id), async (entry2: JsonBuilder) => {
        entry2["version"] = td.createRandomId(10);
    });

    if (td.startsWith(id, "ptr-templates-")) {
        await tdliteReleases.pokeReleaseAsync("cloud", 0);
    }
}

function fixupTDHtml(html: string): string {
    html = html
        .replace(/^<h1>[^<>]+<\/h1>/g, "")
        .replace(/<h2>/g, "<h2 class=\"beta\">")
        .replace(/(<a class="[^"<>]*" href=")\//g, (f, p) => p + core.self)
        .replace(/<h3>/g, "<h3 class=\"gamma\">");
    return html;
}

async function renderScriptAsync(scriptid: string, v: CachedPage, pubdata: JsonBuilder): Promise<void> {
    pubdata["done"] = false;
    pubdata["templatename"] = "";
    pubdata["msg"] = "";

    let scriptjs = await core.getPubAsync(scriptid, "script");
    if (!scriptjs) {
        pubdata["msg"] = "Pointed script not found";
        return
    }

    if (scriptjs["pub"]["target"]) {
        v.redirect = "/" + scriptid
        return
    }

    let editor = orEmpty(scriptjs["pub"]["editor"]);
    let raw = orEmpty(scriptjs["pub"]["raw"]);

    if (raw == "html") {
        let entry = await tdliteScripts.getScriptTextAsync(scriptjs["id"]);
        v.text = entry["text"];
        pubdata["done"] = true;
        return;
    }

    if (editor != "") {
        pubdata["msg"] = "Unsupported doc script editor";
        return;
    }

    td.jsonCopyFrom(pubdata, scriptjs["pub"]);
    pubdata["scriptId"] = scriptjs["id"];
    let userid = scriptjs["pub"]["userid"];
    let userjs = await tdliteUsers.getAsync(userid);
    let username = "User " + userid;
    let allowlinks = "";
    if (core.hasPermission(userjs, "external-links")) {
        allowlinks = "-official";
    }
    let resp2 = await tdliteTdCompiler.queryCloudCompilerAsync("q/" + scriptjs["id"] + "/raw-docs" + allowlinks);
    if (!resp2) {
        pubdata["msg"] = "Rendering failed";
        return;
    }

    let official = core.hasPermission(userjs, "root-ptr");
    if (userjs != null) {
        username = withDefault(userjs["pub"]["name"], username);
    }
    pubdata["username"] = username;
    pubdata["userid"] = userid;
    pubdata["body"] = fixupTDHtml(resp2["body"]);
    let desc = pubdata["description"];
    pubdata["hashdescription"] = desc;
    pubdata["description"] = desc.replace(/#\w+/g, "");
    pubdata["doctype"] = "Documentation";
    pubdata["time"] = scriptjs["pub"]["time"];
    let doctype = withDefault((/ptr-([a-z]+)-/.exec(pubdata["ptrid"]) || [])[1], "");
    if (!official && ! /^(users|usercontent|preview|)$/.test(doctype)) {
        official = true;
    }
    let pathConfig = core.serviceSettings.paths[doctype];
    if (pathConfig != null) {
        td.jsonCopyFrom(pubdata, pathConfig);
    }
    if (official) {
        let s = orEmpty((/#(page\w*)/.exec(desc) || [])[1]).toLowerCase();
        if (s == "") {
            pubdata["templatename"] = "templates/official-s";
        }
        else {
            pubdata["templatename"] = "templates/" + s + "-s";
        }
    }
    else {
        pubdata["templatename"] = "templates/users-s";
    }
}

function cacheRoot(ptrid: string) {
    return "ptrroot/" + splitLang(ptrid).base.replace(/---[a-z]+$/, "")
}

async function cacheRootVersionAsync(id: string, withCloud: boolean) {
    let rootObj = await tdliteReleases.cacheRewritten.getAsync(cacheRoot(id))
    let ver = withCloud ? await core.getCloudRelidAsync(true) : "simple";
    let rootVer = withDefault((rootObj || {})["version"], "none")
    return ver + "." + rootVer
}

async function rewriteAndCachePointerAsync(id: string, res: restify.Response, rewrite: td.Action1<CachedPage>): Promise<void> {
    let path = "ptrcache/" + core.myChannel + "/" + id;
    let rootTask = /* async */ cacheRootVersionAsync(id, true)
    let cachedPage = <CachedPage>(await tdliteReleases.cacheRewritten.getAsync(path));
    let ver = await rootTask

    let event = "ServePtr";
    let cat = "other";
    if (id == "ptr-home") {
        cat = "home";
    }
    else if (td.startsWith(id, "ptr-preview-")) {
        cat = "preview";
    }
    if (cachedPage == null || cachedPage.version != ver ||
        (core.orZero(cachedPage.expiration) > 0 && cachedPage.expiration < await core.nowSecondsAsync())) {
        let lock = await core.acquireCacheLockAsync(path);
        if (lock == "") {
            await rewriteAndCachePointerAsync(id, res, rewrite);
            return;
        }

        await tdliteTdCompiler.cacheCloudCompilerDataAsync(ver);

        cachedPage = {
            contentType: "text/html",
            version: ver,
            expiration: await core.nowSecondsAsync() + td.randomRange(2000, 3600),
            status: 200,
            error: false,
        };
        await rewrite(cachedPage);

        if (cachedPage.version == ver) {
            await tdliteReleases.cacheRewritten.updateAsync(path, async (entry: JsonBuilder) => {
                core.copyJson(cachedPage, entry);
            });
        }
        await core.releaseCacheLockAsync(lock);
        event = "ServePtrFirst";
    }

    if (res.finished()) {
        return;
    }
    let redir = orEmpty(cachedPage.redirect);
    if (redir == "") {
        let status0 = core.orZero(cachedPage.status);
        if (status0 == 0) {
            status0 = 200;
        }
        res.sendText(cachedPage.text, cachedPage.contentType, {
            status: status0
        });
        if (core.orFalse(cachedPage.error)) {
            cat = "error";
        }
        logger.debug("serve ptr2: " + event + " " + cat + " " + path);
        logger.measure(event + "@" + cat, logger.contextDuration());
    }
    else {
        res.redirect(302, redir);
    }

    if (cachedPage.customtick)
        logger.tick(cachedPage.customtick)
}

async function lookupScreenshotIdAsync(pub: {}) {
    let pref = core.currClientConfig.primaryCdnUrl + "/thumb1/"
    let text = await tdliteScripts.getScriptTextAsync(pub["id"]);
    if (text && text["text"]) {
        let m = /^var screenshot : Picture[^]*?url =.*?msecnd\.net\/pub\/([a-z]+)/m.exec(text["text"])
        if (m) return pref + m[1]
    }
    let id = pub["iconArtId"]
    if (id) return pref + id;

    let ss = await tdliteArt.getPubScreenshotsAsync(pub["id"], 1)
    if (ss[0]) {
        return pref.replace("thumb1", "pub") + ss[0]["id"]
    }

    return "";
}

async function renderStreamPageAsync(streamjson: {}, v: CachedPage, lang: string, domain: string) {
    let req = core.buildApiRequest("/api")
    let pub = await core.resolveOnePubAsync(tdliteScripts.scripts, streamjson, req);
    let templ = "templates/stream"

    let targetName: string = pub["target"]
    let theme = await getTargetThemeAsync(targetName)

    pub["humantime"] = tdliteDocs.humanTime(new Date(pub["time"] * 1000));
    pub["apiroot"] = "https://" + domain + "/api/"

    let templTxt = await getTemplateTextAsync(templ, lang)
    v.text = tdliteDocs.renderMarkdown(templTxt, "", theme, pub)
}

async function renderScriptPageAsync(scriptjson: {}, v: CachedPage, lang: string) {
    let req = core.buildApiRequest("/api")
    req.rootId = scriptjson["id"];    // this is to make sure we show hidden scripts
    let pub = await core.resolveOnePubAsync(tdliteScripts.scripts, scriptjson, req);
    let templ = "templates/script"

    if (core.pxt) {
        let targetName: string = pub["target"]
        let theme = await getTargetThemeAsync(targetName)
        let readmeMd = ""
        let textObj = await tdliteScripts.getScriptTextAsync(scriptjson["id"])
        if (textObj) {
            try {
                let files = JSON.parse(textObj["text"])
                readmeMd = files["README.md"] || ""
            } catch (e) {
            }
        }

        pub["humantime"] = tdliteDocs.humanTime(new Date(pub["time"] * 1000));
        pub["oembedurl"] = `${core.self}api/oembed?url=${encodeURIComponent(core.self + req.rootId)}`

        let templTxt = await getTemplateTextAsync(templ, lang)
        v.text = tdliteDocs.renderMarkdown(templTxt, readmeMd, theme, pub)
    } else {
        if (/#stepByStep/i.test(pub["description"]))
            templ = "templates/tutorial";
        else if (/#docs/i.test(pub["description"]))
            templ = "templates/docscript";

        pub["templatename"] = templ;
        pub["screenshoturl"] = await lookupScreenshotIdAsync(pub);
        await renderFinalAsync(pub, v, lang);
    }
}

interface CachedPage {
    contentType: string;
    version: string;
    redirect?: string;
    text?: string;
    error: boolean;
    customtick?: string;
    status: number;
    expiration: number;
}

function legacyKindPrefix(name: string) {
    name = name.replace(/^docs\//, "").toLowerCase();

    if (tdliteData.tdLegacyKinds.hasOwnProperty(name))
        return null;

    let len = Math.min(25, name.length)
    while (len > 0) {
        let sl = name.slice(0, len);
        if (tdliteData.tdLegacyKinds.hasOwnProperty(sl))
            return sl;
        len--;
    }
    return null;
}

var subFiles = {
    embed: "embed.js",
    run: "run.html",
    manifest: "release.manifest",
    worker: "worker.js",
    tdworker: "tdworker.js",
    simulator: "simulator.html",
    simmanifest: "sim.manifest",
    webmanifest: "sim.webmanifest",
}

function domainOfTarget(trg: string) {
    for (let domain of Object.keys(core.serviceSettings.domains)) {
        let path = core.serviceSettings.domains[domain]
        if (trg == path) return domain;
    }
    return null
}

function splitLang(path: string) {
    let m = /(.*)@([a-z]+(-[a-z]+)?)$/i.exec(path)
    if (m)
        return {
            base: m[1],
            lang: m[2]
        }
    else
        return {
            base: path,
            lang: ""
        }
}

export async function servePointerAsync(req: restify.Request, res: restify.Response): Promise<void> {
    let lang = await handleLanguageAsync(req);
    let urlFile = req.url().replace(/\?.*/g, "")
    let fn = urlFile.replace(/^\//g, "").replace(/\/$/g, "").toLowerCase();
    let bareFn = fn

    let baseDir = fn.replace(/[\/-].*/, "")
    let redirDomain = domainOfTarget(baseDir)
    if (redirDomain) {
        res.redirect(httpCode._301MovedPermanently, "https://" + redirDomain + "/" + req.url().slice(baseDir.length + 2))
        return
    }

    let host = (req.header("host") || "").toLowerCase()
    let vhostDirName = ""
    let hasVhosts = false
    let simulatorDomain = ""
    let isSimulator = /--sim[a-z]*$/.test(fn)

    if (core.serviceSettings.targetsDomain && host.startsWith("trg-") && host.endsWith("." + core.serviceSettings.targetsDomain)) {
        let trg = host.slice(4, host.length - 1 - core.serviceSettings.targetsDomain.length)
        if (domainOfTarget(trg)) {
            if (!isSimulator) {
                res.sendError(httpCode._404NotFound, "Only *--sim* URLs allowed in trg-* domains.")
                return
            }
            simulatorDomain = trg
            vhostDirName = trg
            fn = vhostDirName + "/" + fn
        }
    }

    if (!simulatorDomain) {
        if (isSimulator) {
            res.sendError(httpCode._404NotFound, "*--sim* URLs only allowed in trg-* domains.")
            return
        }

        for (let domain of Object.keys(core.serviceSettings.domains)) {
            hasVhosts = true
            let path = core.serviceSettings.domains[domain]
            if (domain == host) {
                vhostDirName = core.serviceSettings.domains[host].replace(/^\//, "")
                fn = vhostDirName + "/" + fn
                break
            }
        }

        if (hasVhosts && !vhostDirName && host && host != core.myHost) {
            res.redirect(httpCode._301MovedPermanently, core.self + req.url().slice(1))
            return
        }
    }

    fn = fn.replace(/\/$/g, "")

    if (fn == "") {
        fn = "home";
    }
    let id = pathToPtr(fn);
    let spl = splitLang(id)
    if (spl.lang != "") {
        if (spl.lang == core.serviceSettings.defaultLang) {
            id = spl.base;
            lang = "";
        }
        else {
            lang = "@" + spl.lang;
        }
    }
    if (templateSuffix != "" && core.serviceSettings.envrewrite.hasOwnProperty(id.replace(/^ptr-/g, ""))) {
        id = id + templateSuffix;
    }
    id = id + lang;

    if (!core.fullTD && req.query()["update"] == "true" && /^[a-z]+$/.test(fn)) {
        let entry = await core.getPubAsync(fn, "script")
        if (entry) {
            entry = await tdliteScripts.updateScriptAsync(entry)
            res.redirect(httpCode._302MovedTemporarily, "/app/#pub:" + entry["id"])
            return
        }
    }

    await rewriteAndCachePointerAsync(id, res, async (v: CachedPage) => {
        let pubdata = {};
        let errorAsync = async (msg: string) => {
            await pointerErrorAsync(msg, v, lang)
        }
        v.redirect = "";
        v.text = "";
        v.error = false;
        v.customtick = null;
        pubdata["webpath"] = fn;
        pubdata["ptrid"] = id;

        let subfile = ""

        let existing = await core.getPubAsync(id, "pointer");
        let spl = splitLang(id)
        if (existing == null && spl.lang) {
            existing = await core.getPubAsync(spl.base, "pointer");
        }

        if (!existing && id.indexOf("---") > 0) {
            let mm = /^(.*)---(.*)$/.exec(id)
            if (mm && subFiles.hasOwnProperty(mm[2].replace(/@..$/, ""))) {
                id = mm[1]
                subfile = subFiles[mm[2]]
            }
            existing = await core.getPubAsync(id, "pointer");
            if (existing && !existing["pub"]["releaseid"])
                existing = null
        }

        if (existing)
            v.customtick = existing["pub"]["customtick"]

        if (isSimulator && (!subfile || !existing)) {
            v.text = "Invalid trg-* reference: " + id
            v.contentType = "text/plain"
            return
        }

        if (existing == null) {
            if (td.startsWith(fn, "u/")) {
                v.redirect = fn.replace(/^u\//g, "/usercontent/");
            }
            else if (core.fullTD && fn.startsWith("blog/")) {
                v.redirect = fn.replace(/^blog/, "/docs")
            }
            else if (core.fullTD && fn.startsWith("docs/") && legacyKindPrefix(fn)) {
                let pref = legacyKindPrefix(fn);
                v.redirect = "/docs/" + pref + "#" + fn.slice(5 + pref.length)
            }
            else if (td.startsWith(fn, "preview/")) {
                await renderScriptAsync(fn.replace(/^preview\//g, ""), v, pubdata);
                await renderFinalAsync(pubdata, v, lang);
            }
            else if (/^[a-z]+$/.test(bareFn)) {
                let entry = await core.pubsContainer.getAsync(bareFn);
                if (entry == null || withDefault(entry["kind"], "reserved") == "reserved") {
                    await errorAsync("No such publication");
                }
                else {
                    let ekind = entry["kind"]
                    if (core.pxt && (ekind == "script" || ekind == "stream")) {
                        let domain = domainOfTarget(entry["pub"]["target"])
                        if (domain && domain != host) {
                            v.redirect = "https://" + domain + "/" + bareFn
                        } else {
                            if (ekind == "stream")
                                await renderStreamPageAsync(entry, v, lang, host)
                            else
                                await renderScriptPageAsync(entry, v, lang)
                        }
                    } else if (core.fullTD && ekind == "script") {
                        await renderScriptPageAsync(entry, v, lang)
                    } else {
                        v.redirect = "/app/#pub:" + entry["id"];
                    }
                }
            }
            else {
                await errorAsync("No such pointer");
            }
        }
        else {
            let ptr = PubPointer.createFromJson(existing["pub"]);
            if (ptr.redirect) {
                v.redirect = ptr.redirect;
            } else if (ptr.artid) {
                let artobj = await core.getPubAsync(ptr.artid, "art")
                if (!artobj) {
                    await errorAsync("No such art: /" + ptr.artid)
                } else {
                    if (artobj["contentType"] == "text/markdown") {
                        v.text = await renderMarkdownAsync(ptr, artobj, lang, vhostDirName)
                    } else {
                        v.redirect = core.currClientConfig.primaryCdnUrl + "/pub/" + (artobj["filename"] || artobj["id"]);
                    }
                }
            } else if (ptr.htmlartid) {
                v.text = await getHtmlArtAsync(ptr.htmlartid, lang);
                if (/-txt$/.test(ptr.id)) {
                    v.contentType = "text/plain; charset=utf-8"
                }
            } else if (ptr.releaseid) {
                let relname = ptr.path.replace(/^\/*[^-\/]+/, "").replace(/^[-\/]/, "")
                let relpref = relname ? "/" + relname + "---" : "/--"
                v.text = await tdliteReleases.getRewrittenIndexAsync(relpref, ptr.releaseid, subfile || "index.html")
                if (subfile.endsWith(".js"))
                    v.contentType = "application/javascript"
                else if (subfile.endsWith(".manifest"))
                    v.contentType = "text/cache-manifest"
                else if (subfile.endsWith(".webmanifest"))
                    v.contentType = "application/manifest+json"
            } else {
                let scriptid = ptr.scriptid;
                await renderScriptAsync(ptr.scriptid, v, pubdata);

                let path = ptr.parentpath;
                let breadcrumb = ptr.breadcrumbtitle;
                let sep = "&nbsp;&nbsp;»&nbsp; ";
                for (let i = 0; i < 5; i++) {
                    let parJson = await core.getPubAsync(pathToPtr(path), "pointer");
                    if (parJson == null) {
                        break;
                    }
                    let parptr = PubPointer.createFromJson(parJson["pub"]);
                    breadcrumb = "<a href=\"" + core.htmlQuote("/" + parptr.path) + "\">" + parptr.breadcrumbtitle + "</a>" + sep + breadcrumb;
                    path = parptr.parentpath;
                }
                breadcrumb = "<a href=\"/home\">Home</a>" + sep + breadcrumb;
                pubdata["breadcrumb"] = breadcrumb;

                await renderFinalAsync(pubdata, v, lang);
            }
        }
    });
}

async function renderFinalAsync(pubdata: {}, v: CachedPage, lang: string) {
    if (pubdata["msg"]) {
        await pointerErrorAsync(pubdata["msg"], v, lang);
        return;
    }
    if (pubdata["done"]) {
        return;
    }

    pubdata["css"] = tdliteTdCompiler.doctopicsCss;
    pubdata["rootUrl"] = core.currClientConfig.rootUrl;
    if (core.fullTD)
        pubdata["templatename"] = pubdata["templatename"].replace(/-s$/, "")
    if (!pubdata["body"]) pubdata["body"] = "";

    let templText = await getTemplateTextAsync(pubdata["templatename"] + templateSuffix, lang);
    if (templText.length < 100) {
        await pointerErrorAsync(templText, v, lang)
        return;
    }
    v.text = await tdliteDocs.formatAsync(templText, pubdata);
}

async function errorHtmlAsync(header: string, info: string, lang: string) {
    let pubdata = {
        name: header,
        body: core.htmlQuote(info)
    }

    let text = await simplePointerCacheAsync("error-template", lang);
    if (text.length > 100) {
        return await tdliteDocs.formatAsync(text, pubdata);
    } else {
        return core.htmlQuote(header + "; " + info + "; and also for /error-template: " + text)
    }
}

async function pointerErrorAsync(msg: string, v: CachedPage, lang: string) {
    v.expiration = await core.nowSecondsAsync() + 5 * 60;
    let header = "Whoops, something went wrong.";
    v.status = 500;
    if (td.startsWith(msg, "No such ")) {
        header = "Sorry, the page you were looking for doesn’t exist";
        v.status = 404;
    }
    v.error = true;
    v.text = await errorHtmlAsync(header, "Error message: " + msg, lang);
}

function hasPtrPermission(req: core.ApiRequest, currptr: string): boolean {
    currptr = splitLang(currptr).base
    while (currptr != "") {
        if (core.callerHasPermission(req, "write-" + currptr)) {
            return true;
        }
        else {
            let newptr = currptr.replace(/-[^\-]*$/g, "");
            if (newptr == currptr) {
                return false;
            }
            else {
                currptr = newptr;
            }
        }
    }
    return false;
}


export async function getCardInfoAsync(req: core.ApiRequest, pubJson: JsonObject): Promise<JsonBuilder> {
    let js3 = await core.resolveOnePubAsync(tdliteScripts.scripts, pubJson, req);
    if (js3 == null) {
        return {};
    }
    let scr = tdliteScripts.PubScript.createFromJson(js3);
    let jsb = td.clone(js3);
    jsb["description"] = scr.description.replace(/#docs/g, "");
    let vimeo = scr.meta["vimeo"];
    if (vimeo != null) {
        // TODO use thumbnail cache
        let js2 = await td.downloadJsonAsync("https://vimeo.com/api/oembed.json?url=https%3A//vimeo.com/" + vimeo);
        jsb["vimeo"] = vimeo;
        jsb["fullpicture"] = js2["thumbnail_url"];
        jsb["thumbnail"] = js2["thumbnail_url"].replace(/_\d+\./g, "_512.");
        //  let s2 = td.replaceAll("<iframe src=\"https://player.vimeo.com/video/{vimeo}\" width=\"500\" height=\"281\" frameborder=\"0\" webkitallowfullscreen mozallowfullscreen allowfullscreen></iframe>", "{vimeo}", vimeo);
    }
    let artid = orEmpty(scr.meta["art"]);
    if (artid != "") {
        jsb["fullpicture"] = core.currClientConfig.primaryCdnUrl + "/pub/" + artid;
        jsb["thumbnail"] = core.currClientConfig.primaryCdnUrl + "/thumb1/" + artid;
    }
    if (scr.editor == "blockly") {
        td.jsonCopyFrom(jsb, ({
            "editorname": "Block Editor",
            "editor": "blocks",
            "editorhtml": "Microsoft Block Editor"
        }));
    }
    else {
        td.jsonCopyFrom(jsb, ({
            "editorname": "Touch Develop",
            "editor": "touchdevelop",
            "editorhtml": "Microsoft Touch Develop"
        }));
    }
    jsb["timems"] = scr.time * 1000;
    jsb["realid"] = scr.id;
    jsb["humantime"] = tdliteDocs.humanTime(new Date(jsb["timems"]))
    return jsb;
}


export async function handleLanguageAsync(req: restify.Request, simple = false): Promise<string> {
    if (!req) return "";

    await core.refreshSettingsAsync();
    let lang = core.serviceSettings.defaultLang;
    for (let s of orEmpty(req.header("Accept-Language")).split(",")) {
        let headerLang = orEmpty((/^\s*([a-z][a-z])/.exec(s) || [])[1]);
        if (core.serviceSettings.langs.hasOwnProperty(headerLang)) {
            lang = headerLang;
            break;
        }
    }
    let cookieLang = orEmpty((/TD_LANG=([A-Za-z\-]+)/.exec(orEmpty(req.header("Cookie"))) || [])[1]);
    if (core.serviceSettings.langs.hasOwnProperty(cookieLang)) {
        lang = cookieLang;
    }
    if (lang == core.serviceSettings.defaultLang) {
        lang = "";
    }
    else {
        lang = "@" + lang;
    }
    return lang;
}

export async function simplePointerCacheAsync(urlPath: string, lang: string): Promise<string> {
    urlPath = urlPath + templateSuffix;
    let id = pathToPtr(urlPath);
    let rootTask = /* async */ cacheRootVersionAsync(id, true)
    let path = "ptrcache/" + core.myChannel + "/" + id + lang;
    let entry2 = await tdliteReleases.cacheRewritten.getAsync(path);
    let versionMarker = await rootTask;
    if (entry2 == null || orEmpty(entry2["version"]) != versionMarker) {
        let jsb2 = {};
        jsb2["version"] = versionMarker;
        let r = await getTemplateTextAsync(urlPath, lang);
        jsb2["text"] = orEmpty(r);
        entry2 = td.clone(jsb2);
        await tdliteReleases.cacheRewritten.updateAsync(path, async (entry: JsonBuilder) => {
            core.copyJson(entry2, entry);
        });
    }
    return orEmpty(entry2["text"]);
}

