# The domain and its TLS certificate. Both are kept between cluster sessions: the certificate is
# free, but issuing one takes a few minutes, so it's made once here instead of every session.
#
# Bought by hand in Route 53 (a purchase, so not Terraform's job). Registering it created the
# hosted zone, the place its DNS records live ($0.50/month); Terraform only reads it.

variable "domain" {
  description = "The domain bought in Route 53. Its hosted zone must exist (registration creates it)."
  type        = string
  default     = "ofplens.app"
}

data "aws_route53_zone" "main" {
  name = var.domain
}

# A free public certificate from AWS Certificate Manager, for the load balancer's HTTPS listener.
# The load balancer controller finds it by the Ingress host name, so its ARN never has to be
# passed around. Renewed by AWS automatically while the validation record below exists.
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Proof that we control the domain: ACM asks for a CNAME record with a random name; creating it
# in our zone is the proof. One record per name on the certificate.
resource "aws_route53_record" "certificate_validation" {
  for_each = {
    for option in aws_acm_certificate.main.domain_validation_options : option.domain_name => {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  }

  zone_id         = data.aws_route53_zone.main.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.value]
  ttl             = 300
  allow_overwrite = true
}

# Waits (usually a few minutes) until ACM has seen the records and issued the certificate.
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.certificate_validation : record.fqdn]
}
