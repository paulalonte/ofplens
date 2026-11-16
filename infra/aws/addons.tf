# Three cluster add-ons, each with exactly the AWS permissions it needs, given to its Kubernetes
# service account through EKS Pod Identity: no access keys anywhere.
#
#   AWS Load Balancer Controller  watches Ingresses; creates and updates an Application Load
#                                 Balancer (ALB) for each. kind's Traefik plays this role locally.
#   External Secrets              copies secrets from Secrets Manager into Kubernetes Secrets.
#   ExternalDNS                   points the Ingress host name (ofplens.app) at that load balancer
#                                 in Route 53, and removes the record when the Ingress goes.

locals {
  lb_controller_service_account    = "aws-load-balancer-controller"
  external_secrets_service_account = "external-secrets"
  external_dns_service_account     = "external-dns"
}

module "lb_controller_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.10"

  name = "${var.name}-lb-controller"

  # AWS's published policy for the controller (create/modify load balancers, target groups,
  # security group rules in this account).
  attach_aws_lb_controller_policy = true

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "kube-system"
      service_account = local.lb_controller_service_account
    }
  }
}

module "external_secrets_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.10"

  name = "${var.name}-external-secrets"

  # Read only, and only these two secrets: the app keys (bootstrap) and the database URL.
  attach_external_secrets_policy        = true
  external_secrets_secrets_manager_arns = [data.aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.database.arn]
  external_secrets_create_permission    = false

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "external-secrets"
      service_account = local.external_secrets_service_account
    }
  }
}

data "aws_secretsmanager_secret" "app" {
  name = var.app_secret_name
}

resource "helm_release" "lb_controller" {
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = "3.6.3"
  namespace  = "kube-system"
  # If a release with this name already exists (say a failed install that Terraform no longer
  # tracks), take it over with an upgrade instead of failing with "name still in use".
  upgrade_install = true

  values = [yamlencode({
    clusterName  = module.eks.cluster_name
    region       = var.region
    vpcId        = module.vpc.vpc_id
    replicaCount = 1 # two by default; one is plenty for a learning cluster
    # Off: this webhook makes the controller handle every new Service of type LoadBalancer
    # (network load balancers). We only use Ingress, and with it on, every Service created
    # while the controller isn't running yet is rejected (the first apply hit exactly that).
    enableServiceMutatorWebhook = false
    serviceAccount = {
      create = true
      name   = local.lb_controller_service_account
    }
  })]

  # Needs nodes to run on and its permissions in place before it starts.
  depends_on = [module.eks, module.lb_controller_identity]
}

resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = "2.15.0"
  namespace        = "external-secrets"
  create_namespace = true
  upgrade_install  = true # see lb_controller

  values = [yamlencode({
    serviceAccount = {
      create = true
      name   = local.external_secrets_service_account
    }
  })]

  # After the load balancer controller is up: its webhooks check new resources, and a webhook
  # without a running pod rejects them ("no endpoints available for service").
  depends_on = [module.eks, module.external_secrets_identity, helm_release.lb_controller]
}

# --- ExternalDNS -----------------------------------------------------------------------------

# The zone Route 53 created when the domain was registered (infra/bootstrap reads it too).
data "aws_route53_zone" "main" {
  name = var.domain
}

module "external_dns_identity" {
  source  = "terraform-aws-modules/eks-pod-identity/aws"
  version = "~> 2.10"

  name = "${var.name}-external-dns"

  # Change records in this one zone only, plus list zones (to find it).
  attach_external_dns_policy    = true
  external_dns_hosted_zone_arns = [data.aws_route53_zone.main.arn]

  associations = {
    controller = {
      cluster_name    = module.eks.cluster_name
      namespace       = "external-dns"
      service_account = local.external_dns_service_account
    }
  }
}

resource "helm_release" "external_dns" {
  name             = "external-dns"
  repository       = "https://kubernetes-sigs.github.io/external-dns/"
  chart            = "external-dns"
  version          = "1.23.0"
  namespace        = "external-dns"
  create_namespace = true
  upgrade_install  = true # see lb_controller

  values = [yamlencode({
    provider      = { name = "aws" }
    sources       = ["ingress"]
    domainFilters = [var.domain]
    # sync: also DELETE records whose Ingress is gone (upsert-only would leave them behind).
    policy = "sync"
    # Ownership: a TXT record next to each record it makes, so it never touches records it
    # didn't create (the certificate's validation records, anything made by hand).
    registry   = "txt"
    txtOwnerId = var.name
    # Every 30 seconds instead of every minute, so a new cluster is reachable sooner.
    interval = "30s"
    serviceAccount = {
      create = true
      name   = local.external_dns_service_account
    }
  })]

  depends_on = [module.eks, module.external_dns_identity, helm_release.lb_controller]
}
