# The Kubernetes cluster. AWS runs the control plane (API server, etcd, scheduler: the part kind
# runs in its "control-plane" container); we only get worker nodes, as a managed node group
# (EC2 instances that AWS creates, joins to the cluster and replaces).
#
# Cost while it exists: control plane $0.10/hour, plus the nodes.

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.29"

  name               = var.name
  kubernetes_version = var.kubernetes_version

  # The API server answers on a public address (kubectl from your Mac, Helm from Terraform),
  # still only to callers with a valid AWS identity that has an access entry below.
  endpoint_public_access = true

  # Whoever runs `terraform apply` (your SSO role) becomes a cluster admin (an EKS access entry).
  enable_cluster_creator_admin_permissions = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.public_subnets

  # Pods get AWS permissions through EKS Pod Identity (addons.tf), not IRSA, so the cluster
  # needs no OIDC provider in IAM.
  enable_irsa = false

  # AWS-managed add-ons, kept compatible with the Kubernetes version by EKS.
  addons = {
    vpc-cni = {
      # Pod networking: every pod gets a real VPC IP address. Must exist before the nodes.
      before_compute = true
    }
    eks-pod-identity-agent = {
      # Hands out AWS credentials to pods that have a Pod Identity association.
      before_compute = true
    }
    kube-proxy = {}
    coredns    = {}
  }

  eks_managed_node_groups = {
    default = {
      # Amazon Linux 2023 for ARM (Graviton), matching the t4g instance type.
      ami_type       = "AL2023_ARM_64_STANDARD"
      instance_types = [var.node_instance_type]

      min_size     = 1
      max_size     = 3
      desired_size = var.node_count
    }
  }
}
