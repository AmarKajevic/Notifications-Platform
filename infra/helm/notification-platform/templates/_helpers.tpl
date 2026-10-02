{{- define "notification-platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "notification-platform.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- include "notification-platform.name" . }}
{{- end }}
{{- end }}

{{- define "notification-platform.labels" -}}
app.kubernetes.io/name: {{ include "notification-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
{{- end }}

{{- define "notification-platform.selectorLabels" -}}
app.kubernetes.io/name: {{ include "notification-platform.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}