# Postgres as a managed service (RDS), outside the cluster: AWS handles the machine, the disk,
# patches and (if switched on) backups. Reachable only from the worker nodes, on port 5432.
#
# The instance is disposable, the data isn't: `terraform destroy` takes a final snapshot, and
# the next `pnpm aws:up` restores the newest one (var.db_snapshot), so the flight history
# survives between sessions. deploy/aws/down.sh keeps the newest three snapshots. No automated
# daily backups and no deletion protection while learning; production would have both
# (docs/LEARNING.md, step 7).

resource "random_password" "db" {
  length = 32
  # Letters and digits only, so it can sit in a postgres:// URL without escaping.
  special = false
}

resource "aws_security_group" "db" {
  name        = "${var.name}-db"
  description = "Postgres, from the EKS worker nodes only"
  vpc_id      = module.vpc.vpc_id
}

# Pods use their node's security group (VPC CNI), so "from the nodes" means "from the pods".
resource "aws_vpc_security_group_ingress_rule" "db_from_nodes" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = module.eks.node_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  description                  = "Postgres from the worker nodes"
}

# A new name for each session's final snapshot: the name is fixed when the database is created
# (destroy can't compute one), and must not repeat, or the next destroy would fail.
resource "random_id" "final_snapshot" {
  byte_length = 4
}

resource "aws_db_instance" "main" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "16" # the same major version as docker-compose and kind; AWS picks the newest 16.x
  instance_class = var.db_instance_class

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  # Restoring a snapshot keeps its database and user names (the same as these), and its data.
  # The password is set afterwards, so each session still gets a new one.
  snapshot_identifier = var.db_snapshot

  db_name  = "ofplens"
  username = "ofplens"
  password = random_password.db.result

  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  # See the comment at the top.
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final-${random_id.final_snapshot.hex}"
  copy_tags_to_snapshot     = true
  backup_retention_period   = 0
  deletion_protection       = false
  apply_immediately         = true

  lifecycle {
    # The snapshot matters only when the database is created. Without this, a newer snapshot
    # (or none) on a later apply would replace the running database, data and all.
    ignore_changes = [snapshot_identifier]
  }
}

# The connection URL for the app, in Secrets Manager; External Secrets copies it into the
# cluster next to the keys from ofplens/app. RDS requires TLS (sslmode=require).
resource "aws_secretsmanager_secret" "database" {
  name        = "${var.name}/database"
  description = "DATABASE_URL for the OFP Lens API (recreated with the cluster)"

  # Delete at once on destroy. The default 7-30 day recovery window would block recreating a
  # secret with the same name on the next apply.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database" {
  secret_id = aws_secretsmanager_secret.database.id
  secret_string = jsonencode({
    DATABASE_URL = "postgres://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:${aws_db_instance.main.port}/${aws_db_instance.main.db_name}?sslmode=require"
  })
}
