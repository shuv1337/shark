# SHark production deployment

GitHub Actions is a build and publication boundary only. A manual run on `main` verifies the
repository, publishes `ghcr.io/shuv1337/shark:<full-sha>`, and attaches provenance to the exact
digest. GitHub has no VM credential and cannot perform a production cutover.

Make the GHCR package public after its first publication. The image contains no secrets or private
source; public visibility lets `shark-prod` pull by digest without a registry token.

Install `shark-deploy`, `shark-backup`, `shark-materialize-secrets`, and
`shark-restic-backup` at `/usr/local/sbin`, owned by root and not writable by `exedev`. Install the
reviewed `compose.yaml` as `/etc/shark/compose.yaml`. Install checksum-verified official Infisical
CLI, GitHub CLI, and Restic binaries. Enable the provided systemd backup timer only after a real
backup and restore drill succeeds.

Provision `/etc/shark` with owner `root`, group `exedev`, and mode `0750`, then install these
bootstrap credential files with owner `root`, group `exedev`, mode `0440`, and no trailing
whitespace:

- `infisical-app-client-id` and `infisical-app-client-secret`: Universal Auth credentials for a
  project-level Viewer identity that can read only the SHark application project.
- `infisical-app-project-id`: the application project ID. Its `prod` environment must contain
  exactly `ALLOWED_EMAILS`, `BETTER_AUTH_SECRET`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_TEAM_ID`,
  `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`, `EXPO_ACCESS_TOKEN`, `APNS_KEY_ID`, and
  `APNS_PRIVATE_KEY_BASE64`. Store both Apple `.p8` files as single-line base64.
- `infisical-backup-client-id` and `infisical-backup-client-secret`: Universal Auth credentials
  for a different project-level Viewer identity that can read only the backup project.
- `infisical-backup-project-id`: the backup project ID. Its `prod` environment must contain exactly
  `RESTIC_REPOSITORY` and `RESTIC_PASSWORD`.

The executable helpers enforce these contracts:

- `/usr/local/sbin/shark-materialize-secrets <destination>` exchanges the application identity's
  bootstrap credential for a short-lived token, reads only the application project, validates the
  required values, writes the complete environment with mode `0600`, and prints no values.
- `/usr/local/sbin/shark-restic-backup <database-copy>` uses the separate backup identity, writes
  the encrypted snapshot to `repos/shark-prod`, verifies it by restoring and byte-comparing it,
  applies `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`, removes the plaintext input, and
  prints only the verified snapshot ID.

Install a dedicated passwordless rsync.net SSH private key as
`/home/exedev/.ssh/shark-rsync-net` and pin the server host key in
`/home/exedev/.ssh/known_hosts`. Configure the matching host alias with `IdentityFile`,
`IdentitiesOnly yes`, `BatchMode yes`, and `StrictHostKeyChecking yes`. Initialize the exact
`sftp:<user>@<host>:repos/shark-prod` repository once with `restic init`; the helper deliberately
refuses to initialize a missing repository.

Run `deploy/test-helpers` before installing updated helpers.

To promote, copy the full source SHA and image digest from a green production-publisher run, log
into exe.dev with the existing operator identity, and run:

```sh
/usr/local/sbin/shark-deploy <40-character-main-SHA> <sha256:image-digest>
```

The helper:

1. accepts only a full SHA and digest;
2. verifies the public OCI attestation against `shuv1337/shark`, the publisher workflow,
   `refs/heads/main`, the selected SHA, and a GitHub-hosted runner;
3. anonymously pulls and confirms the exact digest;
4. refreshes application secrets through the scoped Infisical identity;
5. stops the current container and verifies an exact-schema SQLite checkpoint copy;
6. requires a verified encrypted Restic snapshot before replacing an existing deployment;
7. starts Compose with the exact digest, verifies readiness and the private HTTP boundary; and
8. proves the running image ID and records SHA, digest, image ID, backup ID, and timestamp.

The first deployment has no database to back up. Every later deployment requires a verified
pre-deploy snapshot. Retain every digest named by a rollback provenance record until a manual
rollback drill has succeeded.
