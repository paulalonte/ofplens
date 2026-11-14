{{/* Resource names: <release>-api, <release>-web, ... */}}
{{- define "ofplens.name" -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end }}

{{/* Labels on every resource (the app.kubernetes.io/* convention). */}}
{{- define "ofplens.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: ofplens
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels for one part: include "ofplens.selector" (list . "api") */}}
{{- define "ofplens.selector" -}}
{{- $root := index . 0 -}}
app.kubernetes.io/name: ofplens
app.kubernetes.io/instance: {{ $root.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end }}

{{/* Image reference: include "ofplens.image" (list . .Values.image.api) */}}
{{- define "ofplens.image" -}}
{{- $root := index . 0 -}}
{{- $tag := required "image.tag is required (one immutable tag per build)" $root.Values.image.tag -}}
{{- with $root.Values.image.registry }}{{ . }}/{{ end }}{{ index . 1 }}:{{ $tag }}
{{- end }}

{{/* Pod-level security: never root, default seccomp profile. */}}
{{- define "ofplens.podSecurity" -}}
runAsNonRoot: true
seccompProfile:
  type: RuntimeDefault
{{- end }}

{{/* Container-level security: read-only filesystem, no privilege escalation, no capabilities. */}}
{{- define "ofplens.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end }}

{{/* The database URL and Claude key, from the existing Secret. */}}
{{- define "ofplens.secretEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.existingSecret }}
      key: DATABASE_URL
{{- end }}
