/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as azureTable from "./azure-table"
import * as azureBlobStorage from "./azure-blob-storage"
import * as cachedStore from "./cached-store"
import * as core from "./tdlite-core"
import * as cron from "./cron"

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;

var includeCats: td.SMap<string>;
var stripCats: td.SMap<string>;
var pending = 0;
var pendingCounters: td.SMap<number> = {};
var countersContainer: cachedStore.Container;

var workKey= "tdcnts:current"

function logMeasure(cat: string, id: string, v: number, meta: any) {
    if (!includeCats.hasOwnProperty(cat))
        return;
    pending++;
    if (stripCats.hasOwnProperty(cat))
        cat = "";
    let fullname = cat + ":" + id
    if (/:Api/.test(fullname))
        fullname = fullname.replace(/@.*/, "")
    fullname = fullname.replace(/^:+/, "")
    if (!pendingCounters.hasOwnProperty(fullname))
        pendingCounters[fullname] = 0;
    let repeat = meta && meta.repeat ? meta.repeat : 1;
    pendingCounters[fullname] += repeat;
}

var incrementLua =
    `
local toadd = cjson.decode(ARGV[1])
local curr  = cjson.decode(redis.call("GET", KEYS[1]) or "{}")
for k, v in pairs(toadd) do
  curr[k] = (curr[k] or 0) + v
end
redis.call("SET", KEYS[1], cjson.encode(curr))
return "OK"
`;

var extractLua =
    `
local curr = redis.call("GET", KEYS[1]) or "{}"
redis.call("SET", KEYS[1], "{}")
return curr
`;

async function sendLoopAsync()
{
    while (true) {
        await td.sleepAsync(td.randomRange(15, 20));
        if (pending > 0) {
            let cnt = JSON.stringify(pendingCounters);
            pending = 0;
            pendingCounters = {};                        
            let res = await core.redisClient.evalAsync(incrementLua, [workKey], [cnt]);
            logger.debug("stored counters: " + JSON.stringify(res) + " - " + cnt)
        }
    }    
}

function dayAligned(time: number)
{
    let day = Math.floor(time / (24 * 3600))
    return day * 24 * 3600;    
}

function dayIdForTime(time: number) {
    let dayalignedMs = dayAligned(time) * 1000;
    return (20000000000000 - dayalignedMs).toString();
}

function addCounters(trg0: {}, src: {}) {
    let trg = trg0["counters"] || {};
    trg0["counters"] = trg;
    for (let k of Object.keys(src)) {
        if (!trg.hasOwnProperty(k))
            trg[k] = 0;
        trg[k] += core.orZero(src[k]);
    }
}

async function flushCountersAsync()
{
    let r = await core.redisClient.evalAsync(extractLua, [workKey], []);
    let redisCounters = JSON.parse(<string>r);
    let now = await core.nowSecondsAsync()
    let alignedTime = dayAligned(now);
    let id = dayIdForTime(now);
    
    await countersContainer.updateAsync(id, async(v) => {
        addCounters(v, redisCounters);     
    })
    await countersContainer.updateAsync("total", async(v) => {
        addCounters(v, redisCounters);
        v["min"] = v["min"] ? Math.min(v["min"], alignedTime) : alignedTime;
        v["max"] = v["max"] ? Math.min(v["max"], alignedTime) : alignedTime;
    })    
}

export async function initAsync(include: string[]): Promise<void> {
    countersContainer = await cachedStore.createContainerAsync("counters")   
    includeCats = td.toDictionary(include, v => v);
    stripCats = {}
    stripCats[include[0]] = "yes";
    
    td.App.addTransport({
        logTick: function(cat, id, meta) {
            logMeasure(cat, id, 1, meta);
        },
        logMeasure: logMeasure,
    });
    
    cron.registerJob(new cron.Job("flushcounters", 1, flushCountersAsync));
 
    core.addRoute("POST", "dailystats", "", async(req) => {
        if (!core.checkPermission(req, "stats"))
            return;
        
        let maxlen = 366;
        let now = await core.nowSecondsAsync();
        let startTime = core.orZero(req.body["start"])
        if (startTime <= 0) startTime = now - maxlen * 24 * 3600;
        let len = td.clamp(1, maxlen, core.orZero(req.body["length"]));
        let fields = td.toStringArray(req.body["fields"]) ||
                     ["New_script", "New_script_hidden", "New_art", "New_comment", "PubUser@federated"]
        
        let totals = await countersContainer.getAsync("total");
        
        startTime = td.clamp(totals["min"], totals["max"], startTime)
        startTime = dayAligned(startTime)
        let ids: string[] = []
        for (let i = 0; i < len; ++i) {
            let curr = startTime + i * 24 * 3600;
            if (curr > totals["max"])
                break;
            ids.push(dayIdForTime(curr))
        }
        len = ids.length;
        
        let vals = await countersContainer.getManyAsync(ids);
        let res = {}
        for (let fld of fields) {
            let arr = []
            for (let j = 0; j < len; ++j) {
                let v = 0
                if (vals[j] && vals[j]["counters"])
                    v = core.orZero(vals[j]["counters"][fld])
                arr.push(v)
            }
            res[fld] = arr
        }
        
        req.response = {
            start: startTime,
            length: len,
            values: res,
        }        
    })
            
    core.addRoute("GET", "stats", "", async(req) => {
        if (!core.fullTD && !core.checkPermission(req, "stats"))
            return;
        
        let totals = await countersContainer.getAsync("total") || {}
        totals = totals["counters"] || {}
        req.response = {
            scripts: core.orZero(totals["New_script"]) + core.orZero(totals["New_script_hidden"]),
            publicScripts: core.orZero(totals["New_script"]),
            users: core.orZero(totals["PubUser@federated"]) + core.orZero(totals["PubUser@code"]),
            comments: core.orZero(totals["New_comment"]),
            art: core.orZero(totals["New_art"]),            
        }
    })
        
    core.addRoute("GET", "admin", "counters", async(req) => {
        if (!core.checkPermission(req, "root")) return;
        let s = await core.redisClient.getAsync(workKey)
        let now = await core.nowSecondsAsync();
        req.response = {
            unflushed: JSON.parse(s || "{}"),
            today: await countersContainer.getAsync(dayIdForTime(now)),
            total: await countersContainer.getAsync("total"),
        }
    })
        
    core.addRoute("POST", "admin", "totalcounters", async(req) => {
        if (!core.checkPermission(req, "root")) return;
        let last = await countersContainer.updateAsync("total", async(v) => {
            addCounters(v, req.body)
            let c = v["counters"]
            for (let k of Object.keys(c))
                if (c[k] === 0)
                    delete c[k];
        })
        req.response = last
    })
        
    core.addRoute("DELETE", "admin", "counters", async(req) => {
        if (!core.checkPermission(req, "root")) return;
        // guard against accidents
        if (req.argument != "delete-total-stats-forever") {
            req.status = core.httpCode._412PreconditionFailed;
            return
        }
        await core.redisClient.delAsync(workKey)
        let now = await core.nowSecondsAsync();
        await countersContainer.updateAsync(dayIdForTime(now), async(v) => { delete v["counters"]; })
        await countersContainer.updateAsync("total", async(v) => { delete v["counters"]; })
        req.response = {}
    })
    
    core.addRoute("POST", "admin", "lua", async(req) => {
        if (!core.checkPermission(req, "root")) return;        
        let s = await core.redisClient.evalAsync(req.body["script"], req.body["keys"] || [], req.body["args"] || [])
        req.response = {
            resp: s
        }
    })
    
    /* async */ sendLoopAsync();
}
