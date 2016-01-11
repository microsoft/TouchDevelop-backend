/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;


import * as azureTable from "./azure-table"
import * as azureBlobStorage from "./azure-blob-storage"
import * as cachedStore from "./cached-store"
import * as counters from "./tdlite-counters"
import * as core from "./tdlite-core"
import * as cron from "./cron"

var logger = core.logger;
var httpCode = core.httpCode;

var progressContainer: cachedStore.Container;
var userProgressContainer: cachedStore.Container;
var prefix = "tprg:"
var idxKey = prefix + "INDEX"
var numEntries = 0;


var addLua =
    `
local idxid = KEYS[1]
local eltid = KEYS[2]
redis.call("SADD", idxid, eltid)
redis.call("LPUSH", eltid, ARGV[1])
`;

var extractLua =
    `
local idxid = KEYS[1]
local eltid = KEYS[2]
local len = redis.call("LLEN", eltid)
local maxlen = 50000
local res = redis.call("LRANGE", eltid, 0, maxlen)
if len < maxlen then
  redis.call("DEL", eltid)
  redis.call("SREM", idxid, eltid)
else
  redis.call("LTRIM", eltid, maxlen, len)
end
return res
`;


export interface Measure {
    min: number;
    max: number;
    sum: number;
    cnt: number;
}

type MultiMeasure = td.SMap<Measure>;

export function singleMeasure(v: number):Measure
{    
    return {
        min: v,
        max: v,
        sum: v,
        cnt: 1
    }
}

export function addMeasures(a: Measure, b: Measure): Measure
{
    return {
        min: Math.min(a.min, b.min),
        max: Math.max(a.max, b.max),
        sum: a.sum + b.sum,
        cnt: a.cnt + b.cnt
    }
}

export function addToMultiMeasure(trg: MultiMeasure, src:MultiMeasure)
{
    for (let k of Object.keys(src)) {
        if (trg.hasOwnProperty(k))
            trg[k] = addMeasures(trg[k], src[k]);
        else
            trg[k] = src[k];
    }
}

interface ProgressPostData {
    progressId: string;
    index: number;
    duration: number;
    text: string; // not used
    helpCalls: number;
    goalTips: number;
    modalDuration: number;
    playDuration: number;
}

var maxForField: {} = {
    duration: 300,
    helpCalls: 30,
    goalTips: 30,
    modalDuration: 300,
    playDuration: 300,
    index: 100,
}

async function storeOneInfoAsync()
{
    let members = await core.redisClient.smembersAsync(idxKey)
    logger.debug(`save progress members: ${members.length}`)
    if (members.length == 0)
        return true;
    let elt = members[td.randomInt(members.length)]
    let scriptId = elt.replace(/.*:/, "");
    let entries = <string[]>await core.redisClient.evalAsync(extractLua, [idxKey, elt], [])
    logger.debug(`save progress entries: ${entries.length}`)
    if (entries.length == 0)
        return false;
    
    let measures: td.SMap<Measure> = {};
    
    for (let e of entries) {
        let d = <ProgressPostData>JSON.parse(e);
        let tmp: MultiMeasure = {};
        for (let k of Object.keys(maxForField)) {
            tmp[d.index + "/" + k] = singleMeasure(d[k]) 
        }
        addToMultiMeasure(measures, tmp)
    }
    
    let now = await core.nowSecondsAsync()
    let alignedTime = counters.dayAligned(now);
    let id = counters.dayIdForTime(now);
    
    let addMeasure = (v: {}) => {
        if (!v["measures"]) v["measures"] = {};
        addToMultiMeasure(v["measures"], measures)        
    }
    
    await progressContainer.updateAsync(scriptId + "/" + id, async(v) => {
        addMeasure(v);
    })
    await progressContainer.updateAsync(scriptId + "/total", async(v) => {
        addMeasure(v);
        v["min"] = v["min"] ? Math.min(v["min"], alignedTime) : alignedTime;
        v["max"] = v["max"] ? Math.max(v["max"], alignedTime) : alignedTime;
    })        
    
    return false;
}

export async function timeLimitedAsync(maxMs: number, isDoneAsync: () => Promise<boolean>)
{
    let start = Date.now();
    let maxIter = 10;
    while (maxIter-- > 0) {
        let runtime = Date.now() - start;
        if (runtime > maxMs)
            return false;
        let isDone = await isDoneAsync();        
        if (isDone)
            return true;
    }    
    return false;
}

async function storeLoopAsync()
{
    let lastNum = 0;
    while (true) {
        await td.sleepAsync(td.randomRange(1, 10));
        if (lastNum == numEntries && td.randomNormalized() > 0.1) continue;
        if (!cron.seemsAlive()) continue;
        lastNum = numEntries;
        let isDone = await timeLimitedAsync(5000, storeOneInfoAsync)
        logger.debug(`stored progress entries; ${isDone} ${lastNum} ${numEntries}`)
        if (!isDone) lastNum--;
    }
}

interface Progress {
    guid?: string;
    index?: number;
    completed?: number;
    numSteps?: number;
    lastUsed?: number;
}


export async function initAsync(): Promise<void> {
    progressContainer = await cachedStore.createContainerAsync("progress")
    userProgressContainer = await cachedStore.createContainerAsync("userprogress")
    
    /* async */ storeLoopAsync();
    
    core.addRoute("POST", "*user", "progress", async (req: core.ApiRequest) => {
        core.meOnly(req);        
        if (req.status != 200) return;
        
        await userProgressContainer.updateAsync(req.rootId, async(v) => {
            let oldData = v["progress"] || {}
            
            for (let id of Object.keys(req.body)) {
                var oldProgress = <Progress>oldData[id] || <Progress>{};
                var progress = <Progress>req.body[id];
                if (oldProgress.index === undefined || oldProgress.index <= progress.index) {
                    if (progress.guid) oldProgress.guid = td.orEmpty(progress.guid);
                    oldProgress.index = core.orZero(progress.index);
                    if (progress.completed && (oldProgress.completed === undefined || oldProgress.completed > progress.completed))
                        oldProgress.completed = core.orZero(progress.completed);
                    oldProgress.numSteps = core.orZero(progress.numSteps);
                    oldProgress.lastUsed = core.orZero(progress.lastUsed);
                }
                oldData[id] = oldProgress;
            }
            
            // TODO maybe put something wiser here
            if (JSON.stringify(oldData).length > 100000)
                oldData = {}
            
            v["progress"] = oldData;             
        })
        
        req.response = {};
    });
    
    core.addRoute("GET", "*user", "progress", async(req: core.ApiRequest) => {
        // TODO special permission?
        let data = await userProgressContainer.getAsync(req.rootId)
        let items = []
        if (data) {
            let prog = data["progress"]
            for (let id of Object.keys(prog)) {
                let v = <Progress>prog[id];
                items.push({
                    kind: "progress",
                    userid: req.rootId,
                    progressid: id,
                    guid: v.guid,
                    index: v.index,
                    completed: v.completed
                })
            }
        }
        req.response = {
            kind: "list",
            items: items,
            continuation: null
        }
    })

    core.addRoute("POST", "progress", "", async(req) => {
        
        await core.throttleAsync(req, "progress", 20);
        if (req.status != 200) return;
        
        let d = <ProgressPostData>req.body;
        if (!/^[a-z]+/.test(d.progressId) || d.progressId.length > 20) {
            req.status = httpCode._400BadRequest;
            return;
        }
        
        let scr = await core.getPubAsync(d.progressId, "script")
        if (!scr) {
            req.status = httpCode._404NotFound;
            return;            
        }

        let r = {}
        for (let k of Object.keys(maxForField)) {
            let v = td.clamp(0, maxForField[k], core.orZero(d[k]))
            r[k] = v
        }
        
        let data = JSON.stringify(r)
        logger.debug(`saving progress: ${d.progressId} ${data} #${numEntries}`)
        await core.redisClient.evalAsync(addLua, [idxKey, prefix + d.progressId], [data])
        numEntries++;
        req.response = {}
    })
    
    core.addRoute("GET", "*script", "progressstats", async(req) => {
        // TODO special permission?
        let days = await counters.fetchDaysAsync(progressContainer, req.rootId + "/", req.queryOptions)
        
        let resp = {
            kind: "progressstats",
            startTime: days.startTime,
            numdays: -1,
            publicationId: req.rootId,
            count: 0,
            steps: []
        }
        req.response = resp
        
        let data = {}
        
        if (days.vals) {
            data["measures"] = {}
            for (let day of days.vals) {
                if (day && day["measures"])
                    addToMultiMeasure(data["measures"], day["measures"])
            }
            resp.numdays = days.vals.length;
        } else {
            data = days.totals;
        }
        
        if (data && data["measures"]) {
            let m: MultiMeasure = data["measures"]             
            for (let idx = 0; idx < 100; ++idx) {
                let avg = (n: string) => {
                    let mm = m[idx + "/" + n]
                    if (!mm || !mm.cnt) return -1;
                    return Math.round((mm.sum / mm.cnt) * 100) / 100;
                }
                let dur = m[idx + "/duration"]
                if (!dur) break;
                resp.count = Math.max(resp.count, dur.cnt)
                let st = {
                    index: idx,
                    text: null,
                    count: dur.cnt,
                    minDuration: dur.min,
                    medDuration: avg("duration"),
                    medModalDuration: avg("modalDuration"),
                    medPlayDuration: avg("playDuration"),
                }
                resp.steps.push(st)
            }
        }
    })
}
