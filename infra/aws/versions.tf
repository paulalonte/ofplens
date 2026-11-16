terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
    # Installs the cluster add-ons (load balancer controller, External Secrets) as Helm charts.
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.3"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }

  # State in the bucket from infra/bootstrap, next to the bootstrap's own state. The bucket name
  # contains your account id, so it is passed at init (deploy/aws/up.sh does this):
  #   terraform init -backend-config="bucket=ofplens-tfstate-<account id>"
  backend "s3" {
    key          = "aws/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

# Credentials come from the environment (AWS_PROFILE=ofplens on your Mac).
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "ofplens"
      Stack     = "aws"
      ManagedBy = "terraform"
    }
  }
}

# Helm talks to the cluster this stack creates. The token comes from `aws eks get-token`, with
# the same AWS login as Terraform itself: no kubeconfig file is involved.
provider "helm" {
  kubernetes = {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name, "--region", var.region]
    }
  }
}
