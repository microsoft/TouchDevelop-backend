/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as core from "./tdlite-core"

var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;

export async function initAsync()
{
    core.addRoute("POST", "ticks", "", async(req: core.ApiRequest) => {
        await core.throttleAsync(req, "ticks", 30); 
        if (req.status != 200) return;
        let js = req.body["sessionEvents"];
        if (js != null) {
            let allowed = core.currClientConfig.tickFilter || {}
            for (let evName of Object.keys(js)) {
                let tickName = evName.replace(/\|.*/, "")
                if (allowed.hasOwnProperty(tickName)) {
                    logger.customTick("app_" + tickName, {
                        repeat: td.clamp(0, 100, js[evName])
                    });
                }
            }
        }
        req.response = {};
    }, {
        noSizeCheck: true
    });
}

