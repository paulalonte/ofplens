# Lets GitHub Actions sign in to AWS without stored keys (GitHub OIDC).
#
# A workflow asks GitHub for a short-lived token saying "I am repo X, branch Y". AWS checks the
# token's signature against GitHub's public keys (this provider), and the role's trust policy
# below decides which repo and branch may assume the role. The credentials last one hour.
#
# Used by the nightly teardown (.github/workflows/nightly-teardown.yml); step 6 adds a separate
# role for deploying.

# Who a workflow says it is, in GitHub's token ("sub"). This repository uses GitHub's immutable
# format, owner@<owner id>/repo@<repo id>: the numeric ids never change, so deleting the repo
# and someone recreating one with the same name can't inherit this trust. Look it up with:
#   gh api repos/<owner>/<repo>/actions/oidc/customization/sub     (sub_claim_prefix)
variable "github_subject_prefix" {
  description = "The token's sub prefix for this repository (gh api …/actions/oidc/customization/sub)."
  type        = string
  default     = "repo:paulalonte@11928482/ofplens@1451769280"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only workflows running on main of this repository (the schedule and manual runs both do).
# A pull request, a fork or another branch gets a different "sub" and is refused.
data "aws_iam_policy_document" "main_branch_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_teardown" {
  name                 = "ofplens-github-teardown"
  description          = "Nightly teardown of infra/aws from GitHub Actions"
  assume_role_policy   = data.aws_iam_policy_document.main_branch_trust.json
  max_session_duration = 3600
}

# What `terraform destroy` of infra/aws needs: almost every service (EC2, EKS, RDS, load
# balancers, Secrets Manager, the state bucket), read access to IAM, and deleting only the IAM
# roles and policies of the cluster stack (tagged Stack=aws). Broad, but it can't touch IAM
# users, this bootstrap's roles, other projects' roles, or your app keys (denied below).
# Production would scope it further or run it in a separate account (docs/LEARNING.md, step 4b).
resource "aws_iam_role_policy_attachment" "teardown_power_user" {
  role       = aws_iam_role.github_teardown.name
  policy_arn = "arn:aws:iam::aws:policy/PowerUserAccess"
}

resource "aws_iam_role_policy_attachment" "teardown_iam_read" {
  role       = aws_iam_role.github_teardown.name
  policy_arn = "arn:aws:iam::aws:policy/IAMReadOnlyAccess"
}

data "aws_iam_policy_document" "teardown_extra" {
  statement {
    sid = "DeleteProjectIamRoles"
    actions = [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:RemoveRoleFromInstanceProfile",
      "iam:DeleteInstanceProfile",
      "iam:UntagRole",
      "iam:UntagPolicy",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Stack"
      values   = ["aws"]
    }
  }

  # The workflow never needs your Claude or sign-in keys, so it can't read them even if it
  # were compromised (Terraform only describes the secret, it doesn't read its value).
  statement {
    sid       = "NeverReadAppKeys"
    effect    = "Deny"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "teardown_extra" {
  name   = "teardown-extra"
  role   = aws_iam_role.github_teardown.id
  policy = data.aws_iam_policy_document.teardown_extra.json
}

# --- Deploy on merge (.github/workflows/deploy.yml) -------------------------------------------

# Same trust as the teardown role (main_branch_trust): only workflows on main of this repository.
resource "aws_iam_role" "github_deploy" {
  name                 = "ofplens-github-deploy"
  description          = "Builds and pushes the images, and deploys the app when a cluster is up"
  assume_role_policy   = data.aws_iam_policy_document.main_branch_trust.json
  max_session_duration = 3600
}

# Much narrower than the teardown role: it can push images to the two repositories and find
# the cluster. What it may do inside the cluster is set by its EKS access entry in infra/aws
# (edit the ofplens namespace only). It can't create or delete any AWS infrastructure.
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushAndReadImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for repo in aws_ecr_repository.images : repo.arn]
  }

  statement {
    sid       = "FindTheCluster"
    actions   = ["eks:DescribeCluster"]
    resources = ["arn:aws:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/ofplens"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
