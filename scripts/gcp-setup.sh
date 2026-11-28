#!/usr/bin/env bash
# Provision keyless GitHub Actions -> Cloud Run deployment for TolowaStudio/wirelocal-app.
# Dry-run by default (prints commands). Pass --apply as a project owner after IAM approval.
set -euo pipefail

MODE="dry-run"
if [[ "${1:-}" == "--apply" ]]; then
  MODE="apply"
elif [[ "${1:-}" != "" && "${1:-}" != "--dry-run" ]]; then
  echo "Usage: $0 [--dry-run|--apply]" >&2
  exit 2
fi

GCP_PROJECT="${GCP_PROJECT:-tolowa-studio}"
GCP_PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-895468771800}"
GCP_REGION="${GCP_REGION:-us-west1}"
AR_REPO="${AR_REPO:-wirelocal-app}"
GITHUB_REPO="${GITHUB_REPO:-TolowaStudio/wirelocal-app}"

WIF_POOL="${WIF_POOL:-wirelocal-app}"
WIF_PROVIDER="${WIF_PROVIDER:-github}"
DEPLOYER_SA_ID="wirelocal-deployer"
RUNTIME_SA_ID="wirelocal-runtime"
DEPLOYER_SA="${DEPLOYER_SA_ID}@${GCP_PROJECT}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_SA_ID}@${GCP_PROJECT}.iam.gserviceaccount.com"

WIF_PROVIDER_NAME="projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
WIF_PRINCIPAL="principalSet://iam.googleapis.com/projects/${GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}"

run() {
  printf '+ '
  printf '%q ' "$@"
  printf '\n'
  if [[ "$MODE" == "apply" ]]; then
    "$@"
  fi
}

echo "== Enable required GCP APIs =="
run gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --project="${GCP_PROJECT}"

echo "== Artifact Registry repository (${AR_REPO} in ${GCP_REGION}) =="
if [[ "$MODE" == "dry-run" ]] || ! gcloud artifacts repositories describe "${AR_REPO}" --location="${GCP_REGION}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  run gcloud artifacts repositories create "${AR_REPO}" \
    --project="${GCP_PROJECT}" \
    --location="${GCP_REGION}" \
    --repository-format=docker \
    --description="Wire Local (wirelocal.app) Cloud Run container images"
fi

echo "== Service accounts (no JSON keys) =="
if [[ "$MODE" == "dry-run" ]] || ! gcloud iam service-accounts describe "${RUNTIME_SA}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "${RUNTIME_SA_ID}" \
    --project="${GCP_PROJECT}" \
    --display-name="Wire Local Cloud Run runtime"
fi
if [[ "$MODE" == "dry-run" ]] || ! gcloud iam service-accounts describe "${DEPLOYER_SA}" --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "${DEPLOYER_SA_ID}" \
    --project="${GCP_PROJECT}" \
    --display-name="Wire Local GitHub Actions deployer"
fi

echo "== Dedicated Workload Identity Pool & Provider (repo + main pinned) =="
if [[ "$MODE" == "dry-run" ]] || ! gcloud iam workload-identity-pools describe "${WIF_POOL}" --location=global --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  run gcloud iam workload-identity-pools create "${WIF_POOL}" \
    --project="${GCP_PROJECT}" \
    --location=global \
    --display-name="Wirelocal App GitHub"
fi
if [[ "$MODE" == "dry-run" ]] || ! gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER}" --workload-identity-pool="${WIF_POOL}" --location=global --project="${GCP_PROJECT}" >/dev/null 2>&1; then
  run gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER}" \
    --project="${GCP_PROJECT}" \
    --location=global \
    --workload-identity-pool="${WIF_POOL}" \
    --display-name="Wirelocal App main OIDC" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/main'"
fi

echo "== IAM bindings for wirelocal-deployer =="
run gcloud iam service-accounts add-iam-policy-binding "${DEPLOYER_SA}" \
  --project="${GCP_PROJECT}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${WIF_PRINCIPAL}"

run gcloud projects add-iam-policy-binding "${GCP_PROJECT}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/run.developer" \
  --condition=None

run gcloud artifacts repositories add-iam-policy-binding "${AR_REPO}" \
  --project="${GCP_PROJECT}" \
  --location="${GCP_REGION}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/artifactregistry.writer"

run gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA}" \
  --project="${GCP_PROJECT}" \
  --member="serviceAccount:${DEPLOYER_SA}" \
  --role="roles/iam.serviceAccountUser"

echo "== GitHub repository variables (not secrets) =="
run gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER \
  -R "${GITHUB_REPO}" \
  --body "${WIF_PROVIDER_NAME}"

run gh variable set GCP_SERVICE_ACCOUNT \
  -R "${GITHUB_REPO}" \
  --body "${DEPLOYER_SA}"

echo "Mode=${MODE}."
