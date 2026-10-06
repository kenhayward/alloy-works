# Asserted identity on PostgreSQL

> For the administrator of a PostgreSQL database that Alloy Works reads. How to set the database up so
> a connection runs each person's queries as that person, so the database's own grants and row-level
> security decide what each sees; what Alloy Works checks every time; and what it trusts you for.

A connection normally runs every query as one account, so everybody sees the same rows. A connection
that **runs as each person** signs in as one account that may read nothing, then, at the start of
each query, switches to a role you made for the person asking (`set_config('role', ...)`, as
`SET LOCAL ROLE` does). What that role may see is what they see. Alloy Works makes nothing at your
database: you make the roles, and it checks them.

## What you need

- **PostgreSQL 14 or later.** 16 or later is simpler (step 3).
- **Somebody who can create roles** at the database, and who decides who may create functions, views
  and policies there (step 5).
- **How people sign in to Alloy Works**, which names their role: by **email** (the address they
  signed in with, which their provider has verified) or by **subject** (their identifier at your
  organisation's own sign-in; not offered to people who sign in with Google). Ask the environment's
  administrator which they will choose.

## 1. Make the account

The account the connection signs in as must **read nothing, own nothing and create nothing** itself:

```sql
create role asserter login noinherit password '<a password of your own>';
```

Grant it nothing else: no `SELECT` on any table, view, sequence or column, no membership of
`pg_read_all_data`, no ownership of any function, procedure or view, and no `CREATE` on any schema.
A grant to `PUBLIC` counts as a grant to it. Alloy Works checks this **before every query** and
refuses to run anything as anybody while the account holds any of it; a connection's **Test** says so
too.

## 2. Make a role for each person

Name the role exactly as the person's email or subject, case and all; PostgreSQL holds at most 63
bytes of a name, and somebody whose email or subject is longer cannot be run as.

```sql
create role "ada@example.com" nologin;
grant usage on schema sample to "ada@example.com";
grant select on sample.reading to "ada@example.com";
```

Each person's role must **not log in, create nothing in any schema or database, and own nothing** - no
table, view, function or procedure. Alloy Works checks this every time it runs as them, and refuses
otherwise: such a role could run SQL of its own that switches to somebody else's role.

## 3. Let the account act as each person, and nothing more

On PostgreSQL 16 or later:

```sql
grant "ada@example.com" to asserter with inherit false, set true;
```

On 14 and 15, where a grant has no such options, the account's `noinherit` (step 1) does the same:

```sql
grant "ada@example.com" to asserter;
```

Either way the account gains none of the person's privileges until it switches to them.

## 4. Decide what each person sees

Use the database's own tools: grants, and row-level security for rows. For example, each person
seeing only their own site's readings:

```sql
alter table sample.reading enable row level security;
create policy own_site on sample.reading for select to "ada@example.com", "grace@example.com"
  using (site = case current_user when 'ada@example.com' then 1 when 'grace@example.com' then 2 end);
```

Row-level security applies to every role but the table's owner and roles that bypass it, so give any
other account that reads the table a policy of its own (`using (true)` for one that reads every row).

## 5. The checklist

Alloy Works checks steps 1 and 2 at every query. It cannot check the rest, and **asserted identity
keeps one person's rows from another only where all of these hold**
([ADR-0040](../decisions/0040-asserted-identity-trusts-the-sources-function-authors.md)):

- [ ] **Each person's role is `NOLOGIN`, has no `CREATE` anywhere, and owns nothing.**
- [ ] **On PostgreSQL 14 and 15, `CREATE` on schema `public` is revoked from `PUBLIC`:**
      `revoke create on schema public from public;` (15 and later no longer grant it.)
- [ ] **Only roles you trust as much as yourself may create functions, views or policies.** A function
      anybody else writes, reached through a view a person's query reads, can switch to another
      person's role and read their rows, and nothing Alloy Works can see from the query tells it so.
- [ ] **A view over data people see is `security_invoker`, or owned by you.** A view otherwise runs
      with its owner's rights, so every person would see what its owner sees:
      `create view sample.mine with (security_invoker = true) as ...`.

The trust, plainly: **anybody who may create functions, views or policies at the database already
decides what each person sees through it.** Asserted identity adds no protection against them; it
protects people from each other, and from Alloy Works' own account, where they are trusted.

## 6. Make the connection

In Alloy Works, open **Connections**, make or open the connection, and set:

- **Account**: `asserter`, and its password under **Credential**.
- **Runs as**: _Each person, by the email they sign in with_, or _Each person, by their identifier at
  the organisation's sign-in_.

Then **Test** it. The test runs as the account, so it checks the account alone: _Connected._ with no
finding is what you want. Then **List tables**, which runs as you: the tables your own role may read.

## What people see

- **Only queries built in Alloy Works run as each person.** SQL written by hand is refused on the
  connection, when it is saved and every time it would run.
- **Resolving, checking, sampling and listing tables run as the person asking.** A connection's
  **Test** runs as the account.
- **A value fetched as a person is their own view**, and Alloy Works says whose. Before it is held in
  a document they are told that everybody who may read the document will see it, and that it prints
  in the publications made of it, and must agree. Nobody else may accept or check another person's
  own view.
- **Signing out, or revoking the token a query was asked with, stops it within two seconds**: Alloy
  Works closes the query at the database, records nothing, and says why.

## When it refuses

| What the person is told                                                            | What to change                                                                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| This connection's account can read data, create objects or owns functions or views | Step 1: take the grant, the ownership or the `CREATE` away from the account, or from `PUBLIC`                                             |
| Your role at the source can sign in, create objects or owns objects of its own     | Step 2: make the role `NOLOGIN`, take its `CREATE` away, and give what it owns to somebody else                                           |
| The source has no role for you that this connection may use                        | Steps 2 and 3: make the role, named exactly as they sign in, and grant it to the account                                                  |
| Your sign-in does not name you as this connection asks                             | Their provider sent no verified email, or the role would be over 63 bytes; or, by subject, they did not sign in through your organisation |
