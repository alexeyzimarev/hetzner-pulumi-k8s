// Copyright 2016-2020, Pulumi Corporation.  All rights reserved.

import * as crypto from "crypto";
import * as fs from "fs";
import * as pulumi from "@pulumi/pulumi";

export function getFileHash(filename: string): string {
    const data = fs.readFileSync(filename, {encoding: "utf8"});
    return getStringHash(data);
}

export function getStringHash(data: string): string {
    return crypto.createHash("md5").update(data, "utf8").digest("hex");
}

export function getOutputStringHash(data: pulumi.Output<string>): pulumi.Input<string> {
    return data.apply(x => crypto.createHash("md5").update(x, "utf8").digest("hex"));
}
