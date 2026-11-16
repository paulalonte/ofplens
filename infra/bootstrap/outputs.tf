output "state_bucket" {
  description = "S3 bucket for Terraform state: pass it to terraform init -backend-config."
  value       = aws_s3_bucket.state.bucket
}

output "ecr_repository_urls" {
  description = "Where images are pushed: <url>:<tag>. The registry part goes into the Helm values on AWS."
  value       = { for name, repo in aws_ecr_repository.images : name => repo.repository_url }
}

output "region" {
  value = var.region
}

output "app_secret_name" {
  description = "Secrets Manager secret with the app's keys; paste values in the console."
  value       = aws_secretsmanager_secret.app.name
}

output "github_teardown_role_arn" {
  description = "Store as the GitHub secret AWS_TEARDOWN_ROLE_ARN (infra/aws/README.md)."
  value       = aws_iam_role.github_teardown.arn
}
