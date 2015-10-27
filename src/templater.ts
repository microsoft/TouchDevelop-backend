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

function getFiles()
{
	let res = []
	function loop(path:string) {
		for (let fn of fs.readdirSync(path)) {
			let fp = path + "/" + fn
			let st = fs.statSync(fp)
			if (st.isDirectory()) loop(fp)
			else if (st.isFile()) res.push(fp.replace(/^web/, ""))
		}
	}	
	loop("web")
	return res
}

async function main() {
	nunjucks.configure("web", {
		autoescape: true,
		noCache: true
	})

	let s = restify.server()
	s.get("/", async(req, res) => {
		let hrefs = ""
		let lst = getFiles()
		lst.sort()
		for (let fn of lst) {
			hrefs += `<a style="font-size:20px;line-height:1.5em" href="${fn}">${fn}</a><br>\n`
		}
		res.html(hrefs)
	})
	s.routeRegex("GET", "/.*", async(req, res) => {
		let fn = req.url().replace(/\?.*/, "");
		if (/^(\/[\w][\w\.\-]+)+$/.test(fn)) {
			if (fs.existsSync("web" + fn)) {
				let tmp = nunjucks.render(fn.replace(/^\/+/, ""), { somevar: 1 })
				res.html(tmp)
			} else {
				res.sendError(404, "No such file");
			}
		} else {
			res.sendError(400, "");
		}
	})

	await restify.startAsync();
}

main();