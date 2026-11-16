# The app's own secrets (Claude key, Google and GitHub sign-in), kept here so they survive the
# cluster being destroyed and recreated. Terraform creates the empty secret; you paste the values
# in the console (infra/aws/README.md), so they never pass through Terraform, git or a chat.
#
# Inside the cluster, External Secrets copies every key of this JSON object into the Kubernetes
# Secret the app reads (ofplens-secrets). About $0.40 a month.
resource "aws_secretsmanager_secret" "app" {
  name        = "ofplens/app"
  description = "OFP Lens app keys: ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET"
}

# A first, empty value ({}), so External Secrets can read the secret before you have added
# anything. ignore_changes: the values you set in the console are yours; Terraform never
# overwrites them (and never shows them in a plan).
resource "aws_secretsmanager_secret_version" "app_initial" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({})

  lifecycle {
    ignore_changes = [secret_string]
  }
}
