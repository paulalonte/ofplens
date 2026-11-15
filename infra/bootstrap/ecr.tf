# Private container registries for the images (step 1). EKS pulls from here; CI pushes here
# (step 6). Kept when the cluster is destroyed, so images do not have to be rebuilt.

resource "aws_ecr_repository" "images" {
  for_each = var.image_repositories

  name = each.key

  # A tag, once pushed, always means the same image: no "latest" moving under a running pod.
  image_tag_mutability = "IMMUTABLE"

  # Free basic scan for known vulnerabilities (CVEs) in OS packages on every push.
  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "images" {
  for_each = aws_ecr_repository.images

  repository = each.value.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Delete untagged images (layers left over from re-pushes) after a day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the newest ${var.images_to_keep} images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.images_to_keep
        }
        action = { type = "expire" }
      },
    ]
  })
}
