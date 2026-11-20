# Monitoring: Grafana's k8s-monitoring chart sends the cluster's metrics, events and pod logs to
# Grafana Cloud's free tier (deployment step 7, part 2b). What it collects and where it sends:
# deploy/aws/monitoring-values.yaml. The dashboards and data live in Grafana Cloud, so they
# survive aws:down.
#
# Needs the ofplens/grafana secret (created by infra/bootstrap, filled in by you:
# infra/aws/README.md, "Monitoring"). Turn it off for a session with -var monitoring=false.

# Created by infra/bootstrap, like ofplens/app.
data "aws_secretsmanager_secret" "grafana" {
  name = var.grafana_secret_name
}

resource "helm_release" "k8s_monitoring" {
  count = var.monitoring ? 1 : 0

  name             = "k8s-monitoring"
  repository       = "https://grafana.github.io/helm-charts"
  chart            = "k8s-monitoring"
  version          = "4.6.1"
  namespace        = "monitoring"
  create_namespace = true
  upgrade_install  = true # see lb_controller

  values = [
    file("${path.module}/../../deploy/aws/monitoring-values.yaml"),
    yamlencode({ cluster = { name = var.name } }),
  ]

  # Its SecretStore and ExternalSecret need External Secrets' resource types and webhook, and
  # the Alloy pod needs nodes. Destroyed before the cluster, so its cleanup hooks still run.
  depends_on = [module.eks, helm_release.external_secrets]
}
