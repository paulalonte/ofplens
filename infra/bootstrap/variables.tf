variable "region" {
  description = "AWS region for everything OFP Lens runs in."
  type        = string
  default     = "eu-central-1"
}

variable "budget_email" {
  description = "Where budget alerts go. Set it in terraform.tfvars (git-ignored) or TF_VAR_budget_email, never in a committed file."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_email))
    error_message = "budget_email must be an email address."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly spending you expect. Alerts at 50% and 100% spent, and when the month is forecast to go over."
  type        = number
  default     = 20

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "The budget must be more than 0."
  }
}

variable "image_repositories" {
  description = "One ECR repository per container image."
  type        = set(string)
  default     = ["ofplens-api", "ofplens-web"]
}

variable "images_to_keep" {
  description = "Newest images kept per repository; older ones are deleted to keep storage (and its cost) small."
  type        = number
  default     = 15
}
