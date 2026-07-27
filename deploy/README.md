# SHark production deployment

The GitHub workflow sends an exact Git archive and reviewed full SHA to a dedicated SSH key on
`shark-prod`. The key must use `deploy/shark-deploy` as its forced command and disable PTY, agent
forwarding, port forwarding, X11 forwarding, and user-supplied environment variables. Rotate it at
least every 90 days.

Install the wrapper outside the synchronized release tree as
`/usr/local/sbin/shark-deploy`. Install `shark-backup` at
`/usr/local/sbin/shark-backup` and enable the provided systemd timer. Provision two root-owned
helpers:

- `/usr/local/sbin/shark-materialize-secrets <destination>` authenticates with a scoped Bitwarden
  Secrets Manager machine account, reads only the SHark application project, writes the complete
  production environment to the requested destination with mode `0600`, and prints no values.
- `/usr/local/sbin/shark-restic-backup <database-copy>` authenticates with a separate scoped
  Bitwarden project, backs the copy up to the account-relative rsync.net repository
  `repos/shark-prod`, verifies the new snapshot, applies `--keep-daily 7 --keep-weekly 4
  --keep-monthly 6`, removes the plaintext input, and prints only the verified snapshot ID.

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
