# Setting up an organisation and making tenants

> For somebody running a development stack who wants to administer tenants from an organisation's console.
> How to reach the organisation that setup makes, share its sign-in, make a tenant and look after it. Starting
> Keycloak and adding people is in [the Keycloak guide](keycloak-and-people.md); closing a tenant is in
> [Closing an environment](closing-an-environment.md).

An organisation's own tenant holds no content. It is where the organisation's administrators see its other
tenants, suspend them and make new ones. Nothing inside those tenants can be reached from it.

## 1. Reach the organisation

Bring the stack up as usual ([deploy/README.md](../../deploy/README.md)). Its setup makes the organisation Acme
with three tenants, and needs nothing further:

| Tenant      | Address                          | Kind                   |
| ----------- | -------------------------------- | ---------------------- |
| Acme        | `http://org.acme.localhost:8088` | The organisation's own |
| Production  | `http://acme.localhost:8088`     | Content                |
| Development | `http://dev.acme.localhost:8088` | Content                |

Open `http://org.acme.localhost:8088` and sign in as `ada`. Under Keycloak the password is in
[`deploy/keycloak/alloy-realm.json`](../../deploy/keycloak/alloy-realm.json). On a stack with
`compose.lan.yaml`, sign-in goes through `https://<address>:9443`, so accept its certificate warning if it
appears.

Anybody else who signs in holds nothing and is told they need to be an organisation administrator. Of the
starting roles, **Administrator** can do everything below. **Organisation administrator** can do everything but
share a provider, which also needs `configure_services`.

## 2. Share a provider

A new tenant's first administrator has to sign in through something, so a tenant cannot be requested until a
provider is shared.

On the console, choose **Sign-in**, open the provider's **more** menu, and choose **Share with your tenants**. If
that is missing, sign out and in again: the menu needs a recent sign-in.

Each tenant gets a copy shortly, secret included, and each one made later gets one as it is made. A tenant can
close its copy but not edit it. **Stop sharing** leaves each copy open as that tenant's own to close, so it
cannot lock anybody out.

## 3. Allow the new tenant's address

Choose an address before making the tenant: lower-case letters, digits and hyphens, such as `test`. The provider
refuses a sign-in returning to an address it does not know.

**Under Keycloak**, add the callback to `deploy/.env`, separating several with commas:

```bash
ALLOY_EXTRA_REDIRECT_URIS=http://test.acme.localhost:8088/v1/sign-in/organisation/callback
```

Then bring the stack up again the way you first did, which gives Keycloak the new list. An address added in
Keycloak's console works only until the next start.

**Under the stand-in**, add the same callback to `STAND_IN_REDIRECT_URIS` in `deploy/compose.yaml`, or
`deploy/compose.lan.yaml` if you use that file, and bring the stack up again.

## 4. Make the tenant

On the console, under **New tenant**, give:

- **Name**, as its people will see it.
- **Address**, the one you chose. The organisation's suffix, `.acme.localhost`, is added for you.
- **First administrator's email address**. It must be an account the provider has, with a verified address, such
  as `grace@example.com` under Keycloak.

Choose **Create the tenant**. It shows under **Tenants being made**, then within about a minute under **Tenants**.

No email is sent. The first administrator opens the new address and signs in, which claims the invitation:
`http://test.acme.localhost:8088`, as `grace`, here in a private window so as not to disturb Ada's session.

New tenants answer on `*.acme.localhost` only, so only from the machine running the stack.

## 5. Look after a tenant

The **Tenants** table offers what the tenant's state allows:

| State           | On the console                                                                        |
| --------------- | ------------------------------------------------------------------------------------- |
| Active          | **Suspend**, with a reason. Every route refuses within 30 seconds                     |
| Suspended       | **Lift the suspension**, unless the operator suspended it: then only the operator can |
| Closing or Held | **Give up closing it**, unless the operator closed it: then only the operator can     |

Closing starts inside the tenant, from Administration's Export: see
[Closing an environment](closing-an-environment.md). An organisation's own tenant closes only after its tenants.

The console's **People**, **Groups**, **Roles**, **Sign-in**, **Audit log** and **Export** are the organisation
tenant's own.

## 6. When a request fails

"Could not be made. Ask the operator." means the steward's process gave up. See why:

```bash
docker compose -f deploy/compose.yaml logs steward-process
```

Find the tenant's id:

```bash
docker compose -f deploy/compose.yaml exec postgres psql -U postgres -d alloy_dev -c "select tenant_id, name, hostname from platform.tenant_request where state = 'failed'"
```

Put right what stopped it, then ask again. The first administrator's address went when the request failed, so give
it again:

```bash
docker compose -f deploy/compose.yaml run --rm steward retry --tenant <id> --first-administrator grace@example.com
```

Or give it up with `steward close`. On each `steward` command, name the same compose files you brought the stack
up with. Those shown here are the plain stack's.

## 7. Another organisation

Acme is the only organisation setup makes. The operator makes another with its own tenant and suffix:

```bash
docker compose -f deploy/compose.yaml run --rm steward organisation --id <id> --name <name> --tenant <new tenant id> --hostname <its address> --suffix <.what its tenants end in> --first-administrator <address> --google
```

It cannot be signed in to until it has a first way in. Wait for it to be made, then add its callback to your provider,
under Keycloak to `ALLOY_EXTRA_REDIRECT_URIS` as in section 3, and give the provider's client secret on standard input:

```bash
docker compose -f deploy/compose.yaml run --rm steward provider --tenant <new tenant id> --issuer <url> --client-id <id> --name <shown> < client-secret.txt
```

`<` is Command Prompt's and Git Bash's. PowerShell has none, so wrap the line there: `cmd /c "docker compose ... < client-secret.txt"`.

Name the same compose files you brought the stack up with, and delete the file afterwards. The first administrator
then signs in with a verified address, which claims the invitation. If that address was not verified, they have
signed in as nobody and no invitation reaches them: invite another with `--first-administrator <address>`.

The command works until somebody who signed in holds access there, so run it again to correct a mistake. It renews a
lapsed invitation with `--first-administrator <address>`. Once the tenant is in use, its sign-in is its own to change,
under **Sign-in**.

Or `--google` on `steward organisation`, which opens Google for that address's domain, so the first administrator can
sign in and add the organisation's own provider. Under Keycloak Google is not offered.
