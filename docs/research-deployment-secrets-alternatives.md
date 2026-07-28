# SHark deployment and secrets alternatives

Research snapshot: 2026-07-27. This note evaluates replacements for the blocked
GitHub-Actions-to-SSH deployment and Bitwarden Secrets Manager design. It makes no
infrastructure changes.

## Recommendation

Use **GitHub Actions only as a builder and publisher**, then make production release an
**operator-initiated pull of an exact, attested GHCR digest**. The original capacity snapshot
favored managed Infisical Cloud. After the operator reported a Bitwarden project slot was
available, they selected one dedicated Bitwarden project with two read-only machine accounts and
disjoint direct secret grants. Project `shark` was created on 2026-07-27 and became visible to the
provisioning identity; the remaining gate is populating it and creating the two narrowly scoped
runtime identities.

This combination preserves the required boundaries:

- GitHub receives no VM shell key and no SHark runtime or backup secret.
- A green `main` build produces an OCI image, but cannot deploy it.
- The operator chooses an exact reviewed commit and image digest, then invokes the installed
  release helper through their existing exe.dev SSH identity.
- The VM pulls a content-addressed image, verifies its GitHub build attestation against the
  expected repository, workflow, `main` ref, and source commit, takes and verifies the required
  Restic checkpoint, and only then replaces the running container.
- Application and backup credentials remain isolated behind distinct read-only machine identities.
- No deployment listener, self-hosted runner, or additional public HTTP route is introduced.

## Deployment transport

### Recommended: attested GHCR digest, operator pull

The `main` workflow should verify the repository, build the production image, push
`ghcr.io/shuv1337/shark`, and emit provenance for the pushed digest. A workflow can publish a
repository-associated package with its ephemeral `GITHUB_TOKEN`; GHCR public images can be pulled
anonymously, so the VM needs no GitHub credential after the package is explicitly made public.
([GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry),
[GitHub Packages permissions](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages))

Use `actions/attest` with the fully qualified image name (without a tag), the pushed digest, and
registry publication. GitHub describes these attestations as signed SLSA provenance binding a
subject digest to its build; public repositories use Sigstore's public-good instance.
([actions/attest](https://github.com/actions/attest),
[GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations))

The operator should release by **digest, never by tag**. Docker documents digest pulls as pinning
an exact immutable image version, while tags can move.
([Docker image pull](https://docs.docker.com/reference/cli/docker/image/pull/))

The host release helper should accept exactly:

```text
release <40-character-main-SHA> <sha256:image-manifest-digest>
```

Before touching the current container it should:

1. Pull `ghcr.io/shuv1337/shark@sha256:...`.
2. Verify provenance with `gh attestation verify`, constraining:
   - `--repo shuv1337/shark`
   - `--signer-workflow` to the pinned image-publisher workflow
   - `--source-ref refs/heads/main`
   - `--source-digest` to the operator-selected SHA
   - `--deny-self-hosted-runners`
3. Materialize only the application secrets from the application identity.
4. For every non-first deployment, require the existing Restic snapshot, streamed restore
   byte-comparison, and repository check before replacement.
5. Start Compose with the exact `image@sha256:...`, verify the running repository digest, verify
   the private HTTP boundary, and record source SHA, image digest, attestation identity, backup
   snapshot, and timestamp.

The GitHub CLI supports all of the source, signer-workflow, and hosted-runner constraints above.
It also supports an offline attestation bundle, which lets the operator carry the bundle to the VM
if anonymous online verification proves awkward in the host environment.
([`gh attestation verify`](https://cli.github.com/manual/gh_attestation_verify),
[offline verification](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline))

Keep the previous digest and immutable provenance record for rollback. Rollback must still take a
fresh verified database checkpoint before changing the running image. GHCR is transport, not the
backup system; the existing encrypted off-host Restic design remains the recovery boundary.

### Alternatives considered

| Option | Result | Reason |
| --- | --- | --- |
| GitHub-hosted job plus SSH | Reject | It requires GitHub to hold a production shell credential, and exe.dev's account gateway does not provide the planned VM-side forced-command boundary. |
| Self-hosted Actions runner on `shark-prod` | Reject | GitHub says self-hosted runners should almost never be used for public repositories because pull-request code can compromise the runner environment. It would also give workflow execution persistent machine-level trust. ([GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)) |
| GitHub Environment approval plus a VM HTTPS token | Not preferred | Environments can gate a job and delay secret access, but they do not narrow the credential itself. ([GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)) exe.dev VM tokens are VM-scoped bearer tokens and can pass signed context to a VM HTTP server, so a private deployment endpoint could implement its own authorization. That still leaves a production bearer token in GitHub and adds a persistent deployment service and private attack surface. ([exe.dev VM tokens](https://exe.dev/docs/https-tokens-for-vms)) |
| Host timer polling GitHub | Viable, unnecessary for v1 | It avoids inbound deployment access, but adds desired-state and approval state that must be secured. A direct operator invocation is simpler and makes the release decision explicit. |
| GitHub OIDC deployment | Not currently applicable | GitHub OIDC is useful when the target cloud exchanges the workflow identity for a short-lived credential, but exe.dev documents SSH and bearer-token APIs rather than a GitHub OIDC trust exchange. ([GitHub Actions security concepts](https://docs.github.com/en/actions/concepts/security), [exe.dev API](https://exe.dev/docs/https-api)) |

## Secret manager

### Capacity fallback evaluated: managed Infisical Cloud

Infisical's current Secrets Manager free tier allows **up to five identities and three projects**.
SHark needs one operator identity, two machine identities, and two projects, so it fits without
reusing an unrelated project. The free tier includes Cloud, API, CLI, SDK, and machine identities;
it does not include secret versioning or point-in-time recovery.
([Infisical pricing](https://infisical.com/pricing))

Create:

- `shark-production-app` project with a project-level identity
  `shark-prod-app`, assigned the built-in **Viewer** role.
- `shark-production-backup` project with a different project-level identity
  `shark-prod-backup`, also assigned **Viewer**.

Infisical documents Viewer as read-only and says built-in roles are available on all plans.
Project-level identities can operate only in their project, which gives the required application /
backup separation.
([Infisical RBAC](https://infisical.com/docs/documentation/platform/access-controls/role-based-access-controls),
[machine identities](https://infisical.com/docs/documentation/platform/identities/machine-identities))

Use Universal Auth for each identity. Store each Client ID and Client Secret in separate
root-owned bootstrap files on the VM. At use time, exchange them for a short-lived access token,
fetch only the exact project and production environment, validate the exact key allowlist, then
discard the token. Infisical's default access-token TTL is 7,200 seconds and is configurable;
Client Secrets can have a TTL and maximum-use count.
([Universal Auth](https://infisical.com/docs/documentation/platform/identities/universal-auth),
[Infisical CLI login](https://infisical.com/docs/cli/commands/login))

Do not self-host Infisical on `shark-prod`: that would put the secret control plane in the same
failure domain as the only application VM and would add another service to operate. Do not use
`infisical run --watch` in production; Infisical itself says automatic production reload is not
recommended. Fetch, validate, and atomically materialize secrets only during an operator release
or backup invocation.
([`infisical run`](https://infisical.com/docs/cli/commands/run))

Because the free tier lacks secret versioning and point-in-time recovery, keep an operator-owned,
offline encrypted recovery copy of the irreplaceable Apple/APNs key material and Restic repository
password, outside GitHub and outside `shark-prod`. Test recovery before cutover. This escrow is for
disaster recovery, not routine runtime access.

### Other secret options

| Option | Strengths | Costs / gaps | Fit |
| --- | --- | --- | --- |
| 1Password service accounts | No extra service to deploy; each service account can be limited to chosen vaults with immutable `read_items` permissions; tokens can be rotated or immediately revoked; CLI can inject or read referenced secrets. ([service-account setup](https://www.1password.dev/service-accounts/get-started), [security model](https://www.1password.dev/service-accounts/security), [token management](https://www.1password.dev/service-accounts/manage-service-accounts), [CLI scripts](https://developer.1password.com/docs/cli/secrets-scripts)) | The VM retains a service-account token rather than exchanging a bootstrap credential for a short-lived access token. | Selected after the Bitwarden Free organization limit prevented two isolated SHark runtime identities. Use two vaults and two read-only accounts; never one account spanning both. |
| SOPS + age | No hosted service, no runtime network dependency, and encrypted files can live in the public repository. Separate age recipients can cryptographically isolate application and backup files; SOPS supports fully encrypted binary files as well as structured dotenv/YAML. ([SOPS](https://getsops.io/), [age](https://github.com/FiloSottile/age)) | The VM holds long-lived decryption identities. There is no central access log, short-lived machine session, or server-side revocation; removal requires recipient/key rotation, and old Git history remains decryptable to a compromised old identity. Operational recovery depends entirely on offline identity custody. | Good break-glass or tiny offline design, but weaker than managed Infisical for routine production access. If used, require different age identities for app and backup and never commit either identity. |

## Decision

Revised 2026-07-28 after the Bitwarden Free organization machine-account limit blocked the
required isolation. Adopt:

1. public GHCR image publication from exact `main`, with GitHub build provenance;
2. operator-triggered, digest-pinned deployment through the existing exe.dev identity;
3. separate 1Password application and backup vaults with separate read-only service accounts,
   each scoped only to its required vault;
4. the existing off-host Restic gate, provenance record, and rollback requirements.

This removes both current blockers without expanding SHark's anonymous v1 surface or placing a
production shell credential in GitHub.
