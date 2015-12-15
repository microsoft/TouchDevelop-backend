/// <reference path='../typings/node/node.d.ts' />

'use strict';

import * as td from './td';
import * as assert from 'assert';
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as path from 'path';
import * as crypto from 'crypto';

export async function sendEncryptedAsync(target:string, path: string, data: any) {
    let m = /^(.*\/-tdevmgmt-\/)(\w+)\/?$/.exec(target)
    let hash = crypto.createHash("sha256")
    hash.update(m[2]);
    let key = hash.digest();

    let op = {
        cmd: path.split("/"),
        data: data || {},
        op: "ShellMgmtCommand" // should go at the end, for added security
    }

    let request = td.createRequest(m[1] + "encrypted");

    let xbuf = new Buffer(JSON.stringify(op), "utf8");
    var gzipped: Buffer = zlib.gzipSync(xbuf);
    console.log("upload " + xbuf.length + " bytes, compressed " + gzipped.length + " [encrypted]")

    let iv = crypto.randomBytes(16);
    let cipher = crypto.createCipheriv("aes256", key, iv);
    request.setHeader("x-tdshell-iv", iv.toString("hex"));
    let enciphered = cipher.update(gzipped);
    let cipherFinal = cipher.final();
    request.setContentAsBuffer(Buffer.concat([enciphered, cipherFinal]));
    request.setMethod("post");
    let response = await request.sendAsync();

    let buf = response.contentAsBuffer();
    let inpiv = response.header("x-tdshell-iv");
    if (response.statusCode() == 200) {
        let ciph = crypto.createDecipheriv("AES256", key, new Buffer(inpiv, "hex"));
        let b0 = ciph.update(buf)
        let b1 = ciph.final()
        let dec = Buffer.concat([b0, b1])
        let dat = zlib.gunzipSync(dec).toString("utf8");
        (<any>response)._content = dat;
    }

    console.log(`${path}: ${response.statusCode() }`)
    return response
}
