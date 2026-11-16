variable "region" {
  description = "AWS region. Must match infra/bootstrap (the image repositories and the app secret live there)."
  type        = string
  default     = "eu-central-1"
}

variable "name" {
  description = "Name of the cluster, the database and the prefix of everything else."
  type        = string
  default     = "ofplens"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version. Newest on standard support; older ones cost 6x more (extended support)."
  type        = string
  default     = "1.37"
}

variable "node_instance_type" {
  description = "Worker node size. t4g = Graviton (ARM): cheaper per hour than the Intel/AMD sizes. Your Mac builds ARM images."
  type        = string
  default     = "t4g.medium"
}

variable "node_count" {
  description = "Worker nodes. Two, so the app's two API pods run on different machines."
  type        = number
  default     = 2
}

variable "db_instance_class" {
  description = "RDS size. db.t4g.micro: 2 vCPU (burstable), 1 GiB, the smallest Postgres instance."
  type        = string
  default     = "db.t4g.micro"
}

variable "app_secret_name" {
  description = "Secrets Manager secret with the app's keys, created by infra/bootstrap."
  type        = string
  default     = "ofplens/app"
}

variable "domain" {
  description = "The app's domain (infra/bootstrap reads its zone and holds its certificate)."
  type        = string
  default     = "ofplens.app"
}
