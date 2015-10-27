/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as util from 'util';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as restify from './restify';

var nunjucks = require("nunjucks");

async function main()
{
	nunjucks.configure("web", { 
		autoescape: true,
		noCache: true
	})
	
	let s = restify.server()
	s.routeRegex("GET", "/.*", async(req, res) => {
		let fn = req.url().replace(/\?.*/, "");
		if (/^(\/[\w][\w\.\-]+)+$/.test(fn)) {			
			let tmp = nunjucks.render(fn, { somevar: 1 })
			res.html(tmp)						
		} else {
			res.sendError(400, "");
		}
	})
	
	await restify.startAsync(); 	
}

main();