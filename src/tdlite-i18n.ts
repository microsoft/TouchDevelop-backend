/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

import * as core from "./tdlite-core"
import * as tdlitePointers from "./tdlite-pointers"
import * as crowdin from "./crowdin"
import * as parallel from "./parallel"

var logger = core.logger;
var httpCode = core.httpCode;

export async function initAsync() {
	core.addRoute("POST", "i18n", "upload", async(req) => {
		if (!core.checkPermission(req, "i18n"))
			return;
		let resp = await crowdin.uploadTranslationAsync(td.toString(req.body["filename"]), req.body["strings"])
		req.response = {};
	})

	core.addRoute("POST", "i18n", "pointers", async(req) => {
		if (!core.checkPermission(req, "i18n"))
			return;
		let strs = td.toStringArray(req.body["pointers"])
		let res = {}
		await parallel.forJsonAsync(strs, async(fn) => {
			let ptr = await core.getPubAsync(fn, "pointer")
			if (ptr && ptr["pub"]["htmlartid"]) {
				let text = await tdlitePointers.getTemplateTextAsync(fn.replace(/^ptr-/, ""), "")
				td.jsonCopyFrom(res, crowdin.translate(text, {}).missing)
			}
		}, 10)
		let phrases = Object.keys(res)
		phrases.sort(td.strcmp)
		let obj = td.toDictionary(phrases, s => s)
		await crowdin.uploadTranslationAsync("website.json", obj)		
		req.response = {
			pointers: strs,
			phrases: phrases
		}
	});

	core.addRoute("GET", "*pointer", "i18n", async(req) => {
		let text = await tdlitePointers.getTemplateTextAsync(req.rootId.replace(/^ptr-/, ""), "")
		req.response = crowdin.translate(text, {}).missing;
	})
}