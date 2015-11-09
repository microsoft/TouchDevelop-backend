/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as core from "./tdlite-core"
import * as microsoftTranslator from "./microsoft-translator"
import * as jwt from "./server-auth"

var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;

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
    
    if (!core.fullTD) return;
        
    let signKey = core.sha256bin(td.serverSetting("REVISION_SERVICE_SECRET")) 
    
    core.addRoute("POST", "*user", "storage", async(req) => {
        let now = await core.nowSecondsAsync()
        
        if (req.argument == "access_token") {
            core.meOnly(req);
            if (req.status != 200) return;

            let tok = jwt.createJwtHS256({
                iat: now,
                iss: "TouchDevelop",
                aud: "Revision Service",
                sub: req.rootId
            }, signKey)

            req.response = {
                access_token: tok
            }
        } else if (req.argument == "validate_token") {
            // don't really need to authenticate
            if (false && req.body["secret"] !== td.serverSetting("REVISION_SERVICE_SECRET"))
                req.status = httpCode._402PaymentRequired;
            else {
                let tok = jwt.decodeJwtVerify(td.toString(req.body["access_token"]), "HS256", signKey)
                let resp = {
                    valid: false,
                    expired: false
                }
                let err = undefined
                if (!tok)
                    err = "Token signature invalid"
                else if (tok.sub != req.rootId)
                    err = "Token for different user"
                else if (tok.aud != "Revision Service")
                    err = "Token not for revision service"
                else if (now - tok.iat > 24 * 3600 * 365) {
                    resp.expired = true
                    resp.valid = true
                    err = "Token expired"    
                } else {
                    resp.valid = true
                }

                req.response = resp
                if (err)
                    req.response["error"] = err
            }
        } else {
            req.status = httpCode._404NotFound;
        }
    })
}

