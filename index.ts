import * as pulumi from "@pulumi/pulumi";
import {HetznerCloudSettings, KubeSettings} from "./hcloud/settings";
import {hcloudCluster} from "./hcloud";
import {getCredentials} from "./hcloud/credentials";

const config = new pulumi.Config();
const hcSettings = config.requireObject<HetznerCloudSettings>("cluster");
const kubeSettings = config.requireObject<KubeSettings>("kubernetes");

const cluster = new hcloudCluster(hcSettings, getCredentials(config), kubeSettings, pulumi.getStack());

export const result = cluster.result;
