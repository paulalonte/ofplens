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
