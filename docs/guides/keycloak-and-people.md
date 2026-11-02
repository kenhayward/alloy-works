# Keycloak, people and permissions on a development stack

> For somebody trying people and permission models on a development stack. How to run Keycloak in place of
> the stand-in, add people and groups, and give them access. Development only: never in production. How the
> files work is in [deploy/README.md](../../deploy/README.md#keycloak-in-place-of-the-stand-in-composekeycloakyaml).

## 1. Start the stack

You need Docker Engine 28 or later, and a package token: `NODE_AUTH_TOKEN` in `deploy/.env`, or the GitHub
CLI signed in (`gh auth login`), which `BringUpDev.cmd` reads for itself.

**On this machine only:**

```bash
docker compose -f deploy/compose.yaml -f deploy/compose.keycloak.yaml up -d --build --wait
```

Name no services on that line: naming them leaves a stand-in already running, holding the port. An existing
stack moves across as it is, and Ada and Grace keep what they held.

**For other machines too**, on Windows, from a clean checkout of `main`: set `ALLOY_SIGN_IN=keycloak` in
`deploy/.env` (copy `deploy/.env.example` if you have none), let ports 8443, 9443 and 8343 through the
firewall, and run:

```bash
deploy\BringUpDev.cmd
```

Anybody on the network can then reach the stack and its development keys, so use a network you trust.

| What               | On this machine                   | With `BringUpDev.cmd`, from any machine |
| ------------------ | --------------------------------- | --------------------------------------- |
| Development        | `http://dev.acme.localhost:8088`  | `https://<address>:8443`                |
| Production         | `http://acme.localhost:8088`      | not offered                             |
| Keycloak's console | `http://idp.localhost:9090/admin` | `https://<address>:9443/admin`          |

`BringUpDev.cmd` prints `<address>`. A laptop first trusts
`https://<address>:9443/lan-proxy/root.crt`, or accepts each port's warning once.

Sign in with `ada`, the development password in
[`deploy/keycloak/alloy-realm.json`](../../deploy/keycloak/alloy-realm.json). Ada administers both
environments. The realm also holds `grace`, `ivy` and `alice`.

## 2. Add people

**One at a time**, in Keycloak's console: sign in as `admin` (the password is `KEYCLOAK_ADMIN_PASSWORD` in
`deploy/.env`, else the default in `deploy/compose.keycloak.yaml`) and switch to the realm `alloy`.

1. **Groups**, **Create group**, if the person needs a new one.
2. **Users**, **Create new user**: a username, an email, **Email verified** on, and **Join Groups** for their
   groups.
3. On the user's **Credentials** tab, **Set password**, with **Temporary** off.

**Several at once**, from a file such as this `people.json`. Every group needs its `path`, or Keycloak
answers with an unknown error:

```json
{
  "ifResourceExists": "SKIP",
  "groups": [{ "name": "editors", "path": "/editors" }],
  "users": [
    {
      "username": "mary",
      "email": "mary@example.com",
      "firstName": "Mary",
      "lastName": "Jackson",
      "enabled": true,
      "emailVerified": true,
      "groups": ["/editors"],
      "credentials": [{ "type": "password", "value": "choose-a-password", "temporary": false }]
    }
  ]
}
```

Import it from Command Prompt, not PowerShell, which has no `<`. In Git Bash, set `MSYS_NO_PATHCONV=1` first.
`9090` is `IDP_PORT`.

```bash
docker compose -f deploy/compose.yaml -f deploy/compose.keycloak.yaml exec keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:9090 --realm master --user admin --password <the admin password> --config /tmp/k
```

```bash
docker compose -f deploy/compose.yaml -f deploy/compose.keycloak.yaml exec -T keycloak /opt/keycloak/bin/kcadm.sh create partialImport -r alloy --config /tmp/k -o -f - < people.json
```

The answer lists each group and person as `ADDED` or `SKIPPED`. Anything you add this way or in the console
stays in the `alloy-works_keycloak-data` volume, across restarts.

Anybody in the realm can sign in, without an invitation, and holds nothing until given access. They appear
under **People** after their first sign-in. To give somebody access before that, invite their address under
**People** first; the address must be verified in Keycloak for them to claim it.

## 3. Give them access

Sign in as Ada. Each environment has its own groups, roles and grants: everything below is for the one you
are in.

**Make a role**, if none of the starting ones fits: **Administration**, **Roles**, **New role**, then choose
its permissions. A role cannot yet be changed or removed there, so name it for what it holds.

**Have a group follow Keycloak:** **Administration**, **Groups**, **New group**. Give it a name, and in
**Value from the organisation's sign-in** the Keycloak group's name exactly, such as `editors`. Whoever signs
in as a member of that Keycloak group joins, and leaves when they sign in no longer a member. A membership
changed in Keycloak takes effect at the person's next sign-in.

**Grant the role:** **Administration**, **Overview**, **Manage access**, for the whole environment. Under
**Give access** choose **A group** or **A person**, the role, **Allow** or **Deny**, then **Give**. A space's
access is under **Spaces**, and a component's or document's under **Manage access** on its page. Only an
administrator of the whole environment can give access to a group.

**See the result** without signing in as them: in the same Access panel, choose the person under **Whose
access** and **Show**. It lists every permission with its answer, and the level and grants that decided it.

A narrower role that keeps `administer` is no boundary: its holder can grant themselves Administrator. Test
limits with roles that do not hold it.

## 4. Sign in as somebody else

Sign out of Alloy Works, then sign in as the next person.

Keycloak keeps its own session for 15 seconds after a sign-in, and signing out of Alloy Works does not end it.
Within those 15 seconds Keycloak refuses anybody else: "You are already authenticated as different user". Wait
a moment, return to the application and sign in again.

To see two people side by side, use a private window or another browser profile for each.

## Starting again

To go back to the stand-in, leave Keycloak's file out and remove its containers, which would hold the port:

```bash
docker compose -f deploy/compose.yaml up -d --build --wait --remove-orphans
```

To drop everybody added and take a changed realm file, stop the stack and remove the volume:

```bash
docker compose -f deploy/compose.yaml -f deploy/compose.keycloak.yaml down
```

```bash
docker volume rm alloy-works_keycloak-data
```

Keep the same files on `down`, plus `deploy/compose.lan.yaml` if you used `BringUpDev.cmd`. That one needs
`ALLOY_LAN_ADDRESS` set, or `down` fails.
