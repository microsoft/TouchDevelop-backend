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

var lastCheck = 0;
var lastPoke = 0;
var jobRunning: Job;

export function seemsAlive():boolean
{
    if (restify.server().inShutdownMode)
        return false;        
    return (Date.now() - lastPoke) < 20000;
}

export function poke()
{   
    if (restify.server().inShutdownMode) {
        logger.warning("got poke in shutdown mode")
        return
    }
    
    let now = Date.now();
    lastPoke = now;
    if (!lastCheck) lastCheck = now;
    let delta = now - lastCheck 
    if (delta < td.randomRange(20000, 60000))
        return;
    
    lastCheck = now
    
    if (jobRunning) {
        logger.warning("job still running: " + jobRunning.id + "; skipping")
        return
    }
    
    setTimeout(runJobsAsync, 10);
}

export async function initAsync(): Promise<void> {
    if (logger != null) return;
    logger = td.createLogger("cron");
    logger.info("initialized");
    redisClient = await redis.createClientAsync();
}

async function runJobsAsync() {
    let jobsNow = jobs.slice(0)
    let start = Date.now();
    td.permute(jobsNow)
    for (let j of jobsNow) {
        jobRunning = j;
        let runtime = Date.now() - start 
        if (runtime > 30000)
            break
        logger.debug(`check job ${j.id}; loop @ ${runtime}ms`)
        let res = await redisClient.sendCommandAsync("set", ["cronlock:" + j.id, "working", "NX", "EX", j.everyMinutes * 60])
        if (td.toString(res) != "OK") continue;
        logger.info("starting cronjob " + j.id)
        await j.callbackAsync()
        logger.info("finished cronjob " + j.id)
    }
    jobRunning = null;
}

export function registerJob(j:Job)
{
    assert(jobs.filter(x => x.id == j.id).length == 0)
    jobs.push(j);    
}