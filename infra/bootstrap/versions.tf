terraform {
  # 1.10+ for S3-native state locking (use_lockfile), no DynamoDB table needed.
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.70"
    }
  }
}

# Credentials come from the environment: AWS_PROFILE=ofplens (your SSO login) on your Mac,
# GitHub's OIDC role in CI later. Nothing account-specific is written in these files.
provider "aws" {
  region = var.region

  # On every resource this creates, so the bill can be filtered by them.
  default_tags {
    tags = {
      Project   = "ofplens"
      Stack     = "bootstrap"
      ManagedBy = "terraform"
    }
  }
}
