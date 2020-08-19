import {Config, Output} from "@pulumi/pulumi";

export interface Credentials {
    privateKey: string | Output<string>,
    privateKeyPassphrase: string | Output<string> | undefined,
    username: string | Output<string>
}

export function getCredentials(config: Config): Credentials {
    return {
        privateKey: config.requireSecret("privateKey").apply(key => {
            if (key.startsWith("-----BEGIN RSA PRIVATE KEY-----")) {
                return key;
            } else {
                return Buffer.from(key, "base64").toString("ascii");
            }
        }),
        privateKeyPassphrase: config.getSecret("privateKeyPassphrase"),
        username: config.require<string>("username")
    };
}
