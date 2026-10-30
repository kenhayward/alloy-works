# Receiving CT Studio's deliveries

> For the administrator of an Alloy Works environment who wants CT Studio to deliver into it. How to
> register the environment in CT Studio, give CT Studio a service identity to act as, tell the space
> what to make of what arrives, and read delivered data tables back. The design is
> [ct-studio-sink.md](../design/ct-studio-sink.md); this is the order to do things in.

CT Studio decomposes a source file and delivers the result to a **target** it holds. Alloy Works
answers as a sink at `/bridge` on its own address: a decomposed document becomes a document in a
space, and a data package becomes real PostgreSQL tables that a connection and an SQL query
definition read like any other source.

## What you need

- **An environment you administer**, and the hostname people reach it by. Alloy Works finds the
  environment from the hostname a request arrives at, so a sink is registered per environment.
- **Whoever runs CT Studio's bridge**, who edits its `BRIDGE_SINKS` and holds its connections.
- **A shared signing key** for the environment: chosen by the operator, set on the service as
  `SINK_BRIDGE_KEYS` (a comma-separated list, so a key can be replaced without a gap). Without it
  the service runs and `/bridge` is not served. For data tables the service and worker also need the
  delivery store (`SECRET_DELIVERED_URL`); [deploy/README.md](../../deploy/README.md) says how.

## The short way: Administration → CT Studio

Steps 2 to 4 below, and the `BRIDGE_SINKS` entry of step 1, are one flow in **Administration → CT
Studio** ([the design](../design/ct-studio-connect.md)). **Connect a space** chooses the space, makes
CT Studio's service identity the first time (or adopts one made by hand through the API, keeping the
token CT Studio already holds), grants it Author there, issues its token, takes the space's settings,
and ends on a page to copy from: the token, shown once, the `.env` entry with the key as a
placeholder, and what to do in CT Studio. A later space reuses the identity and its token, so only
the target is new. The section says when the token nears its end, offers a new one, replaces a
disabled identity, and grants a space again that lost its grant. Each space's **Settings** lists the
properties deliveries carried that its map does not name, to map or to ignore.

The steps below are the same thing through the API, and what each part is.

## 1. Register the environment in CT Studio

In the bridge's `BRIDGE_SINKS`, add **one entry per environment hostname**. The address is that
environment's own, ending `/bridge`, and the key is the one the service holds:

```text
sink id:   alloy-acme
address:   https://<environment host>/bridge
key:       <the shared signing key>
```

A second environment is a second entry with its own key; one environment's key never signs for
another. The bridge must be able to reach the hostname over https, as the bridge sees it: from a
bridge in a container, `127.0.0.1` and `localhost` are the container itself. On the development
stack that is the LAN proxy, `https://<ALLOY_LAN_ADDRESS>:8443/bridge`, with the proxy's root
(`https://<ALLOY_LAN_ADDRESS>:9443/lan-proxy/root.crt`) given to the bridge as `NODE_EXTRA_CA_CERTS`.

The key goes in the entry and nowhere else in CT Studio; the token of step 2 goes only in CT Studio's
connection, never in its `.env`.

## 2. Make a service identity and a token

CT Studio acts in Alloy Works as a **service identity**, never as a person, and a person's token is
refused. Signed in as an administrator:

1. Make a service identity (`POST /v1/service-identities`), named for what it is, for example
   "CT Studio deliveries".
2. Give it access: grant the identity the **Author** role (`read`, `create`, `edit`, `comment` and
   `suggest`) at each space CT Studio is to deliver into, with `POST /v1/grants`: the role's id, the
   identity as the `principal` of the subject, the level `space:<space id>` and the effect `allow`.
   The delivery needs `create` to make a document and `edit` to update one. The token below is only
   a mask over these grants, never more, and the job checks the grants again when it runs, so a grant
   removed after a delivery was accepted refuses it.
3. Issue it a token (`POST /v1/service-identities/{id}/tokens`) with the scopes `create` and `edit`
   and an expiry no more than 365 days away. The answer carries the `awt_` secret **once**; copy it
   straight to CT Studio.

In CT Studio, make a **shared connection** of this sink holding that token, and a **target** on the
connection naming the space. Test the connection: it answers with the identity and the environment
it reached. Note when the token expires, and issue a new one before it does.

## 3. Say what arrives as: the bridge settings

A space with no bridge settings refuses a delivery, `not_configured`. An administrator of the space
sets them with `PUT /v1/spaces/{space}/bridge-settings`:

```json
{
  "componentType": "<component type id, or null for the environment default>",
  "template": "<template id, or null for a blank document>",
  "propertyMap": { "<CT Studio property name>": "<template document field id>" },
  "data": false
}
```

- `componentType` is the type delivered components take.
- `template` is what delivered documents are made from. A document's fields come only from its
  template, so with none, every property CT Studio sends is kept with the delivery record and none
  fills a field.
- `propertyMap` names, per CT Studio property, the template field it fills. A value is converted to
  the field's data type; one that does not convert is left unset and reported in the delivery's
  result, and does not refuse the delivery. A `user` field is never filled: a name in a file is not
  a person here.
- `data` turns data tables on; see the next step.

`GET` on the same route reads the settings back. A refusal names each setting that is wrong, for
example `field_not_in_template` with the path `propertyMap.<property>`.

## 4. Turn data on

Set `"data": true` to deliver data packages to the space. The first time, this:

- makes the environment's schema in the delivery store (`t_<environment>`) and a read-only account
  for it;
- makes the space's **connection** to the store with that account's password sealed by the
  connector, so that no person, response or log ever sees it.

The settings answer carries `connection`, the connection's id. Turning data off stops new data
deliveries and keeps the connection and the tables. If the environment has no delivery store, or the
store does not answer, the route answers `delivery_store_unavailable` and nothing is changed.

**The schema is the environment's, not the space's.** Delivered rows carry no space. Every space of
the environment whose connection reads the schema sees every space's tables, whichever space they
were delivered to. A later delivery from the same source and recipe replaces that source's rows
wherever they came from, so a delivery to one space can replace rows another space received. Turn
data on for a space only where its people may see all of the environment's delivered data.

## 5. Deliver, and read what arrived

Deliver from CT Studio to the target. A delivery's result lists what was written: for a document,
the document; for a data package, each table, named `<table set>_<table id>` (and
`<table set>_fields` for the package's fields), made safe as PostgreSQL names. Every table also
carries provenance columns: `ct_source_sha256`, `ct_source_filename`, `ct_job_id`, `ct_recipe_id`,
`ct_recipe_version`, `ct_approved_by`, `ct_published_at` and `ct_row`. A later delivery of the same
source and recipe replaces its earlier rows and leaves other sources' alone.

To query the tables, sign in as somebody who may use the connection and write SQL in the space:

1. Open the connection the settings named. **Test** it first: a connection that has not been tested
   refuses Describe and Sample with `sql_not_permitted`, so the test is what lets the rest run.
   Then **Describe** lists the delivered tables.
2. Make a **query definition** in the space on that connection, with an SQL fetch such as
   `select * from "<table set>_<table id>"`, and declare its columns.
3. **Sample** it to see the rows.

A CT Studio number column is stored as an unconstrained `numeric`, so a value keeps all the digits
CT Studio sent. Describe proposes no type for such a column, since there is no precision or scale to
read from it: when you declare the query definition's columns, you choose the precision and scale
that suit the figures.

If a recipe changes, a new column is added to the table; a column the package no longer has is kept,
null in new rows. A column whose type changes is refused, `content_rejected` naming it, because
changing a column under queries that read it is a person's decision.

## Common refusals

| Answer                                         | Meaning                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `instance_not_allowed`                         | The hostname or environment is not one this sink serves           |
| `credential_rejected`                          | A bad, expired or person's token, or the identity lacks the grant |
| `not_configured`                               | The space has no bridge settings, or its data is off              |
| `name_conflict` with `details.field: tableSet` | Two tables would become one PostgreSQL name                       |
| `content_rejected`                             | A column's type changed, or a document's content is refused       |
