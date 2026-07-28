# SHark production deployment

GitHub Actions is a build and publication boundary only. A manual run on `main` verifies the
repository, publishes `ghcr.io/shuv1337/shark:<full-sha>`, and attaches provenance to the exact
digest. GitHub has no VM credential and cannot perform a production cutover.

Make the GHCR package public after its first publication. The image contains no secrets or private
source; public visibility lets `shark-prod` pull by digest without a registry token.

Install `shark-deploy`, `shark-backup`, `shark-materialize-secrets`, and
`shark-restic-backup` at `/usr/local/sbin`, owned by root and not writable by `exedev`. Install the
reviewed `compose.yaml` as `/etc/shark/compose.yaml`. Install checksum-verified official 1Password
CLI, GitHub CLI 2.96.0 or newer, and Restic binaries. The deploy helper supplies a non-secret
`GH_TOKEN=anonymous` sentinel because GitHub CLI requires a non-empty token variable before
dispatch even when it reads the public OCI bundle and Sigstore roots without GitHub API access.
Do not install a GitHub credential on the VM. Enable the provided systemd backup timer only
after a real backup and restore drill succeeds.

Provision `/etc/shark` with owner `root`, group `exedev`, and mode `0750`, then install these
bootstrap credential files with owner `root`, group `exedev`, mode `0440`, and no trailing
whitespace:

- `op-app-service-account-token`: a read-only 1Password service-account token with access only to
  vault `SHark Production App`. That vault must contain exactly one Secure Note titled
  `SHark Production App`, with concealed fields `ALLOWED_EMAILS`, `BETTER_AUTH_SECRET`,
  `APPLE_SIGN_IN_KEY_ID`, `APPLE_TEAM_ID`, `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`,
  `EXPO_ACCESS_TOKEN`, `APNS_KEY_ID`, and `APNS_PRIVATE_KEY_BASE64`.
- `op-backup-service-account-token`: a different read-only 1Password service-account token with
  access only to vault `SHark Production Backup`. That vault must contain exactly one Secure Note
  titled `SHark Production Backup`, with concealed fields `RESTIC_REPOSITORY` and
  `RESTIC_PASSWORD`.

Do not grant either service account access to the other vault. Store both Apple `.p8` files as
single-line base64.

See `examples/` for deliberately invalid bootstrap-file samples. Each real file
contains only the copied value: no variable name, quotes, `export`, comments, or surrounding
whitespace. Never commit a real 1Password service-account token.

The executable helpers enforce these contracts:

- `/usr/local/sbin/shark-materialize-secrets <destination>` uses the application service account,
  rejects missing or additional items or fields, writes the complete environment with mode `0600`, and
  prints no values.
- `/usr/local/sbin/shark-restic-backup <database-copy>` uses the separate backup service account,
  writes the encrypted snapshot to `repos/shark-prod`, verifies it by restoring and byte-comparing
  it, applies `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`, removes the plaintext input, and
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
4. refreshes application secrets through the scoped 1Password service account;
5. stops the current container and verifies an exact-schema SQLite checkpoint copy;
6. requires a verified encrypted Restic snapshot before replacing an existing deployment;
7. starts Compose with the exact digest, verifies readiness and the private HTTP boundary; and
8. proves the running image ID and records SHA, digest, image ID, backup ID, and timestamp.

The first deployment has no database to back up. Every later deployment requires a verified
pre-deploy snapshot. Retain every digest named by a rollback provenance record until a manual
rollback drill has succeeded.
