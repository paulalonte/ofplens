output "cluster_name" {
  value = module.eks.cluster_name
}

output "region" {
  value = var.region
}

output "kubeconfig_command" {
  description = "Adds the cluster to your kubeconfig (context name: ofplens-aws), for kubectl and k9s."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name} --alias ofplens-aws"
}

output "database_secret_name" {
  description = "Secrets Manager secret with DATABASE_URL (read by External Secrets)."
  value       = aws_secretsmanager_secret.database.name
}

output "app_secret_name" {
  value = var.app_secret_name
}
