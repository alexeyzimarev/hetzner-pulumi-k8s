import * as pulumi from "@pulumi/pulumi";
import {interpolate} from "@pulumi/pulumi";

export const Commands = {
    installTools(): string {
        return `cat /root/sysctl.conf | tee -a /etc/sysctl.conf \
&& curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add - \
&& curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key add - \
&& echo "deb https://apt.kubernetes.io/ kubernetes-xenial main" | tee -a /etc/apt/sources.list.d/kubernetes.list \
&& echo "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee -a /etc/apt/sources.list.d/docker.list \
&& apt-get update \
&& apt-get install -y docker-ce kubeadm kubectl kubelet`;
    },

    kubeInit(version: string, cidr: string, masterIp: pulumi.Output<string>): pulumi.Output<string> {
        return masterIp.apply(ip => `kubeadm config images pull \
&& kubeadm init --pod-network-cidr=${cidr} --kubernetes-version=${version} --ignore-preflight-errors=NumCPU --apiserver-cert-extra-sans=${ip}`
        );
    },

    copyConfig(): string {
        return `mkdir -p /root/.kube \
&& cp -i /etc/kubernetes/admin.conf /root/.kube/config \
&& chown $(id -u):$(id -g) /root/.kube/config \
&& cat /root/.kube/config`;
    },

    installControllers(apiToken: string): string {
        return `kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/v0.12.0/Documentation/kube-flannel.yml \
&& kubectl -n kube-system patch ds kube-flannel-ds-amd64 --type json -p '[{"op":"add","path":"/spec/template/spec/tolerations/-","value":{"key":"node.cloudprovider.kubernetes.io/uninitialized","value":"true","effect":"NoSchedule"}}]' \
&& kubectl -n kube-system create secret generic hcloud --from-literal=token=${apiToken} \
&& kubectl apply -f https://raw.githubusercontent.com/hetznercloud/hcloud-cloud-controller-manager/master/deploy/v1.7.0.yaml`;
    }
}
