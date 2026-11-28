import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, files);
    } else if (entry.name !== 'package-lock.json') {
      files.push(full);
    }
  }
  return files;
}

test('deploy.yml configures keyless Cloud Run deploy on main and workflow_dispatch only', () => {
  const workflowPath = path.join(rootDir, '.github/workflows/deploy.yml');
  const yml = fs.readFileSync(workflowPath, 'utf8');

  // Extract the `on:` block up to the next top-level key so triggers are checked structurally.
  const onBlockMatch = yml.match(/^on:\n([\s\S]*?)^\S/m);
  assert.ok(onBlockMatch, 'deploy.yml must define a top-level on: block');
  const onBlock = onBlockMatch[1];
  assert.match(
    onBlock,
    /^\s+push:\n\s+branches:(?:\s*\[main\]|\n\s+-\s*main\b)/m,
    'must trigger on push to main',
  );
  assert.match(onBlock, /^\s+workflow_dispatch:/m, 'must trigger on workflow_dispatch');
  assert.doesNotMatch(onBlock, /pull_request/i, 'must never trigger on pull_request');

  // Job-level permissions and concurrency.
  assert.match(yml, /^concurrency:\n\s+group:\s*\S+\n\s+cancel-in-progress:\s*false/m);
  const jobsSection = yml.slice(yml.indexOf('\njobs:\n'));
  assert.match(jobsSection, /^\s{4}permissions:\n(?:\s{6}(?:contents:\s*read|id-token:\s*write)\n){2}/m);

  // Keyless WIF auth via repository variables (no secrets or static keys).
  assert.match(yml, /uses:\s*google-github-actions\/auth@v2/);
  assert.match(yml, /workload_identity_provider:\s*\$\{\{\s*vars\.GCP_WORKLOAD_IDENTITY_PROVIDER\s*\}\}/);
  assert.match(yml, /service_account:\s*\$\{\{\s*vars\.GCP_SERVICE_ACCOUNT\s*\}\}/);
  assert.doesNotMatch(yml, /credentials_json|GCP_SA_KEY|secrets\.GCP_/);

  // Docker build/push to Artifact Registry and Cloud Run deploy + smoke check + traffic shift.
  assert.match(yml, /gcloud auth configure-docker "\$\{\{\s*env\.GCP_REGION\s*\}\}-docker\.pkg\.dev"/);
  assert.match(yml, /GCP_PROJECT:\s*tolowa-studio/);
  assert.match(yml, /GCP_REGION:\s*us-west1/);
  assert.match(yml, /AR_REPO:\s*wirelocal-app/);
  assert.match(yml, /SERVICE_NAME:\s*wirelocal-app/);
  assert.match(yml, /RUNTIME_SA:\s*wirelocal-runtime@tolowa-studio\.iam\.gserviceaccount\.com/);
  assert.match(yml, /docker build -t "\$\{IMAGE\}" \./);
  assert.match(yml, /docker push "\$\{IMAGE\}"/);
  assert.match(yml, /gcloud run deploy "\$\{SERVICE_NAME\}"/);
  assert.match(yml, /--service-account "\$\{RUNTIME_SA\}"/);
  assert.match(yml, /--allow-unauthenticated/);
  assert.match(yml, /--no-traffic/);
  assert.match(yml, /--tag "\$\{TAG\}"/);
  assert.match(yml, /for path in \/ \/privacy;/);
  assert.match(yml, /for attempt in 1 2 3 4 5;/);
  assert.match(yml, /"\$\{code\}" = "200"/);
  assert.match(yml, /gcloud run services update-traffic "\$\{SERVICE_NAME\}"[\s\S]*--to-latest/);
});

test('.dockerignore and repo contain no legacy edge-vendor traces', () => {
  const forbidden = new RegExp(['cloud' + 'flare', 'wrang' + 'ler'].join('|'), 'i');
  const dockerignore = fs.readFileSync(path.join(rootDir, '.dockerignore'), 'utf8');
  assert.doesNotMatch(dockerignore, forbidden);

  for (const file of walkFiles(rootDir)) {
    const rel = path.relative(rootDir, file);
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, forbidden, `unexpected legacy reference in ${rel}`);
  }
});

test('scripts/gcp-setup.sh is valid bash and pins WIF to TolowaStudio/wirelocal-app main', () => {
  const scriptPath = path.join(rootDir, 'scripts/gcp-setup.sh');
  execFileSync('bash', ['-n', scriptPath]);
  const dryRun = execFileSync('bash', [scriptPath], { encoding: 'utf8' });

  assert.match(dryRun, /--attribute-condition=.*TolowaStudio\/wirelocal-app.*refs\/heads\/main/);
  assert.match(dryRun, /wirelocal-deployer@tolowa-studio\.iam\.gserviceaccount\.com/);
  assert.match(dryRun, /wirelocal-runtime@tolowa-studio\.iam\.gserviceaccount\.com/);
  assert.match(dryRun, /--role=roles\/run\.developer/);
  assert.match(dryRun, /--role=roles\/artifactregistry\.writer/);
  assert.match(dryRun, /--role=roles\/iam\.serviceAccountUser/);
  assert.match(dryRun, /gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER/);
  assert.match(dryRun, /gh variable set GCP_SERVICE_ACCOUNT/);
});
