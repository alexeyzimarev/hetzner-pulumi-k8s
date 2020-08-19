// Copyright 2016-2019, Pulumi Corporation.  All rights reserved.

import * as pulumi from "@pulumi/pulumi";
// @ts-ignore
import * as scp2 from "scp2";
import * as ssh2 from "ssh2";

import {Provisioner} from "./provisioner";
import {Input} from "@pulumi/pulumi";

// ConnectionArgs tells a provisioner how to access a remote resource. For example, it may need to use
// SSH or WinRM to connect to the resource in order to run a command or copy a file.
export interface ConnectionArgs {
    type?: ConnectionType;
    host: pulumi.Input<string>;
    port?: pulumi.Input<number>;
    username?: pulumi.Input<string>;
    password?: pulumi.Input<string>;
    privateKey?: pulumi.Input<string>;
    privateKeyPassphrase?: pulumi.Input<string>;
}

// ConnectionType is the set of legal connection mechanisms to use. Default is SSH.
export type ConnectionType = "ssh" | "winrm";

function connToSsh2(conn: pulumi.Unwrap<ConnectionArgs>): any {
    return {
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        privateKey: conn.privateKey,
        passphrase: conn.privateKeyPassphrase,
    };
}

function copyFile(conn: pulumi.Unwrap<ConnectionArgs>, src: string, dest: string): Promise<never> {
    const connType = conn.type || "ssh";
    if (connType !== "ssh") {
        throw new Error("only SSH connection types currently supported");
    }

    let connectionFailCount = 0;
    return new Promise((resolve, reject) => {
        function scp() {
            scp2.scp(
                src,
                {path: dest, ...connToSsh2(conn)},
                (err: any) => {
                    if (err) {
                        // console.log(err);
                        connectionFailCount++;
                        if (connectionFailCount > 10) {
                            reject(err);
                        } else {
                            setTimeout(scp, connectionFailCount * 5000);
                        }
                        return;
                    }
                    resolve();
                },
            );
        }

        scp();
    });
}

// RunCommandResult is the result of running a command.
export interface RunCommandResult {
    // The stdout of the command that was executed.
    stdout: string;
    // The stderr of the command that was executed.
    stderr: string;
    // The exit code of the command that was executed.
    code: number;
}

function runCommand(conn: pulumi.Unwrap<ConnectionArgs>, cmd: pulumi.Unwrap<string>): Promise<RunCommandResult> {
    const connType = conn.type || "ssh";
    if (connType !== "ssh") {
        throw new Error("only SSH connection types currently supported");
    }

    const sshConn = connToSsh2(conn);
    let connectionFailCount = 0;
    return new Promise((resolve, reject) => {
        const conn = new ssh2.Client();

        function connect() {
            conn.on("ready", () => {
                conn.exec(cmd, (err, stream) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    let stdout = "";
                    let stderr = "";
                    stream.on("close", (code: any, _: any) => {
                        conn.end();
                        if (code) {
                            reject(new Error("Command exited with " + code));
                        } else {
                            resolve({stdout, stderr, code});
                        }
                    }).on("data", (data: any) => {
                        const message = data.toString("utf8");
                        console.log(message);
                        stdout += message;
                    }).stderr.on("data", (data) => {
                        const message = data.toString("utf8");
                        console.log(message);
                        stderr += message;
                    });
                });
            }).on("error", (err) => {
                // console.log(err);
                connectionFailCount++;
                if (connectionFailCount > 10) {
                    reject(err);
                } else {
                    setTimeout(connect, connectionFailCount * 5000);
                }
            }).connect(sshConn);
        }

        connect();
    });
}

// CopyFile is a provisioner step that can copy a file from the machine running Pulumi to the newly created resource.
export class CopyFile extends pulumi.ComponentResource {
    private readonly provisioner: Provisioner<CopyFileArgs, never>;

    constructor(name: string, args: CopyFileArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pulumi:provisioners:CopyFile", name, args, opts);

        this.provisioner = new Provisioner<CopyFileArgs, never>(
            `${name}-provisioner`,
            {
                dep: args,
                changeToken: args.changeToken,
                onCreate: (c) => copyFile(c.conn, c.src, c.dest),
            },
            {parent: this},
        );
    }
}

interface ChangeTrackingProvisioner {
    // changeToken allows you to specify a value that controls the replacement of the dependent dynamic resources.
    // Specifying a value that changes with the content of the file(s) allows the provisioner resources to be
    // replaced every time the content(s) change.
    changeToken?: Input<string>;
}

export interface CopyFileArgs extends ChangeTrackingProvisioner {
    // conn contains information on how to connect to the destination, in addition to dependency information.
    conn: Input<ConnectionArgs>;
    // src is the source of the file or directory to copy. It can be specified as relative to the current
    // working directory or as an absolute path. This cannot be specified if content is set.
    src: Input<string>;
    // dest is required and specifies the absolute path on the target where the file will be copied to.
    dest: Input<string>;
}

// RemoteExec runs remote commands and/or invokes scripts. If commands and scripts are specified, they are
// run in the following order: command, commands, script, and finally then scripts.
export class RemoteExec extends pulumi.ComponentResource {
    private readonly provisioner: Provisioner<RemoteExecArgs, RunCommandResult[]>;
    // The results of all commands executed remotely.
    public readonly results: pulumi.Output<RunCommandResult[]>;
    // The result of the first command executed remotely.
    public readonly result: pulumi.Output<RunCommandResult>;

    constructor(name: string, args: RemoteExecArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pulumi:provisioners:RemoteExec", name, args, opts);

        if (args.command !== undefined && args.commands !== undefined) {
            throw new Error("Exactly one of 'command' or 'commands' should be provided.");
        }

        this.provisioner = new Provisioner<RemoteExecArgs, RunCommandResult[]>(
            `${name}-provisioner`,
            {
                dep: args,
                onCreate: async (a) => {
                    const commands = a.commands || [a.command];
                    const results: RunCommandResult[] = [];
                    for (const cmd of commands) {
                        if (cmd === undefined) continue;
                        const result = await runCommand(a.conn, cmd);
                        results.push(result);
                    }
                    return results;
                },
                changeToken: args.changeToken,
            },
            {parent: this},
        );

        this.result = this.provisioner.result[0];
        this.results = this.provisioner.result;
    }
}

export interface RemoteExecArgs extends ChangeTrackingProvisioner {
    // The connection to use for the remote command execution.
    conn: pulumi.Input<ConnectionArgs>;
    // The command to execute.  Exactly one of 'command' and 'commands' is required.
    command?: Input<string>;
    // The commands to execute.  Exactly one of 'command' and 'commands' is required.
    commands?: Input<Input<string>[]>;
}
