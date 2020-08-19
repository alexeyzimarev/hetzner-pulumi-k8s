export interface HetznerCloudSettings {
    privateKey: string,
    privateKeyPassphrase: string,
    location: string,
    networkIpRange: string;
    networkName: string;
    masterSize: string,
    workerSize: string,
    vmImage: string,
    sshKeyId: string,
    workersCount: number
}

export interface KubeSettings {
    version: string,
    networkCidr: string,
}
