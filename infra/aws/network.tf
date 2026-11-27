# The network: one VPC across two availability zones (separate data centres), because EKS and
# RDS both require at least two.
#
#   public subnets    worker nodes and the load balancer; a route to the internet gateway
#   database subnets  RDS only; no route to the internet at all
#
# No NAT gateway: it would let machines in private subnets reach the internet, for about
# $35/month on its own. Instead the nodes sit in public subnets with public IPs (for pulling
# images and talking to AWS APIs) and their security group lets nothing in from the internet.
# Production clusters usually put nodes in private subnets behind NAT; see docs/LEARNING.md.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.7"

  name = var.name
  cidr = "10.40.0.0/16"
  azs  = local.azs

  public_subnets   = ["10.40.0.0/20", "10.40.16.0/20"]
  database_subnets = ["10.40.128.0/24", "10.40.129.0/24"]

  # Nodes get a public IP at launch (they need one without a NAT gateway).
  map_public_ip_on_launch = true
  enable_nat_gateway      = false
  enable_dns_hostnames    = true

  create_database_subnet_group = true

  # Tells the load balancer controller which subnets an internet-facing load balancer goes in.
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
}

# The public subnets, handed to the cluster only together with their way out to the internet
# (the route to the internet gateway and the subnets' link to that route table). Terraform
# orders a destroy by references, and the subnet ids alone don't mention the route: so it used to
# delete the route in parallel with the cluster's add-ons, and the nodes (no NAT, see above) lost
# the internet while Helm's cleanup jobs still had images to pull (the nightly teardown of
# 2026-11-27, OFP-60). Through this, the cluster (and everything installed on it) is created after
# the route and destroyed before it.
resource "terraform_data" "public_subnets_online" {
  input = {
    subnet_ids = module.vpc.public_subnets
    route      = module.vpc.public_internet_gateway_route_id
    links      = module.vpc.public_route_table_association_ids
  }
}
