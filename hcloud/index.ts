import * as hcloud from "@pulumi/hcloud";
import {HetznerCloudSettings, KubeSettings} from "./settings";
import * as provisioner from "../provisioner";
import {getFileHash, getOutputStringHash} from "./hash";
import * as path from "path";
import * as pulumi from "@pulumi/pulumi";
import {Commands} from "./commands";
import {Credentials} from "./credentials";

export class hcloudCluster {
    private settings: HetznerCloudSettings;
    private credentials: Credentials;
    private readonly prefix: string;

    result: any;

    constructor(settings: HetznerCloudSettings, credentials: Credentials, kubeSettings: KubeSettings, prefix: string) {
        this.settings = settings;
        this.credentials = credentials;
        this.prefix = prefix;

        const network = new hcloud.Network(`${prefix}-network`, {
            ipRange: settings.networkIpRange,
            name: `${prefix}-${settings.networkName ?? "kubernetes"}`
        });

        const networkId = network.id.apply(id => Number.parseFloat(id));

        const subnet = new hcloud.NetworkSubnet(`${prefix}-subnet`, {
            type: "server",
            networkId: networkId,
            ipRange: settings.networkIpRange,
            networkZone: "eu-central"
        }, {dependsOn: network});

        const master = this.AddNode("k8s-master", settings.masterSize, networkId, subnet);
        const workers: hcloud.Server[] = [];
        for (let i = 1; i <= settings.workersCount; i++) {
            const worker = this.AddNode(`k8s-node-${i}`, settings.workerSize, networkId, subnet);
            workers.push(worker.node)
        }

        const kubeInitCommand = Commands.kubeInit(kubeSettings.version, kubeSettings.networkCidr, master.net.ip);
        console.log(kubeInitCommand);
        const kubeInit = this.RunCommand(
            `${prefix}-kube-init`,
            master.node,
            kubeInitCommand,
            [master.node, master.install]
        );
        const done = pulumi.all({_: master.node.name, output: kubeInit.result.stdout });

        const joinCommand = done.apply(x => {
            if (pulumi.runtime.isDryRun()) return "dry-run";
            const index = x.output.indexOf("kubeadm join");
            if (index === -1)
                throw "Unable to locate the joining instruction";

            return x.output.substring(index);
        });
        for (let i = 0; i <= settings.workersCount - 1; i++) {
            let worker = workers[i];
            this.RunCommand(
                `${prefix}-node-${i + 1}-kube`,
                worker,
                joinCommand,
                [kubeInit]
            );
        }

        const copyConfigCommand = this.RunCommand(
            `${prefix}-k8s-config`,
            master.node,
            Commands.copyConfig(),
            [master.install, kubeInit]
        );

        this.RunCommand(
            `${prefix}-k8s-drivers`, master.node,
            Commands.installControllers(hcloud.config.token ?? ""),
            [copyConfigCommand]
        );

        this.result = {
            output: copyConfigCommand.result.stdout
        };
    }

    AddNode(name: string, size: string, networkId: pulumi.Output<number>, subnet: hcloud.NetworkSubnet) {
        const p = this.prefix;

        function pulumiName(n: string): string {
            return `${p}-${name}-${n}`;
        }

        const n = `${this.prefix}-${name}`;
        const node = new hcloud.Server(n, {
            name: n,
            image: this.settings.vmImage,
            serverType: size,
            sshKeys: [this.settings.sshKeyId]
        });

        const net = new hcloud.ServerNetwork(pulumiName("net"), {
            networkId: networkId,
            serverId: node.id.apply(id => Number.parseFloat(id)),
        }, {dependsOn: [node, subnet]});

        const copyKubelet = this.CopyFile(
            pulumiName("hcloudConf"), node,
            "../conf/20-hcloud.conf", "/etc/systemd/system/kubelet.service.d",
        );
        const copyDocker = this.CopyFile(
            pulumiName("dockerConf"), node,
            "../conf/00-cgroup-systemd.conf", "/etc/systemd/system/docker.service.d"
        );
        const copySysctl = this.CopyFile(
            pulumiName("sysctlConf"), node,
            "../conf/sysctl.conf", "/root"
        );

        const reload = this.RunCommand(
            pulumiName("reload"), node,
            "systemctl daemon-reload",
            [copyKubelet, copyDocker]
        );

        const install = this.RunCommand(
            pulumiName("installTools"), node,
            Commands.installTools(),
            [reload, copySysctl]
        );

        return {
            node,
            install,
            net
        };
    }

    CopyFile(name: string, server: hcloud.Server, file: string, destination: string): provisioner.CopyFile {
        const conn = this.GetConnection(server);

        const resolvedFile = path.join(__dirname, file);
        const changeToken = getFileHash(resolvedFile);
        const fileName = path.parse(resolvedFile).base;

        return new provisioner.CopyFile(name, {
            changeToken,
            conn,
            src: resolvedFile,
            dest: `${destination}/${fileName}`,
        }, {dependsOn: server});
    }

    RunCommand(name: string, server: hcloud.Server, command: pulumi.Input<string>, dependsOn: pulumi.Input<pulumi.Resource>[]): provisioner.RemoteExec {
        const conn = this.GetConnection(server);
        const changeToken = getOutputStringHash(pulumi.Output.create(command));
        return new provisioner.RemoteExec(name, {
            changeToken,
            conn,
            command
        }, {dependsOn});
    }

    private GetConnection(server: hcloud.Server): provisioner.ConnectionArgs {
        return {
            host: server.ipv4Address,
            username: this.credentials.username,
            privateKey: this.credentials.privateKey,
            privateKeyPassphrase: this.credentials.privateKeyPassphrase
        };
    }
}

export interface Result {
    master: hcloud.Server,
    workers: hcloud.Server[]
}
