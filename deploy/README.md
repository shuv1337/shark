# SHark production deployment

The GitHub workflow sends an exact Git archive and reviewed full SHA to a dedicated SSH key on
`shark-prod`. The key must use `deploy/shark-deploy` as its forced command and disable PTY, agent
forwarding, port forwarding, X11 forwarding, and user-supplied environment variables. Rotate it at
least every 90 days.

Install the wrapper outside the synchronized release tree as
`/usr/local/sbin/shark-deploy`. Install `shark-backup`,
`shark-materialize-secrets`, and `shark-restic-backup` at `/usr/local/sbin`, all owned by root and
not writable by `exedev`. Install the checksum-verified official `bws` 2.1.0 and Restic 0.19.1
binaries in `/usr/local/bin`. Enable the provided systemd timer.

Provision `/etc/shark` with owner `root`, group `exedev`, and mode `0750`, then install these
bootstrap credential files with owner `root`, group `exedev`, mode `0440`, and no trailing
whitespace:

- `bws-app-access-token`: a Bitwarden Secrets Manager machine token with read access only to the
  SHark application project.
- `bws-app-project-id`: that project UUID. It must contain exactly one value for each key consumed
  by the helper: `ALLOWED_EMAILS`, `BETTER_AUTH_SECRET`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_TEAM_ID`,
  `APPLE_SIGN_IN_PRIVATE_KEY_BASE64`, `EXPO_ACCESS_TOKEN`, `APNS_KEY_ID`, and
  `APNS_PRIVATE_KEY_BASE64`. Store both Apple `.p8` files as single-line base64.
- `bws-backup-access-token`: a different machine token with read access only to the SHark backup
  project.
- `bws-backup-project-id`: that project UUID. Its required keys are `RESTIC_REPOSITORY` and
  `RESTIC_PASSWORD`.

The executable helpers enforce these contracts:

- `/usr/local/sbin/shark-materialize-secrets <destination>` authenticates with a scoped Bitwarden
  Secrets Manager machine account, reads only the SHark application project, writes the complete
  production environment to the requested destination with mode `0600`, and prints no values.
- `/usr/local/sbin/shark-restic-backup <database-copy>` authenticates with a separate scoped
  Bitwarden project, backs the copy up to the account-relative rsync.net repository
  `repos/shark-prod`, verifies the new snapshot by restoring and byte-comparing it, applies
  `--keep-daily 7 --keep-weekly 4 --keep-monthly 6`, removes the plaintext input, and prints only
  the verified snapshot ID.

Install a dedicated passwordless rsync.net SSH private key as
`/home/exedev/.ssh/shark-rsync-net` and pin the server host key in
`/home/exedev/.ssh/known_hosts`. Configure the matching host alias in `.ssh/config` with
`IdentityFile`, `IdentitiesOnly yes`, `BatchMode yes`, and `StrictHostKeyChecking yes`. Initialize
the exact `sftp:<user>@<host>:repos/shark-prod` repository once with `restic init`; the backup
helper deliberately refuses to initialize a missing repository.

Run `deploy/test-helpers` before installing updated helpers.

GitHub stores only `SHARK_DEPLOY_HOST`, the restricted SSH private key, and pinned known-hosts
material. Apple, APNs, Expo, application, database, Bitwarden, and Restic credentials stay on the
host and in Bitwarden.

The wrapper:

1. rejects every command except `deploy <40-character Git SHA>`;
2. unpacks the exact archive into an immutable SHA release directory;
3. refreshes application secrets directly from Bitwarden;
4. builds `shark:<full-sha>`;
5. stops the current container and verifies an exact-schema SQLite checkpoint copy;
6. requires a verified encrypted Restic snapshot before replacing an existing deployment;
7. starts the new image, verifies readiness and the private HTTP boundary;
8. proves the running image ID matches `shark:<full-sha>` and records provenance.

The first deployment has no database to back up. Every later deployment requires a verified
pre-deploy snapshot. Keep the previous immutable release and image until a manual rollback drill
has succeeded.
