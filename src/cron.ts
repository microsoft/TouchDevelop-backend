/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

import * as restify from './restify';
import * as redis from './redis';

var logger: td.AppLogger;
var redisClient: redis.Client;
var jobs: Job[] = [];

export class Job {
    constructor(public id: string, public everyMinutes: number, public callbackAsync: () => Promise<void>)
    {        
    }
    
    public scheduleRestart()
    {
        /* async */ redisClient.delAsync("cronlock:" + this.id)
    }
}

async function initAsync(): Promise<void> {
    if (logger != null) return;
    logger = td.createLogger("cron");
    logger.info("initialized");
    redisClient = await redis.createClientAsync();
    /* async */ loopAsync();
}

function init()
{
    if (logger == null)
        /* async */ initAsync();
}

async function loopAsync()
{
    let runTime = 0;
    
    let server = restify.server()
    while (!server.inShutdownMode) {
        let sleepTime = td.randomRange(20, 70) - runTime;
        logger.debug("enter loop; sleep " + sleepTime)
        if (sleepTime > 0)
            await td.sleepAsync(sleepTime);
        let jobsNow = jobs.slice(0)
        let start = Date.now();
        td.permute(jobsNow)
        for (let j of jobsNow) {
            if (server.inShutdownMode) break;
            logger.debug("check job " + j.id)
            let res = await redisClient.sendCommandAsync("set", ["cronlock:" + j.id, "working", "NX", "EX", j.everyMinutes * 60])
            if (td.toString(res) != "OK") continue;
            logger.info("starting cronjob " + j.id)
            await j.callbackAsync()
            logger.info("finished cronjob " + j.id)
        }     
        runTime = (start - Date.now()) / 1000;
    }
    
    logger.info("shutting down cron loop")
}

export function registerJob(j:Job)
{
    init();
    assert(jobs.filter(x => x.id == j.id).length == 0)
    jobs.push(j);    
}