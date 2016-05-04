/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

import * as core from "./tdlite-core"
import * as tdlitePointers from "./tdlite-pointers"
import * as crowdin from "./crowdin"
import * as parallel from "./parallel"
import * as cachedStore from "./cached-store"

var logger = core.logger;
var httpCode = core.httpCode;
var i18nCache: cachedStore.Container;

async function downloadCachedTranslationAsync(filename: string, lang: string) {
	let key = "i18n:" + filename + ":" + lang
	let f = await core.redisClient.getAsync(key)
	if (f)
		return JSON.parse(f)
	let dat = await crowdin.downloadTranslationAsync(filename, lang)
	dat = dat || {}
	logger.info(`crowdin dl: ${key} - ${Object.keys(dat).length}`)
	await core.redisClient.setpxAsync(key, JSON.stringify(dat), 10 * 60 * 1000)
	return dat
}

export async function translateHtmlAsync(html: string, lang: string[]) {
	//logger.debug(`crowdin translate html: ${crowdin.enabled} '${lang[0]}' ${html.length}`)
	if (!crowdin.enabled || !lang || !lang[0]) return html;
	let trdata = await downloadCachedTranslationAsync("website.json", lang[0])
	let res = crowdin.translate(html, trdata)
	return res.text
}

export async function initAsync() {
	if (core.hasSetting("CROWDIN_KEY"))
		crowdin.init();
	else return;

	core.addRoute("POST", "i18n", "upload", async (req) => {
		if (!core.checkPermission(req, "i18n"))
			return;
		let resp = await crowdin.uploadTranslationAsync(td.toString(req.body["filename"]), req.body["strings"])
		req.response = {};
	})

	core.addRoute("POST", "i18n", "pointers", async (req) => {
		if (!core.checkPermission(req, "i18n"))
			return;
		let strs = td.toStringArray(req.body["pointers"])
		let res = {}
		await parallel.forJsonAsync(strs, async (fn) => {
			let ptr = await core.getPubAsync(fn, "pointer")
			if (ptr && ptr["pub"]["htmlartid"]) {
				let text = await tdlitePointers.getTemplateTextAsync(fn.replace(/^ptr-/, ""), [])
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

	core.addRoute("GET", "*pointer", "i18n", async (req) => {
		let text = await tdlitePointers.getTemplateTextAsync(req.rootId.replace(/^ptr-/, ""), [])
		req.response = crowdin.translate(text, {}).missing;
	})
}
