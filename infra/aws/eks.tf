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

  # Two module defaults switched off for a disposable cluster:
  # - its own KMS key for Kubernetes Secrets ($1/month each, and a deleted key lingers 30
  #   days, so one per session adds up). EKS already encrypts Secrets with an AWS-owned key.
  # - control plane logs in CloudWatch (billed per GB; the audit log is chatty).
  create_kms_key              = false
  encryption_config           = null
  enabled_log_types           = []
  create_cloudwatch_log_group = false

  # The nightly teardown (GitHub Actions, OFP-45) must uninstall Helm releases before
  # destroying, so its role is a cluster admin too. The role is created by infra/bootstrap.
  access_entries = {
    github_teardown = {
      principal_arn = data.aws_iam_role.github_teardown.arn
      policy_associations = {
        admin = {
          policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }

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

data "aws_iam_role" "github_teardown" {
  name = "ofplens-github-teardown"
}
