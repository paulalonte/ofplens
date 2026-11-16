# Lets GitHub Actions sign in to AWS without stored keys (GitHub OIDC).
#
# A workflow asks GitHub for a short-lived token saying "I am repo X, branch Y". AWS checks the
# token's signature against GitHub's public keys (this provider), and the role's trust policy
# below decides which repo and branch may assume the role. The credentials last one hour.
#
# Used by the nightly teardown (.github/workflows/nightly-teardown.yml); step 6 adds a separate
# role for deploying.

variable "github_repository" {
  description = "owner/name of the GitHub repository whose workflows may assume the roles."
  type        = string
  default     = "paulalonte/ofplens"
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Only workflows running on main of this repository (the schedule and manual runs both do).
# A pull request, a fork or another branch gets a different "sub" and is refused.
data "aws_iam_policy_document" "teardown_trust" {
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
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_teardown" {
  name                 = "ofplens-github-teardown"
  description          = "Nightly teardown of infra/aws from GitHub Actions"
  assume_role_policy   = data.aws_iam_policy_document.teardown_trust.json
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
