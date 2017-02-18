/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as util from 'util';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as azureTable from "./azure-table"
import * as azureBlobStorage from "./azure-blob-storage"
import * as zlib from 'zlib';

let cmds: any = {};
let helpMessage = "";

let tableClient: azureTable.Client;
let blobClient: azureBlobStorage.BlobService;

let isConsole = !!(<any>process.stdout).isTTY;

function fmt(n: string, len: number) {
    while (n.length < len - 1)
        n += " ";
    return n + " ";
}

function addCommand(name: string, args: string, cmdhelp: string, f: (args: string[]) => Promise<void>) {
    cmds[name] = f;
    helpMessage = helpMessage + fmt(name, 10) + fmt(args, 10) + cmdhelp + "\n";
}

function printHelp() {
    console.log("USAGE: node storutil COMMAND ARGS...")
    console.log("Commands:")
    console.log(helpMessage)
    process.exit(1)
}

let decodeHex = false;

function decode(s: string) {
    if (decodeHex)
        s = s.replace(/%([0-9A-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
    // try { s = new Buffer(s, "base64").toString("hex");   } catch (e) { }
    return s;
}

addCommand("query", "table {count=N|part=S|row=S|cont=S|hex|line}", "list tables", async (args) => {
    let tblnm = args.shift()
    if (!tblnm) printHelp();
    let tbl = await tableClient.createTableIfNotExistsAsync(tblnm);
    let q = tbl.createQuery().pageSize(100);
    let oneline = false;
    while (args.length > 0) {
        let arg = args.shift();
        let m = /^count=(\d+)$/.exec(arg);
        if (m) { q = q.top(parseInt(m[1], 10)); continue; }
        m = /^cont=(.*)/.exec(arg);
        if (m) { q = q.continueAt(m[1]); continue; }
        m = /^part(=|==|!=|<|>|<=|>=)(.*)/.exec(arg);
        if (m) { q = q.where("PartitionKey", m[1], m[2]); continue; }
        m = /^row(=|==|!=|<|>|<=|>=)(.*)/.exec(arg);
        if (m) { q = q.where("RowKey", m[1], m[2]); continue; }
        if (arg == "hex") { decodeHex = true; continue; }
        if (arg == "line") { oneline = true; continue; }
        console.log("not understood:", arg)
        process.exit(1)
    }
    if (isConsole && q.onlyTop > 1000) q = q.top(20);
    while (true) {
        let fr = await q.fetchPageAsync();
        for (let item of fr.items) {
            var hd = decode(item["PartitionKey"]) + " / " + decode(item["RowKey"]) + " : ";
            delete item["PartitionKey"];
            delete item["RowKey"];
            delete item["Timestamp"];
            for (let k of Object.keys(item)) {
                if (/Compressed/.test(k) && Buffer.isBuffer(item[k])) {
                    item[k] = decompress(item[k])
                }
            }
            if (oneline) {
                for (let k of Object.keys(item)) {
                    hd += k + ": " + util.inspect(item[k]) + ", ";
                }
                console.log(hd)
            } else {
                console.log("****** " + hd)
                console.log(item)
                console.log("")
            }
        }
        if (isConsole) break;
        if (!fr.continuation) break;
        q = q.continueAt(fr.continuation);
    }
});

addCommand("containers", "[conttoken]", "list blob containers", async (args) => {
    blobClient.handle.listContainersSegmented(args[0], {}, (err, res) => {
        for (let t of res.entries) {
            console.log("container:", t.name)
        }
        let cont = res.continuationToken
        if (cont)
            console.log("continuation:", cont);
    })
});

addCommand("blobs", "container [prefix [cont]]", "list blob containers", async (args) => {
    blobClient.handle.listBlobsSegmentedWithPrefix(args[0], args[1] || "", args[2], { maxResults: 100 }, (err, res) => {
        for (let t of res.entries) {
            console.log("blob:", t.name)
        }
        let cont = res.continuationToken
        if (cont)
            console.log("continuation:", cont);
    })
});



function decompress(buf: Buffer) {
    if (buf.length <= 1) return "";

    if (buf[0] == 0) {
        buf = buf.slice(1);
    } else if (buf[0] == 1 || buf[0] == 2) {
        let len = buf.readInt32LE(1);
        if (buf[0] == 1)
            buf = zlib.inflateRawSync(buf.slice(5));
        else
            buf = zlib.gunzipSync(buf.slice(5));
        assert(len == buf.length)
    } else {
        assert(false)
    }

    return buf.toString("utf8");
}

addCommand("getblob", "container path", "list blob containers", async (args) => {
    let cont = await blobClient.createContainerIfNotExistsAsync(args[0], "private");
    let r = await cont.getBlobToBufferAsync(args[1]);
    let buf = r.buffer();
    fs.writeFileSync("blob.bin", buf);
    fs.writeFileSync("blob.hex", buf.toString("hex"));
    if (true) {
        let json = [];
        if (buf.readInt32LE(0) == 1) {
            for (let pos = 4; pos < buf.length;) {
                if (!buf[pos++]) {
                    json.push(null);
                    continue;
                }

                let len = buf.readInt32LE(pos);
                pos += 4;
                console.log(len);
                json.push(decompress(buf.slice(pos, pos + len)))
                pos += len;
            }
        }
        fs.writeFileSync("blob.json", JSON.stringify(json, null, 2))
    }
    console.log("blob.bin written,", buf.length, "bytes")
});



addCommand("tables", "[cont]", "list tables", async (args) => {
    var opts = {
        nextTableName: args[0]
    }
    tableClient.handle.listTables(opts, (err, buf, cont) => {
        for (let t of buf) {
            console.log("table:", t)
        }
        if (cont)
            console.log("continuation:", cont);
    })
});

function init() {
    if (!process.env["AZURE_STORAGE_ACCESS_KEY"]) {
        console.log("you need to set AZURE_STORAGE_ACCOUNT and AZURE_STORAGE_ACCESS_KEY environment variables");
        process.exit(1);
    }
    tableClient = azureTable.createClient();
    azureTable.assumeTablesExists();
    azureBlobStorage.init();
    blobClient = azureBlobStorage.createBlobService();
    azureBlobStorage.assumeContainerExists();
}

function main() {
    let args = process.argv.slice(2);
    let cmd = args.shift();

    if (!cmd) printHelp();
    cmd = cmd.toLowerCase();
    if (!cmds.hasOwnProperty(cmd)) printHelp();

    init();
    cmds[cmd](args);
}

main();
