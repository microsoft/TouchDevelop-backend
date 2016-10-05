/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as core from "./tdlite-core"
import * as microsoftTranslator from "./microsoft-translator"
import * as jwt from "./server-auth"
import * as tdliteLogin from "./tdlite-login"

var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;

interface ProxyHeader {
    name: string;
    value: string;
}
interface ProxyCreds {
    name: string;
    password: string;
}
interface ProxyReq {
    url: string;
    method: string;
    contentText?: string;
    content?: string;
    responseType: string;
    headers?: ProxyHeader[];
    credentials?: ProxyCreds;
}

export async function initAsync()
{
    if (core.hasSetting("MICROSOFT_TRANSLATOR_CLIENT_SECRET")) {
        await microsoftTranslator.initAsync();
    }

    core.addRoute("POST", "runtime", "translate", async (req: core.ApiRequest) => {
        // TODO figure out the right permission here and throttle
        core.checkPermission(req, "root-ptr");
        if (req.status != 200) {
            return;
        }
        let text = orEmpty(req.body["html"]);
        let ishtml = true;
        if (text == "") {
            text = orEmpty(req.body["text"]);
            ishtml = false;
        }
        let jsb = {};
        if (text == "") {
            jsb["translated"] = "";
        }
        else {
            let translated = await microsoftTranslator.translateAsync(text, orEmpty(req.body["from"]), orEmpty(req.body["to"]), ishtml);
            if (translated == null) {
                req.status = httpCode._424FailedDependency;
            }
            else {
                jsb["translated"] = translated;
            }
        }
        req.response = td.clone(jsb);
    });
    
    if (!core.fullTD || core.pxt) return;
        
    let encKey = core.sha256bin(core.tokenSecret + ":revision");         
    
    core.addRoute("POST", "*user", "storage", async(req) => {
        let now = await core.nowSecondsAsync()
        let pref = "EnC.REVISIONTOKEN"
        
        if (req.argument == "access_token") {
            if (req.rootId != req.userid) {
                req.status = httpCode._402PaymentRequired;
                return;
            }

            let tok = req.userinfo.token.asString()
            let enc = core.encrypt(tok, "REVISIONTOKEN")

            assert(tok != enc)

            enc = enc.replace(/\$/g, ".").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

            req.response = {
                access_token: enc.slice(pref.length)
            }
        } else if (req.argument == "validate_token") {
            if (req.body["secret"] !== td.serverSetting("REVISION_SERVICE_SECRET")) {
                req.status = httpCode._402PaymentRequired;
            } else {
                let enc = td.toString(pref + req.body["access_token"]).replace(/\./g, "$").replace(/-/g, "+").replace(/_/g, "/")
                let dec = core.decrypt(enc)
                let err = ""
                let resp = {
                    valid: false,
                    expired: false
                }
                if (dec != enc) {
                    let tok = await tdliteLogin.lookupTokenAsync(dec)
                    if (!tok) {
                        err = "No such token"
                    } else if (tok.PartitionKey != req.rootId) {
                        err = "Wrong user"
                    } else {
                        resp.valid = true;
                    }
                } else {
                    err = "Cannot decrypt token"
                }
                req.response = resp;
                if (err)
                    req.response["error"] = err
            }
        } else {
            req.status = httpCode._404NotFound;
        }
    })
    
    let forbiddenHeaders = {
        "content-length": 1,
        "accept-encoding": 1,
        "accept-charset": 1,
        "connection": 1,
        "keep-alive": 1,
        "transfer-encoding": 1,
        "content-transfer-encoding": 1,
        "upgrade": 1,
    }
    
    core.addRoute("GET", "runtime", "web", async(req) => {
        if (req.argument != "proxy") {
            req.status = httpCode._404NotFound;
            return;
        }

        if (!req.isTopLevel) {
            req.status = httpCode._400BadRequest;
            return;
        }

        let url = td.toString(req.queryOptions["url"])
        
        if (!/^https?:\/\//.test(url)) {
            req.status = httpCode._400BadRequest;
            return;            
        }
            
        let isAnon = false;

        if (!url.startsWith(core.currClientConfig.primaryCdnUrl)) {
            await core.throttleAsync(req, "web-proxy", 10);
            if (!core.checkPermission(req, "web-proxy"))
                return;
        } else {
            isAnon = true;
        }

        let r = td.createRequest(url);
        let resp = await r.sendAsync();

        let buf = resp.contentAsBuffer() || new Buffer(0);

        if (buf.length > 5 * 1024 * 1024) {
            req.status = 504;
            return;
        }

        let cresp = req.restifyReq.response

        if (!isAnon) {
            await core.throttleAsync(req, "web-proxy", Math.round(buf.length / 10000));
            if (req.status != 200) return;
        }

        for (let hn of resp.headerNames())
            if (!/^(content-(encoding|length))$/i.test(hn))
                cresp.setHeader(hn, resp.header(hn))
        cresp.setHeader("TouchDevelop-Gateway", "true");
        cresp.sendBuffer(buf, resp.header("content-type") || "application/octet-stream", {
            status: resp.statusCode()
        })
    })
    
    core.addRoute("POST", "runtime", "web", async(req) => {
        if (req.argument != "request") {
            req.status = httpCode._404NotFound;
            return;            
        }
        
        await core.throttleAsync(req, "web-proxy", 10);        
        if (!core.checkPermission(req, "web-proxy"))
            return;
                        
        let data = <ProxyReq>req.body;
        let rtype = td.toString(data.responseType);

        if (!/^https?:\/\//.test(data.url)) {
            req.status = httpCode._400BadRequest;
            return;            
        }            
        
        if (rtype != "text" && rtype != "base64") {
            req.status = httpCode._412PreconditionFailed;
            return;
        }
        
        let r = td.createRequest(td.toString(data.url))
        if (data.headers)
            for (let h of data.headers) {
                let hname = td.toString(h.name)
                if (forbiddenHeaders.hasOwnProperty(hname.toLowerCase()))
                    continue;
                r.setHeader(hname, td.toString(h.value))
            }
        if (data.credentials)
            r.setCredentials(td.toString(data.credentials.name), td.toString(data.credentials.password));
        r.setMethod(core.withDefault(data.method, "GET"))
        if (data.contentText != null)
            r.setContent(data.contentText)
        else if (data.content != null)
            r.setContentAsBuffer(new Buffer(data.content, "base64"));
        
        let resp = await r.sendAsync();
        let buf = resp.contentAsBuffer()
        if (buf && buf.length > 2 * 1024 * 1024)
            req.status = 504;
        else {
            if (!buf) buf = new Buffer(0);
            await core.throttleAsync(req, "web-proxy", Math.round(buf.length / 10000));
            if (req.status != 200) return;
            let hd:ProxyHeader[] = []
            for (let hn of resp.headerNames())
                if (!/^(content-(encoding|length))$/i.test(hn))
                    hd.push({ name: hn, value: resp.header(hn) })
            hd.push({ name: "TouchDevelop-Gateway", value: "true" });
            req.response = {
                code: resp.statusCode(),
                headers: hd,
                contentBase64: rtype == "base64" ? buf.toString("base64") : undefined,
                contentText: rtype == "text" ? buf.toString("utf8") : undefined,
            }
        }
    })
    
    core.addRoute("POST", "*user", "jwt", async(req) => {
        core.meOnly(req)
        if (req.status != 200) return;
        let now = await core.nowSecondsAsync();
        let tok: jwt.JwtPayload = {
            iss: "touchdevelop-usersign",
            sub: "u-" + req.userid + "@touchdevelop.com",
            iat: now,
            jti: td.createRandomId(10),
            aud: core.withDefault(req.body["aud"], "Anything"),
        }
        let jtok = jwt.createJwtRS256(tok, td.serverSetting("TOKEN_SIGN_PRIV_KEY"))
        req.response = {
            jwt: jtok
        }
    })
    
    core.addRoute("GET", "jwt", "info", async(req) => {
        req.response = {
            RS256: td.serverSetting("TOKEN_SIGN_PUB_KEY") 
        }
    })
}
