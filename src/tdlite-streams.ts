/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';

type JsonObject = td.JsonObject;
type JsonBuilder = td.JsonBuilder;

import * as parallel from "./parallel"
import * as indexedStore from "./indexed-store"
import * as cachedStore from "./cached-store"
import * as core from "./tdlite-core"
import * as audit from "./tdlite-audit"
import * as tdlitePointers from "./tdlite-pointers"
import * as azureBlobStorage from "./azure-blob-storage"

var withDefault = core.withDefault;
var orEmpty = td.orEmpty;

var logger = core.logger;
var httpCode = core.httpCode;

var streams: indexedStore.Store;
var metaContainer: cachedStore.Container;

export class PubStream
    extends core.IdObject {
    @td.json public time: number = 0;
    @td.json public name: string = "";
    @td.json public target: string = "";
    @td.json public meta: {};

    static createFromJson(o: JsonObject) { let r = new PubStream(); r.fromJson(o); return r; }
}

export interface FieldInfo {
    name: string;
    min: number;
    max: number;
    count: number;
    sum: number;
}

export interface StreamInfo {
    fields: td.SMap<FieldInfo>;
    size: number;
    rows: number;
    batches: number;
}

export async function initAsync(): Promise<void> {
    if (!core.hasSetting("STREAMS_ACCOUNT"))
        return
    let tableClient = await core.specTableClientAsync("STREAMS");
    let blobService = azureBlobStorage.createBlobService({
        storageAccount: td.serverSetting("STREAMS_ACCOUNT"),
        storageAccessKey: td.serverSetting("STREAMS_KEY")
    });
    metaContainer = await cachedStore.createContainerAsync("metastream", {
        blobService: blobService,
        noCache: true
    });

    function userMeta(info: StreamInfo) {
        return {
            fields: td.values(info.fields),
            rows: info.rows,
            size: info.size,
            batches: info.batches
        }
    }

    streams = await indexedStore.createStoreAsync(core.pubsContainer, "stream");
    await core.setResolveAsync(streams, async (fetchResult: indexedStore.FetchResult, apiRequest: core.ApiRequest) => {
        let coll: PubStream[] = []
        let metas = await metaContainer.getManyAsync(fetchResult.items.map(e => e["id"]))
        let i = 0
        for (let e of fetchResult.items) {
            let s = PubStream.createFromJson(e["pub"])
            s.meta = userMeta(metas[i++] as StreamInfo)
            coll.push(s)
        }
        fetchResult.items = td.arrayToJson(coll);
    }, {
            listPermission: "stream-admin"
        });

    core.addRoute("POST", "streams", "", async (req: core.ApiRequest) => {
        await core.throttleAsync(req, "stream", 120);
        if (req.status != 200) return;

        if (!core.isValidTargetName(req.body["target"])) {
            req.status = httpCode._400BadRequest
            return
        }

        let stream = new PubStream();
        stream.name = orEmpty(req.body["name"]);
        stream.time = await core.nowSecondsAsync();
        stream.target = orEmpty(req.body["target"]);
        let jsb = {
            pub: stream.toJson(),
            privatekey: td.createRandomId(24),
        }
        await core.generateIdAsync(jsb, 12);
        await streams.insertAsync(jsb);
        let id = jsb["id"]
        await metaContainer.updateAsync(id, async (v: {}) => {
            let m: StreamInfo = {
                fields: {},
                size: 0,
                rows: 0,
                batches: 0,
            }
            td.jsonCopyFrom(v, m)
        })
        let table = await tableClient.createTableIfNotExistsAsync(id, true)
        await core.returnOnePubAsync(streams, td.clone(jsb), req);
        req.response["privatekey"] = jsb.privatekey
    });

    function checkPerm(req: core.ApiRequest) {
        if (req.queryOptions["privatekey"] !== req.rootPub["privatekey"]) {
            if (!core.checkPermission(req, "stream-admin"))
                return false
        }
        return true
    }

    core.addRoute("DELETE", "*stream", "", async (req: core.ApiRequest) => {
        if (!checkPerm(req)) return

        let delok = await core.deleteAsync(req.rootPub);
        await audit.logAsync(req, "delete", {
            oldvalue: req.rootPub
        });

        await tableClient.deleteTableAsync(req.rootId)
        await metaContainer.updateAsync(req.rootId, async (v: {}) => {
            for (let f of Object.keys(v)) v[f] = null;
        })

        req.response = { msg: "Puff. Gone." }
    });

    function padTime(t: number) {
        return ("0000000" + t).slice(-15)
    }

    let durations = {
        s: 1,
        m: 60,
        h: 3600,
        d: 24 * 3600,
        y: 365.25 * 24 * 3600,
    }

    function parseTime(st: string, defl: string) {
        if (!st) st = defl
        if (/^\d+$/.test(st)) {
            return parseInt(st)
        }
        let m = /^-(\d+)([smhdy])$/.exec(st)
        if (m) {
            let k = parseInt(m[1])
            return Date.now() - k * durations[m[2]] * 1000
        }
        return null
    }

    function csv(l: string[]) {
        return l.map(s => {
            if (!s) s = ""
            if (/[^A-Za-z0-9:.\-]/.test(s))
                return "\"" + s.replace(/[\\"]/g, " ") + "\""
            else return s
        }).join(",") + "\n"
    }

    async function fetchDataAsync(req: core.ApiRequest) {
        let start = parseTime(req.queryOptions["start"], "-24h")
        let stop = parseTime(req.queryOptions["stop"], "-0s")
        let part = parseInt(req.queryOptions["partition"] || "0") + ""
        if (!start || !stop) {
            req.status = httpCode._400BadRequest
            req.errorMessage = "Invalid start= or stop= parameter; use -100s, -10h, etc. or milliseconds since epoch"
            return
        }

        if (await core.throttleCoreAsync("rdstr:" + req.rootId, 55)) {
            req.status = httpCode._429TooManyRequests
            return
        }

        let table = tableClient.getTable(req.rootId)
        let q = table.createQuery()
            .partitionKeyIs(part)
            .and("RowKey", ">=", padTime(start))
            .top(60) // TODO use some heuristic to guess how many
        let res = await q.fetchPageAsync()
        let meta = await metaContainer.getAsync(req.rootId) as StreamInfo
        let fieldList = td.values(meta.fields)
        let idx: td.SMap<number> = {}
        fieldList.forEach((f, i) => idx[f.name] = i)
        let rows: number[][] = []
        for (let ent of res.items) {
            let fields: string[] = JSON.parse(ent["fields"])
            let fieldIdx = fields.map(n => td.lookup(idx, n))
            let values: number[][] = JSON.parse(ent["values"])
            let allPast = true
            for (let row of values) {
                if (row[0] > stop) continue
                allPast = false
                if (row[0] < start) continue
                let resRow = new Array(fieldList.length)
                for (let i = 0; i < resRow.length; ++i) resRow[i] = null
                for (let i = 0; i < row.length; ++i)
                    resRow[fieldIdx[i]] = row[i]
                rows.push(resRow)
            }
            if (allPast) res.continuation = null
        }
        rows.sort((a, b) => a[0] - b[0]) // oldest first

        let contUrl = ""
        if (res.continuation) {
            contUrl = core.self + "api/" + req.rootId +
                "/data?start=" + start +
                "&stop=" + stop +
                "&partition=" + part +
                "&continuation=" + res.continuation;
        }

        return {
            fields: fieldList,
            values: rows,
            continuation: res.continuation,
            continuationUrl: contUrl,
        }
    }

    core.addRoute("GET", "*stream", "data.csv", async (req: core.ApiRequest) => {
        let resp = await fetchDataAsync(req)
        if (!resp) return
        let fldNames = resp.fields.map(f => f.name)
        let partId = fldNames.indexOf("partition")
        if (partId >= 0) fldNames.splice(partId, 1)
        let resCsv = [
            csv(fldNames)
        ]
        for (let row of resp.values) {
            let isoDate = new Date(row[0]).toISOString().replace("T", " ").replace("Z", "")
            let strs = [isoDate]
            for (let i = 1; i < row.length; ++i) {
                let k = row[i]
                if (i != partId)
                    strs.push(k === null ? "" : "" + k)
            }
            resCsv.push(csv(strs))
        }
        if (resp.continuationUrl)
            resCsv.push("\n", csv(["More items at:", resp.continuationUrl]))
        req.response = resCsv.join("")
        req.responseContentType = "text/csv"
    })

    core.addRoute("GET", "*stream", "data", async (req: core.ApiRequest) => {
        req.response = await fetchDataAsync(req)
    })

    core.addRoute("GET", "*stream", "odata", async (req: core.ApiRequest) => {
        let odataroot = core.self + "api/" + req.rootId + "/odata/"

        if (req.argument == "") {
            let info = `<?xml version="1.0" encoding="utf-8"?>
            <service xml:base="http://services.odata.org/V3/OData/OData.svc/" 
                     xmlns="http://www.w3.org/2007/app" 
                     xmlns:atom="http://www.w3.org/2005/Atom">
               <workspace>
                 <atom:title>Default</atom:title>
                 <collection href="${odataroot}Samples">
                   <atom:title>Samples</atom:title>
                 </collection>
               </workspace>
            </service>`
            req.response = info
            req.responseContentType = "application/xml"
        } else if (req.argument == "Samples") {
            let resp = await fetchDataAsync(req)
            if (!resp) return

            let xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" 
  xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" 
  xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" 
  xmlns:georss="http://www.georss.org/georss" 
  xmlns:gml="http://www.opengis.net/gml" 
  xml:base="${odataroot}">
<id>${odataroot}Samples</id>
<title type="text">Samples</title>
<updated>${new Date().toISOString()}</updated>
<link rel="self" title="Samples" href="${odataroot}Samples"/>
`
            if (resp.continuationUrl)
                xml += `<link rel="next" href="${resp.continuationUrl}"/>`


            for (let row of resp.values) {
                xml += `
<entry>
<category term="Edm.ComplexType" scheme="http://schemas.microsoft.com/ado/2007/08/dataservices/scheme" />
<content type="application/xml">
<m:properties>
<d:Timestamp m:type="Edm.DateTimeOffset">${new Date(row[0]).toISOString()}</d:Timestamp>
`
                resp.fields.forEach((fi, i) => {
                    if (i == 0) return
                    xml += `<d:${fi.name} m:type="Edm.Double">${row[i]}</d:${fi.name}>\n`
                })

                xml += `</m:properties></content></entry>`
            }

            xml += `</feed>`
            req.response = xml
            req.responseContentType = "application/atom+xml;type=feed"
        } else {
            req.status = httpCode._400BadRequest
        }
        /*
        req.response = {
            "@odata.context": strurl + "$metadata#Samples",
            "@odata.next": resp.continuationUrl || undefined,
            "value": 
        }
        */
    })

    core.addRoute("POST", "*stream", "data", async (req: core.ApiRequest) => {
        if (!checkPerm(req)) return

        if (await core.throttleCoreAsync("str:" + req.rootId, 55)) {
            req.status = httpCode._429TooManyRequests
            return
        }

        function error(msg: string) {
            req.status = httpCode._400BadRequest
            req.errorMessage = msg
        }

        let fields = td.toStringArray(req.body["fields"])

        if (!fields) return error("expecting fields - a string array")

        let flds: td.SMap<FieldInfo> = {}
        for (let s of fields) {
            if (s.length > 60 || !/^[a-z_]\w*$/i.test(s))
                return error("bad field name")
        }
        if (fields[0] != "timestamp")
            return error("first field has to be 'timestamp'")

        let values: number[][] = req.body["values"]
        if (!Array.isArray(values))
            return error("'values' must be array")

        if (values.length == 0)
            return error("'values' must be non-empty")

        let partIdx = fields.indexOf("partition")
        let part = 0
        if (partIdx >= 0)
            part = values[0][partIdx]

        for (let row of values) {
            if (!Array.isArray(row))
                return error("'values' must contain only arrays")
            if (row.length != fields.length)
                return error("'values' rows must contain the same number of elements of 'fields'")
            if (!row.every(k => k === null || typeof k == "number"))
                return error("rows must contain only numbers or nulls")

            if (partIdx >= 0 && row[partIdx] !== part) {
                return error("only single value of 'partition' field allowed in batch upload")
            }

            let ts = row[0]
            if (!(new Date(2016, 1, 1).getTime() < ts && ts < new Date(9999, 1, 1).getTime()))
                return error("timestamp out of range; should be milliseconds since epoch")

            for (let i = 0; i < row.length; ++i) {
                let v = row[i]
                if (v == null) continue
                let f = fields[i]
                if (!flds.hasOwnProperty(f)) {
                    flds[f] = {
                        name: f,
                        sum: v,
                        min: v,
                        max: v,
                        count: 1
                    }
                } else {
                    let e = flds[f]
                    e.count++
                    e.sum += v
                    e.min = Math.min(e.min, v)
                    e.max = Math.max(e.max, v)
                }
            }
        }

        values.sort((a, b) => a[0] - b[0]) // oldest first

        let medianTime = values[values.length >> 1][0]
        let endTime = values[values.length - 1][0]
        let rowkey = padTime(endTime) + td.createRandomId(4)

        let valuesStr = JSON.stringify(values)
        let fieldsStr = JSON.stringify(fields)
        let size = valuesStr.length + fields.length
        let quoteExceeded = false
        let quota = 50 * 1024 * 1024
        let maxFields = 32
        let tooManyFields = false

        let finalMeta = await metaContainer.updateAsync(req.rootId, async (v: StreamInfo) => {
            if (v.size + size > quota) {
                quoteExceeded = true
                return
            }
            let merged = td.clone(flds) as td.SMap<FieldInfo>
            for (let k of Object.keys(v.fields)) {
                let existing = v.fields[k]
                let incoming = td.lookup(merged, k)
                if (!incoming) merged[k] = existing
                else {
                    incoming.sum += existing.sum
                    incoming.count += existing.count
                    incoming.max = Math.max(incoming.max, existing.max)
                    incoming.min = Math.min(incoming.min, existing.min)
                }
            }

            if (Object.keys(merged).length > 32) {
                tooManyFields = true
                return
            }

            // all OK around quotas etc

            v.fields = merged
            v.size += size
            v.batches++
            v.rows += values.length
        }) as StreamInfo

        if (quoteExceeded) {
            req.status = httpCode._412PreconditionFailed
            req.errorMessage = "quota for this stream exceeded"
            return
        }

        if (tooManyFields)
            return error("too many fields in the stream")

        let table = tableClient.getTable(req.rootId)
        let ent = {
            PartitionKey: part + "",
            RowKey: rowkey,
            rows: values.length,
            fields: fieldsStr,
            values: valuesStr,
        }
        await table.insertEntityAsync(ent)

        req.response = {
            meta: userMeta(finalMeta),
            quotaUsedHere: size,
            quotaLeft: quota - finalMeta.size,
        }

    }, { sizeLimit: 32 * 1024 })
}

