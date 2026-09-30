export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Whether the service is up. Answers on any hostname
         * @description Use this check to see whether the service process answers requests. It does not test an environment or its dependencies.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The caller's own answer for every permission on a target
         * @description Ask whether the caller may perform each permission on a tenant, space or artifact target. The answer includes token scope restrictions when called with a token.
         */
        get: operations["getAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/access/explain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every permission a principal has on a target, and the grants and level behind each
         * @description For an administrator, explain each permission a named principal has on a target and the grants and levels behind the answer.
         */
        get: operations["explainAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/asset-uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * An upload the caller made: its state, and its asset version once ready
         * @description Reads the state of an upload the caller created and, once ingestion completes, the resulting asset version.
         */
        get: operations["getAssetUpload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/asset-uploads/{id}/bytes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Fill an upload with its image's bytes, which are checked before anything may place it
         * @description Sends the image bytes for an existing upload. Only PNG and JPEG images admitted by the ingest worker become assets.
         */
        put: operations["putAssetUploadBytes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/asset-versions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * An asset version's recorded properties
         * @description Reads the recorded properties of an asset version that the caller may access.
         */
        get: operations["getAssetVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/asset-versions/{id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * An asset version's image, as it was uploaded
         * @description Returns the stored image bytes of a readable asset version. Use the response media type as supplied.
         */
        get: operations["getAssetVersionContent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The components the caller may read, a page at a time
         * @description Lists only components the caller can read, in stable cursor pages. Send the returned next cursor to continue the same listing.
         */
        get: operations["listComponents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A component at its latest version, whether the caller may edit it, and its lock
         * @description Opens the latest component version with the caller’s editing permissions and current lock. Use its version when submitting a change.
         */
        get: operations["getComponent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components/{id}/iterations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The caller's own retained iterations of the component, newest first, while their session holds the lock
         * @description Lists the caller’s retained editing iterations while their session holds the component lock. Iterations are working saves, not released versions.
         */
        get: operations["listIterations"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components/{id}/iterations/{iteration}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * One of the caller's own retained iterations, content and values, while their session holds the lock
         * @description Reads one retained editing iteration, including its content and values. The caller must still hold the editing lock.
         */
        get: operations["getIteration"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components/{id}/iterations/{session}/{sequence}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Save the session's whole content as an iteration
         * @description Saves the complete component content for the named editing session and sequence. An editing lock and the version precondition still apply.
         */
        put: operations["saveIteration"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components/{id}/lock": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Claim the lock for an editing session, or move it to this one
         * @description Claims or moves the editing lock to the caller’s session. Another holder’s live lock is not overridden.
         */
        post: operations["claimLock"];
        /**
         * Done editing: cut a version of what changed, then release the lock
         * @description Finishes an editing session, cutting a version if its content changed, then releases the lock.
         */
        delete: operations["releaseLock"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/components/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A component's versions, newest first, a page at a time
         * @description Lists released component versions newest first using an opaque cursor. It does not include working iterations.
         */
        get: operations["listComponentVersions"];
        put?: never;
        /**
         * Save version: cut a version from the session's latest iteration
         * @description Cuts a released version from the editing session’s latest saved iteration. The component lock and version precondition apply.
         */
        post: operations["cutVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The connections the caller may read, each with its space and whether it is ready
         * @description Lists the connections the caller may read, with whether each has a credential and how its last test went.
         */
        get: operations["listConnections"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A connection at its latest version, whether its credential is set, and its last test
         * @description Returns the latest connection version, whether a credential is set and by whom and when, and its last test. The credential itself is never returned.
         */
        get: operations["getConnection"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/credential": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set or replace a connection's credential, then test the connection with it
         * @description Sets or replaces the connection credential, then tests the connection with it. The credential is sealed at once and never returned; this route takes no idempotency key.
         */
        put: operations["setConnectionCredential"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/describe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * List the tables and views a connection's account may read, or a SQL statement's result columns
         * @description Lists the tables and views the connection account may read, with each column and the type proposed for it. Sent a SQL statement instead, it answers the columns the statement would return, each with the type proposed for it, without running it; that needs write SQL on the connection as well, and a connection whose latest test found its account read-only.
         */
        post: operations["describeConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/sample": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Run a draft query definition against sample values, storing nothing
         * @description Runs a draft query definition against the sample values given, exactly as a document would run it, and stores nothing. Each value is checked against its declaration before the source is asked. It needs use connection and write SQL on the connection, and a connection whose latest test found its account read-only. A failure is an answer, named and laid at the connector, the query or the product.
         */
        post: operations["sampleConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Test a connection: whether it reaches its source and signs in, and what it found
         * @description Tests whether the connection reaches its source and signs in. A failure gives one reason, the same whatever went wrong, and every test is recorded.
         */
        post: operations["testConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/uses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Where a connection is used: the query definitions naming it
         * @description Lists the query definitions whose latest versions name the connection: those the caller may read by title, and a count of the rest.
         */
        get: operations["getConnectionUses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/connections/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cut a connection's next version from the one the caller opened; retiring among them
         * @description Records the next connection version from the version the caller opened. Retiring and reinstating a connection are versions too.
         */
        post: operations["recordConnectionVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/definitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every field, metadata schema and component type at its latest version
         * @description Lists current field, metadata schema and component type definitions. A later version can change the current shape.
         */
        get: operations["listDefinitions"];
        put?: never;
        /**
         * Make a field, a metadata schema or a component type, at version 0.1
         * @description Creates one definition at version 0.1. Its kind determines which field, schema or component type structure is required.
         */
        post: operations["createDefinition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/definitions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A definition at its latest version
         * @description Returns the current version of a definition so it can be read or used as a precondition for an update.
         */
        get: operations["getDefinition"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/definitions/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cut a definition's next version from the one the caller opened
         * @description Records the next definition version based on the version the caller opened.
         */
        post: operations["recordDefinitionVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The documents the caller may read, a page at a time
         * @description Lists documents the caller can read with stable cursor paging, filters and facets.
         */
        get: operations["listDocuments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A document at its latest version, and whether the caller may restructure it
         * @description Returns the latest document version, including its outline and whether the caller can restructure it.
         */
        get: operations["getDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/contributions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What each occurrence of the latest version contributes, as the caller is shown it
         * @description Shows what each occurrence contributes to the current document, subject to the caller’s readable set.
         */
        get: operations["getContributions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/numbering": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The latest version's numbering, as the caller is shown it
         * @description Returns current section, figure, table and equation numbering using the document’s publishing layout.
         */
        get: operations["getNumbering"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/outline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Apply one operation to the outline, as one version
         * @description Applies one outline operation and records one new document version. Supply the version that was read to avoid overwriting concurrent work.
         */
        post: operations["editOutline"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/presentation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The theme and layout a document is published under, which its text is shown in
         * @description Returns the theme and layout used to publish this document so a reader can present its text consistently.
         */
        get: operations["getDocumentPresentation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Preview the latest version of this document as a PDF, kept an hour for the caller
         * @description Queues a short-lived PDF preview of the latest document version for the caller. Follow the returned request to completion.
         */
        post: operations["requestPreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/publications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The document's publications the caller may read, a page at a time
         * @description Lists the readable publications of one document in stable cursor pages.
         */
        get: operations["listPublications"];
        put?: never;
        /**
         * Publish the latest version of this document
         * @description Queues publication of a named document version in the requested output formats. A worker produces the outputs asynchronously.
         */
        post: operations["requestPublication"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/texts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The text of every component the latest version places, as the caller is shown it
         * @description Reads the text of components placed by the latest document version, filtered by what the caller may read.
         */
        get: operations["getDocumentTexts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/documents/{id}/values": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Write the document's own values, whole, as one version with the outline unchanged
         * @description Replaces the document’s own values as one version while leaving its outline unchanged. Supply the version previously read.
         */
        put: operations["recordDocumentValues"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The grants made at one level, a page at a time
         * @description Lists access grants at one level using an opaque cursor.
         */
        get: operations["listGrants"];
        put?: never;
        /**
         * Grant a role to a person or a group at one level, as an allow or a denial
         * @description Grants or denies a role to a person or group at the selected level. The resulting access decision takes effect on the next request.
         */
        post: operations["makeGrant"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/grants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remove a grant, unless it is the last that keeps this environment administered
         * @description Removes a grant unless it is needed to keep the environment administered.
         */
        delete: operations["removeGrant"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/groups": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every group, with its members, a page at a time
         * @description Lists the environment’s groups and their members in cursor pages.
         */
        get: operations["listGroups"];
        put?: never;
        /**
         * Make a group: the environment's own, or one standing for a value the provider asserts
         * @description Creates a local group or a group representing a value asserted by the identity provider.
         */
        post: operations["createGroup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/groups/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete a group, with its memberships and every grant it holds
         * @description Deletes a group together with its memberships and grants. This changes access immediately.
         */
        delete: operations["deleteGroup"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/groups/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Set the members of one of the environment's own groups
         * @description Replaces the members of a local group with the given set. Provider-backed membership is managed at sign-in instead.
         */
        put: operations["setGroupMembers"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every invitation, waiting or accepted, a page at a time
         * @description Lists waiting and accepted invitations in stable cursor pages.
         */
        get: operations["listInvitations"];
        put?: never;
        /**
         * Invite an address, so the person can be granted access before they first sign in
         * @description Invites an address so access can be granted before the person first signs in.
         */
        post: operations["invite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invitations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Withdraw an invitation nobody has accepted, with its person and their grants
         * @description Withdraws an unaccepted invitation and removes the principal and grants created for it.
         */
        delete: operations["withdrawInvitation"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Who is signed in, and to which environment
         * @description Returns the person represented by the supplied personal token or signed-in session and the environment in which that credential was issued.
         */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The environment's people, by name, for a user field
         * @description Lists people in the environment by name for a user selection field.
         */
        get: operations["listPeople"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/presentation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The environment's theme and layout, which a component on its own is shown in
         * @description Returns the environment’s default presentation used for a component outside a document.
         */
        get: operations["getPresentation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/principals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The people a grant can name: everybody who has signed in or been invited
         * @description Lists people already signed in or invited who may be named by an access grant.
         */
        get: operations["listPrincipals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/principals/{id}/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A person's tokens, a page at a time, never their secrets: an administrator's
         * @description For an environment administrator, lists another person’s tokens without revealing their secrets.
         */
        get: operations["listPrincipalTokens"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/principals/{id}/tokens/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a person's token, as an administrator: the next request with it is refused
         * @description For an environment administrator, revokes a person’s token. The next request with it is refused.
         */
        delete: operations["revokePrincipalToken"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/publication-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A publish or a preview the caller asked for: its state, every failure, and its publication once made, or its PDF while it lasts
         * @description Polls a publish or preview request for its state, failure and completed result. A preview PDF expires after its retention period.
         */
        get: operations["getPublicationRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/publications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Every publication the caller may read, of every document, a page at a time
         * @description Lists all publications the caller may read across documents and spaces.
         */
        get: operations["listPublicationsEverywhere"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/publications/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A publication: its record, and a link to each output
         * @description Returns a completed publication’s immutable record and links to its outputs.
         */
        get: operations["getPublication"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/query-definitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The query definitions the caller may read, each with its space and connection
         * @description Lists the query definitions the caller may read, with the space and connection of each, filtered by space or connection.
         */
        get: operations["listQueryDefinitions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/query-definitions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A query definition at its latest version, with the connection it names
         * @description Returns the latest query definition version, the connection it names, and whether the caller may change it or run it.
         */
        get: operations["getQueryDefinition"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/query-definitions/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cut a query definition's next version from the one the caller opened; retiring among them
         * @description Records the next query definition version from the version the caller opened. Retiring and reinstating a definition are versions too; a retiring version is accepted whatever the connection last found.
         */
        post: operations["recordQueryDefinitionVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The roles a grant can name, with what each holds, a page at a time
         * @description Lists roles available to grants and the permissions each role holds.
         */
        get: operations["listRoles"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/samples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Ask for a sample PDF of this environment, which a worker makes
         * @description Development scaffolding: queues a sample PDF for the signed-in session. Personal API tokens cannot submit this job.
         */
        post: operations["requestSample"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/samples/{sampleId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * How a sample is coming along, and where to fetch it
         * @description Development scaffolding: polls a sample PDF request until a download is ready.
         */
        get: operations["getSample"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Everything the caller may read that holds these words, a page at a time
         * @description Searches only content the caller may read, with facets and stable cursor paging.
         */
        get: operations["search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/data": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The environment's lowered limits on a query's rows, bytes and seconds
         * @description Reads the limits the environment sets on a query run, each lowered or not, and the ceilings no definition may pass.
         */
        get: operations["getDataSettings"];
        /**
         * Lower, or stop lowering, the environment's limits on a query
         * @description Lowers, or stops lowering, the environment limits on the rows, bytes and seconds of a query run. A run takes the least of its definition limits and these.
         */
        put: operations["setDataSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/editing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The environment's editing settings: how long saved changes are kept
         * @description Reads the environment’s editing settings, including how long saved changes are retained.
         */
        get: operations["getEditingSettings"];
        /**
         * Change the environment's editing settings
         * @description Changes the environment’s editing settings. Existing saved changes follow the new policy.
         */
        put: operations["setEditingSettings"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sign-in/google": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Begin signing in with a Google account, by way of the one sign-in address
         * @description Browser sign-in route. Redirects through the product’s shared Google sign-in address.
         */
        get: operations["startGoogleSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sign-in/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Where Google returns, at the sign-in address only; hands the sign-in to its environment
         * @description Google callback at the shared sign-in address. It hands a one-time code to the environment that started the flow.
         */
        get: operations["finishGoogleSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sign-in/google/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Redeems the one-time code from the sign-in address, and signs in
         * @description Redeems a one-time code at the environment hostname and creates a signed-in browser session.
         */
        get: operations["completeGoogleSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sign-in/organisation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Begin signing in with the organisation's identity provider
         * @description Browser sign-in route. Redirects to the organisation’s identity provider; an API token cannot complete this flow.
         */
        get: operations["startOrganisationSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sign-in/organisation/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Where the identity provider returns; completes the sign-in
         * @description Browser callback for the organisation’s identity provider. The browser’s sign-in attempt and returned state must match.
         */
        get: operations["finishOrganisationSignIn"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/sign-out": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * End this session, wherever it is in use
         * @description Ends the current browser session wherever it is in use. A personal API token cannot sign out a session.
         */
        post: operations["signOut"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The spaces the caller may read, and whether they may create a component in each
         * @description Lists spaces the caller can read and whether they may create a component in each.
         */
        get: operations["listSpaces"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/asset-uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make an upload in this space, with the description its image will carry
         * @description Starts an image upload in a space and records its description or decorative status. Upload bytes separately to finish it.
         */
        post: operations["createAssetUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/component-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The component types a component created here may take, with the default marked
         * @description Lists component types usable for a new component in this space, marking the default.
         */
        get: operations["listComponentTypes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/components": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a component in this space, at version 0.1
         * @description Creates a component in the named space at its first version. The caller needs permission to create there.
         */
        post: operations["createComponent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/connections": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make a connection in this space, at version 0.1
         * @description Creates a connection to a PostgreSQL source in the named space. It holds no credential until one is set.
         */
        post: operations["createConnection"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a document in this space, at version 0.1: an empty outline, or its template's starting one
         * @description Creates a document at version 0.1 in the named space, either empty or from a template’s starting outline.
         */
        post: operations["createDocument"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/query-definitions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make a query definition in this space, at version 0.1
         * @description Creates a query definition in the named space from a whole definition: SQL with named parameters, the columns it returns, a key, an order, whether no rows is valid, and its limits. It needs edit in the space and use connection and write SQL on the connection it names.
         */
        post: operations["createQueryDefinition"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/spaces/{space}/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Make a template in this space, at version 0.1
         * @description Creates a template in the named space at its first version.
         */
        post: operations["createTemplate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * What is happening in this environment, as it happens
         * @description Opens a browser-session-only event stream with a snapshot and subsequent changes. See the separate realtime protocol for event meanings and delivery guarantees.
         */
        get: operations["openStream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The templates the caller may read, each with its name, space and latest version
         * @description Lists readable templates with their name, space and latest version.
         */
        get: operations["listTemplates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * A template at its latest version
         * @description Opens the current template version and its starting document structure.
         */
        get: operations["getTemplate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/templates/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cut a template's next version from the one the caller opened
         * @description Records a new template version based on the version the caller opened.
         */
        post: operations["recordTemplateVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tenant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The environment this address serves, as its sign-in page shows it
         * @description Returns the environment selected by the request hostname. Check this before using a token or making a change, especially when you have both production and sandbox environments.
         */
        get: operations["getTenant"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The caller's own tokens, a page at a time, never their secrets
         * @description Lists the caller’s own personal tokens and their expiry and last use. Token secrets are never returned by a listing.
         */
        get: operations["listTokens"];
        put?: never;
        /**
         * Issue the caller a token that acts as them, masked to its scopes, until it expires
         * @description Issues a personal token with explicit permission scopes and an expiry. The secret appears once in this response and cannot be recovered later.
         */
        post: operations["createToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tokens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke one of the caller's own tokens: the next request with it is refused
         * @description Revokes one of the caller’s personal tokens. The next request presenting it is refused.
         */
        delete: operations["revokeToken"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        createTemplateBody_schema0: {
            key: string;
            title: ({
                /** @constant */
                type: "text";
                value: string;
                /** @default [] */
                marks: ({
                    /** @constant */
                    type: "emphasis";
                    id: string;
                } | {
                    /** @constant */
                    type: "strong";
                    id: string;
                } | {
                    /** @constant */
                    type: "underline";
                    id: string;
                } | {
                    /** @constant */
                    type: "subscript";
                    id: string;
                } | {
                    /** @constant */
                    type: "superscript";
                    id: string;
                } | {
                    /** @constant */
                    type: "inlineCode";
                    id: string;
                } | {
                    /** @constant */
                    type: "quotedPhrase";
                    id: string;
                } | {
                    /** @constant */
                    type: "definedTerm";
                    id: string;
                    term: string;
                } | {
                    /** @constant */
                    type: "condition";
                    id: string;
                    axis: string;
                    values: string[];
                } | {
                    /** @constant */
                    type: "suggestion";
                    id: string;
                    /** @enum {string} */
                    operation: "insert" | "delete" | "replace";
                    author: string;
                } | {
                    /** @constant */
                    type: "comment";
                    id: string;
                    threadId: string;
                } | {
                    /** @constant */
                    type: "hyperlink";
                    id: string;
                    href: string;
                    title?: string;
                } | {
                    /** @constant */
                    type: "language";
                    id: string;
                    tag: string;
                })[];
            } | {
                /** @constant */
                type: "equation";
                mathml: string;
                latex?: string;
            } | {
                /** @constant */
                type: "footnote";
                id: string;
                anchor: {
                    /** @constant */
                    kind: "span";
                } | {
                    /** @constant */
                    kind: "cell";
                    key: string;
                } | {
                    /** @constant */
                    kind: "cellPosition";
                    row: number;
                    column: number;
                } | {
                    /** @constant */
                    kind: "table";
                };
                content: unknown[];
            } | {
                /** @constant */
                type: "crossReference";
                id: string;
                target: {
                    /** @constant */
                    kind: "block";
                    block: string;
                } | {
                    /** @constant */
                    kind: "component";
                    component: string;
                    block: string;
                } | {
                    /** @constant */
                    kind: "node";
                    node: string;
                };
                /** @enum {string} */
                display: "number" | "title" | "numberAndTitle" | "page" | "relative";
                /** @enum {string} */
                withoutPages?: "number" | "title" | "numberAndTitle";
            } | {
                /** @constant */
                type: "citation";
                entry: string;
                locator?: string;
            } | {
                /** @constant */
                type: "variable";
                name: string;
            } | {
                /** @constant */
                type: "binding";
                query: string;
            } | {
                /** @constant */
                type: "image";
                asset: string;
                imageStyle: string;
                alternative: {
                    /** @constant */
                    kind: "own";
                    text: string;
                } | {
                    /** @constant */
                    kind: "inherited";
                } | {
                    /** @constant */
                    kind: "decorative";
                };
            })[];
            required: boolean;
            numbered: boolean;
            /** @enum {string} */
            matter: "front" | "body" | "appendix";
            /** @enum {string} */
            pageBreak: "none" | "page" | "recto";
            children: components["schemas"]["createTemplateBody_schema0"][];
        };
        recordTemplateVersionBody_schema0: {
            key: string;
            title: ({
                /** @constant */
                type: "text";
                value: string;
                /** @default [] */
                marks: ({
                    /** @constant */
                    type: "emphasis";
                    id: string;
                } | {
                    /** @constant */
                    type: "strong";
                    id: string;
                } | {
                    /** @constant */
                    type: "underline";
                    id: string;
                } | {
                    /** @constant */
                    type: "subscript";
                    id: string;
                } | {
                    /** @constant */
                    type: "superscript";
                    id: string;
                } | {
                    /** @constant */
                    type: "inlineCode";
                    id: string;
                } | {
                    /** @constant */
                    type: "quotedPhrase";
                    id: string;
                } | {
                    /** @constant */
                    type: "definedTerm";
                    id: string;
                    term: string;
                } | {
                    /** @constant */
                    type: "condition";
                    id: string;
                    axis: string;
                    values: string[];
                } | {
                    /** @constant */
                    type: "suggestion";
                    id: string;
                    /** @enum {string} */
                    operation: "insert" | "delete" | "replace";
                    author: string;
                } | {
                    /** @constant */
                    type: "comment";
                    id: string;
                    threadId: string;
                } | {
                    /** @constant */
                    type: "hyperlink";
                    id: string;
                    href: string;
                    title?: string;
                } | {
                    /** @constant */
                    type: "language";
                    id: string;
                    tag: string;
                })[];
            } | {
                /** @constant */
                type: "equation";
                mathml: string;
                latex?: string;
            } | {
                /** @constant */
                type: "footnote";
                id: string;
                anchor: {
                    /** @constant */
                    kind: "span";
                } | {
                    /** @constant */
                    kind: "cell";
                    key: string;
                } | {
                    /** @constant */
                    kind: "cellPosition";
                    row: number;
                    column: number;
                } | {
                    /** @constant */
                    kind: "table";
                };
                content: unknown[];
            } | {
                /** @constant */
                type: "crossReference";
                id: string;
                target: {
                    /** @constant */
                    kind: "block";
                    block: string;
                } | {
                    /** @constant */
                    kind: "component";
                    component: string;
                    block: string;
                } | {
                    /** @constant */
                    kind: "node";
                    node: string;
                };
                /** @enum {string} */
                display: "number" | "title" | "numberAndTitle" | "page" | "relative";
                /** @enum {string} */
                withoutPages?: "number" | "title" | "numberAndTitle";
            } | {
                /** @constant */
                type: "citation";
                entry: string;
                locator?: string;
            } | {
                /** @constant */
                type: "variable";
                name: string;
            } | {
                /** @constant */
                type: "binding";
                query: string;
            } | {
                /** @constant */
                type: "image";
                asset: string;
                imageStyle: string;
                alternative: {
                    /** @constant */
                    kind: "own";
                    text: string;
                } | {
                    /** @constant */
                    kind: "inherited";
                } | {
                    /** @constant */
                    kind: "decorative";
                };
            })[];
            required: boolean;
            numbered: boolean;
            /** @enum {string} */
            matter: "front" | "body" | "appendix";
            /** @enum {string} */
            pageBreak: "none" | "page" | "recto";
            children: components["schemas"]["recordTemplateVersionBody_schema0"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The service is up */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "status": "ok"
                     *     }
                     */
                    "application/json": {
                        /** @constant */
                        status: "ok";
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getAccess: {
        parameters: {
            query: {
                target: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every permission, allowed or not */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "target": "example",
                     *       "permissions": []
                     *     }
                     */
                    "application/json": {
                        target: string;
                        permissions: {
                            /** @enum {string} */
                            permission: "read" | "create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql";
                            allowed: boolean;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may address the target but lacks the permission this needs */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such target in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    explainAccess: {
        parameters: {
            query: {
                principal: string;
                target: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every permission, with its explanation */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "principal": "example",
                     *       "target": "example",
                     *       "permissions": []
                     *     }
                     */
                    "application/json": {
                        principal: string;
                        target: string;
                        permissions: {
                            /** @enum {string} */
                            permission: "read" | "create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql";
                            allowed: boolean;
                            /**
                             * @description capped: an external principal, refused whatever the grants say. scoped: allowed by the grants, and refused to the API token a request was made with, which is not scoped to it
                             * @enum {string}
                             */
                            reason: "allowed" | "denied" | "not_granted" | "capped" | "scoped";
                            /** @description The level that decided, or null when none said anything */
                            level: string | null;
                            /** @description Every level looked at, nearest first */
                            checked: string[];
                            /** @description The grants that decided, at the deciding level */
                            grants: {
                                id: string;
                                role: string;
                                /** @enum {string} */
                                effect: "allow" | "deny";
                                subject: {
                                    principal: string;
                                } | {
                                    group: string;
                                };
                                /** @description The group it reached the principal through */
                                through: string | null;
                                /** @description The name of the group the grant was made to, which is the group it came through; null for a grant made to the principal */
                                groupName: string | null;
                                expiresAt: string | null;
                            }[];
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may address the target but lacks the permission this needs */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such target in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getAssetUpload: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The upload */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": "example",
                     *       "state": "awaiting",
                     *       "reason": "not_permitted",
                     *       "assetVersion": "example"
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: string;
                        /**
                         * @description `awaiting` its bytes; `checking` them; `ready`, with its asset version; or `refused`, with why. Nothing can place an upload that is not ready
                         * @enum {string}
                         */
                        state: "awaiting" | "checking" | "ready" | "refused";
                        /** @description Why it was refused, once refused */
                        reason: ("not_permitted" | "too_large" | "too_many_pixels" | "malformed" | "undecodable" | "unchecked") | null;
                        /** @description The asset version it made, once ready */
                        assetVersion: string | null;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such upload, or one somebody else made */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    putAssetUploadBytes: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            /** @description The upload, checking */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": "example",
                     *       "state": "awaiting",
                     *       "reason": "not_permitted",
                     *       "assetVersion": "example"
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: string;
                        /**
                         * @description `awaiting` its bytes; `checking` them; `ready`, with its asset version; or `refused`, with why. Nothing can place an upload that is not ready
                         * @enum {string}
                         */
                        state: "awaiting" | "checking" | "ready" | "refused";
                        /** @description Why it was refused, once refused */
                        reason: ("not_permitted" | "too_large" | "too_many_pixels" | "malformed" | "undecodable" | "unchecked") | null;
                        /** @description The asset version it made, once ready */
                        assetVersion: string | null;
                    };
                };
            };
            /** @description `asset_format_not_permitted`: not a PNG or a JPEG, read from its bytes; `asset_unreadable`: its structure is not what its format permits. The upload is refused */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such upload, or one somebody else made */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `asset_upload_filled`: the upload already has its bytes */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `asset_too_large`: more pixels than an image may have, which refuses the upload; or more bytes, read no further, which leaves it awaiting a smaller file */
            413: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `asset_bytes_expected`: the body is not application/octet-stream. Nothing is read, and the upload still awaits its bytes */
            415: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getAssetVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The asset version */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "asset": "example",
                     *       "number": "example",
                     *       "format": "png",
                     *       "bytes": -9007199254740991,
                     *       "width": -9007199254740991,
                     *       "height": -9007199254740991,
                     *       "resolution": 0,
                     *       "alternative": {
                     *         "text": "example",
                     *         "language": "en"
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        asset: string;
                        number: string;
                        /** @enum {string} */
                        format: "png" | "jpeg";
                        bytes: number;
                        /** @description In pixels, as the image is displayed */
                        width: number;
                        /** @description In pixels, as the image is displayed */
                        height: number;
                        /** @description Dots per inch the file declares, or null for none */
                        resolution: number | null;
                        /** @description The default description a figure inherits, or null for none */
                        alternative: {
                            text: string;
                            language: string;
                        } | null;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: an asset the caller may read is one they may open */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such thing in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getAssetVersionContent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The bytes, never sniffed and never run: a version never changes, so they may be kept for a year */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "image/png": string;
                    "image/jpeg": string;
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: an asset the caller may read is one they may open */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such thing in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listComponents: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                types?: string;
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of components */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "spaces": [],
                     *       "facets": {
                     *         "spaces": [],
                     *         "types": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            title: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            /** @description `revision.version` of the latest version */
                            version: string;
                            /** @description The component type it was written against, by name; null for none */
                            type: string | null;
                            /** @description Its base language, a BCP 47 tag */
                            language: string;
                            /** @description When its latest version was made */
                            changedAt: string;
                            /** @description Who made its latest version; null for a version nobody authored */
                            changedBy: {
                                id: string;
                                name: string | null;
                            } | null;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Every space the caller may read a component in, with how many: what to filter by */
                        spaces: {
                            id: string;
                            name: string;
                            count: number;
                        }[];
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                            types: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, a limit outside 1 to 100, or spaces that are not a list of ids */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getComponent: {
        parameters: {
            query?: {
                session?: string & (unknown & unknown);
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The component */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "content": {},
                     *       "mayEdit": false,
                     *       "lock": {
                     *         "holder": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "expectedRelease": "example",
                     *         "yours": false,
                     *         "session": "example"
                     *       },
                     *       "unsaved": {
                     *         "savedAt": "example"
                     *       },
                     *       "sequence": -9007199254740991,
                     *       "type": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "fields": [],
                     *       "schemas": [],
                     *       "values": {}
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's content document (content-model.md), exactly as stored */
                        content: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may take the lock and write */
                        mayEdit: boolean;
                        lock: {
                            holder: {
                                id: string;
                                name: string | null;
                            };
                            /** @description When it lapses unless the holder saves again */
                            expectedRelease: string;
                            /** @description Whether the caller holds it, from this session or another */
                            yours: boolean;
                            /** @description The holding session, told only to its own principal */
                            session: string | null;
                        } | null;
                        /** @description The caller's own newest iteration opened from the latest version, work saved and never made a version, by its time alone; null where there is none */
                        unsaved: {
                            /** @description When the service accepted it */
                            savedAt: string;
                        } | null;
                        /** @description The latest sequence the service has accepted from the editing session the `session` query names, the caller's own; null where none is named or it has saved none */
                        sequence: number | null;
                        /** @description The component type its latest version records, at the current version */
                        type: {
                            id: string;
                            name: string;
                        };
                        /** @description Its fields at the current definitions of its type, in resolution order: what its next version is written against */
                        fields: {
                            id: string;
                            name: string;
                            dataType: string;
                            /** @enum {string} */
                            multiplicity: "one" | "many";
                            maxValues?: number;
                            validation: {
                                [key: string]: unknown;
                            };
                            required: boolean;
                            /** @description Every schema that makes it required, by identifier */
                            requiredBy: string[];
                            fixed: boolean;
                            /** @description Every schema that fixes it, by identifier */
                            fixedBy: string[];
                            /** @description Absent where no schema gives one */
                            default?: unknown;
                        }[];
                        /** @description The schemas its type assigns, by name, for naming which require or fix a field */
                        schemas: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The latest version's values, by field identifier */
                        values: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description A session that is not a lowercase uuid */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a component the caller may read is one they may open */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listIterations: {
        parameters: {
            query: {
                session: string & (unknown & unknown);
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of iterations, with no content */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description Newest first, with no content (RC-E) */
                        items: {
                            id: string;
                            /** @description The editing session that wrote it, one of the caller's own */
                            session: string;
                            sequence: number;
                            /** @description When the service accepted it */
                            createdAt: string;
                            /** @description The version the session that wrote it had opened */
                            openedFrom: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                            };
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the component but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description lock_held or lock_required: the session named does not hold the lock */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getIteration: {
        parameters: {
            query: {
                session: string & (unknown & unknown);
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
                iteration: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The iteration, whole */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "session": "example",
                     *       "sequence": -9007199254740991,
                     *       "createdAt": "example",
                     *       "openedFrom": {
                     *         "id": "example",
                     *         "number": "example"
                     *       },
                     *       "content": {},
                     *       "values": {}
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @description The editing session that wrote it, one of the caller's own */
                        session: string;
                        sequence: number;
                        /** @description When the service accepted it */
                        createdAt: string;
                        /** @description The version the session that wrote it had opened */
                        openedFrom: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                        };
                        /** @description The whole content document, as stored: migrated and validated by its reader */
                        content: {
                            [key: string]: unknown;
                        };
                        /** @description The component's values it was saved with */
                        values: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the component but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component or iteration, or one that is not the caller's own or is no longer kept */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description lock_held or lock_required: the session named does not hold the lock */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    saveIteration: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
                session: string & (unknown & unknown);
                sequence: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "content": {}
                 *     }
                 */
                "application/json": {
                    /** @description The version the session opened from, which must be the latest */
                    openedFrom: string & (unknown & unknown);
                    /** @description The whole content document */
                    content: {
                        [key: string]: unknown;
                    };
                    /** @description The component's values, whole, by field identifier; absent keeps those of the version opened from */
                    values?: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Accepted, and the lock extended */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "sequence": 0,
                     *       "lock": {
                     *         "holder": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "expectedRelease": "example",
                     *         "yours": false,
                     *         "session": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        sequence: number;
                        lock: {
                            holder: {
                                id: string;
                                name: string | null;
                            };
                            /** @description When it lapses unless the holder saves again */
                            expectedRelease: string;
                            /** @description Whether the caller holds it, from this session or another */
                            yours: boolean;
                            /** @description The holding session, told only to its own principal */
                            session: string | null;
                        };
                    };
                };
            };
            /** @description `content_invalid`: the content is not a document the model accepts; `values_invalid`: a fixed value changed, a value of the wrong type, or a user this environment does not hold */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the component but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description lock_held, lock_required, version_precondition, iteration_stale or iteration_conflict */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    claimLock: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "session": "00000000-0000-4000-8000-000000000001"
                 *     }
                 */
                "application/json": {
                    session: string & (unknown & unknown);
                    /** @description Continue here: move a lock this principal holds elsewhere */
                    move?: boolean;
                };
            };
        };
        responses: {
            /** @description Claimed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "lock": {
                     *         "holder": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "expectedRelease": "example",
                     *         "yours": false,
                     *         "session": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        lock: {
                            holder: {
                                id: string;
                                name: string | null;
                            };
                            /** @description When it lapses unless the holder saves again */
                            expectedRelease: string;
                            /** @description Whether the caller holds it, from this session or another */
                            yours: boolean;
                            /** @description The holding session, told only to its own principal */
                            session: string | null;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the component but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description lock_held, lock_required, version_precondition, iteration_stale or iteration_conflict */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    releaseLock: {
        parameters: {
            query: {
                session: string & (unknown & unknown);
                openedFrom: string & (unknown & unknown);
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Released, with the version cut or the latest */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "outcome": "cut",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        /**
                         * @description unchanged: nothing differed from the latest version, which is not an error
                         * @enum {string}
                         */
                        outcome: "cut" | "unchanged";
                        /** @description The version cut, or the latest when nothing was */
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                    };
                };
            };
            /** @description `values_invalid`: a fixed value differs from its default at the cut */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the component but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description lock_held, lock_required, version_precondition, iteration_stale or iteration_conflict */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listComponentVersions: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of its versions, newest first */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            createdAt: string;
                            /** @description Who made it; null for a version nobody authored */
                            author: {
                                id: string;
                                name: string | null;
                            } | null;
                            note: string | null;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a component the caller may read is one whose versions they may read */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    cutVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "session": "00000000-0000-4000-8000-000000000001",
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001"
                 *     }
                 */
                "application/json": {
                    session: string & (unknown & unknown);
                    openedFrom: string & (unknown & unknown);
                    note?: string;
                };
            };
        };
        responses: {
            /** @description Cut, or nothing to cut */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "outcome": "cut",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        /**
                         * @description unchanged: nothing differed from the latest version, which is not an error
                         * @enum {string}
                         */
                        outcome: "cut" | "unchanged";
                        /** @description The version cut, or the latest when nothing was */
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                    };
                };
            };
            /** @description `values_invalid`: a fixed value differs from its default at the cut */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the component but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such component in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description lock_held, lock_required, version_precondition, iteration_stale or iteration_conflict */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        holder?: {
                            id: string;
                            name: string | null;
                        };
                        expectedRelease?: string;
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                        /** @description values_invalid: each value that cannot be stored with the component, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listConnections: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "name" | "changed";
                order?: "asc" | "desc";
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of connections */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "facets": {
                     *         "spaces": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            /** @enum {string} */
                            type: "postgres";
                            retired: boolean;
                            version: {
                                id: string;
                                number: string;
                            };
                            /** @description Whether a credential is set for where the connection now signs in */
                            credentialSet: boolean;
                            lastTest: {
                                /** @enum {string} */
                                outcome: "ok" | "failed";
                                at: string;
                                /** @description The version it tested, which need not be the latest */
                                version: string;
                                /** @description Whether it was made with the credential set now */
                                credentialCurrent: boolean;
                            } | null;
                            /** @description When its latest version was made */
                            changedAt: string;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getConnection: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The connection */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "settings": {
                     *         "schemaVersion": 1,
                     *         "name": "example",
                     *         "description": "example",
                     *         "type": "postgres",
                     *         "source": {
                     *           "host": "example",
                     *           "port": 1,
                     *           "database": "example",
                     *           "account": "example",
                     *           "tls": "require"
                     *         },
                     *         "identity": {
                     *           "kind": "service"
                     *         },
                     *         "retired": false
                     *       },
                     *       "credential": {
                     *         "set": false
                     *       },
                     *       "lastTest": {
                     *         "outcome": "ok",
                     *         "findings": [],
                     *         "at": "example",
                     *         "by": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "version": "example",
                     *         "credentialCurrent": false
                     *       },
                     *       "mayAdminister": false,
                     *       "mayUse": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        settings: {
                            /** @constant */
                            schemaVersion: 1;
                            name: string;
                            description: string;
                            /** @constant */
                            type: "postgres";
                            source: {
                                host: string;
                                port: number;
                                database: string;
                                account: string;
                                /** @enum {string} */
                                tls: "require" | "verifyFull";
                            };
                            identity: {
                                /** @constant */
                                kind: "service";
                            } | {
                                /** @constant */
                                kind: "endUser";
                                /** @constant */
                                mechanism: "delegated";
                                tokenEndpoint: string;
                                audience: string;
                            } | {
                                /** @constant */
                                kind: "endUser";
                                /** @constant */
                                mechanism: "asserted";
                                /** @enum {string} */
                                attribute: "email" | "subject";
                                /** @enum {string} */
                                assertion?: "sessionContext" | "executeAs";
                            };
                            retired: boolean;
                        };
                        credential: {
                            /** @constant */
                            set: false;
                        } | {
                            /** @constant */
                            set: true;
                            setBy: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            setAt: string;
                            /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                            targetChanged: boolean;
                            /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                            setBeforeBinding: boolean;
                        };
                        lastTest: {
                            /** @enum {string} */
                            outcome: "ok" | "failed";
                            findings: "account_not_read_only"[];
                            failure?: {
                                /** @description Stable and machine-readable */
                                code: string;
                                /**
                                 * @description Whose failure it is: the source's side, the query's author, or the product
                                 * @enum {string}
                                 */
                                attribution: "connector" | "query" | "product";
                                message: string;
                                /** @description What the source said, where it refused the statement: `source_refused` alone */
                                source?: {
                                    /** @description The source's five-character SQLSTATE */
                                    sqlstate: string;
                                    /** @description The source's own message, cut to 1,000 characters */
                                    message: string;
                                };
                                /** @description The column the failure names, where it names one */
                                column?: string;
                                /** @description The row the failure names, counted from 1 */
                                row?: number;
                            };
                            at: string;
                            by: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            /** @description The connection version it tested */
                            version: string;
                            /** @description Whether it was made with the credential set now; a test of an earlier credential says nothing of this one */
                            credentialCurrent: boolean;
                        } | null;
                        /** @description Whether the caller may change it and set its credential */
                        mayAdminister: boolean;
                        /** @description Whether the caller may test it and list its tables */
                        mayUse: boolean;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a connection the caller may not read is not found */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    setConnectionCredential: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "secret": "example"
                 *     }
                 */
                "application/json": {
                    /** @description The credential, a password for a PostgreSQL source. Never answered by any route */
                    secret: string;
                };
            };
        };
        responses: {
            /** @description Set: who set it and when, never the credential, and the test run straight after */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "credential": {
                     *         "set": false
                     *       },
                     *       "test": {
                     *         "outcome": "ok",
                     *         "findings": [],
                     *         "at": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        credential: {
                            /** @constant */
                            set: false;
                        } | {
                            /** @constant */
                            set: true;
                            setBy: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            setAt: string;
                            /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                            targetChanged: boolean;
                            /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                            setBeforeBinding: boolean;
                        };
                        test: {
                            /** @constant */
                            outcome: "ok";
                            /** @description What the test found of the account once it had signed in */
                            findings: "account_not_read_only"[];
                            at: string;
                        } | {
                            /** @constant */
                            outcome: "failed";
                            failure: {
                                /** @description Stable and machine-readable */
                                code: string;
                                /**
                                 * @description Whose failure it is: the source's side, the query's author, or the product
                                 * @enum {string}
                                 */
                                attribution: "connector" | "query" | "product";
                                message: string;
                                /** @description What the source said, where it refused the statement: `source_refused` alone */
                                source?: {
                                    /** @description The source's five-character SQLSTATE */
                                    sqlstate: string;
                                    /** @description The source's own message, cut to 1,000 characters */
                                    message: string;
                                };
                                /** @description The column the failure names, where it names one */
                                column?: string;
                                /** @description The row the failure names, counted from 1 */
                                row?: number;
                            };
                            at: string;
                        };
                        /** @description Where the test failed, the query definitions naming the connection, which cannot run until it passes */
                        dependents?: {
                            readable: {
                                id: string;
                                title: string;
                                retired: boolean;
                            }[];
                            /** @description How many more name it that the caller may not read */
                            others: number;
                        };
                    };
                };
            };
            /** @description The credential is empty, longer than 4,096 bytes, or holds U+0000 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the connection but may not administer it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `connection_retired`: a retired connection takes none */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description `connector_unavailable`: no connector is configured or it did not answer; `connector_busy`: it is full */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    describeConnection: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /** @example {} */
                "application/json": {
                    /** @description A statement to describe instead of the source's tables and views: its result's columns, never run */
                    sql?: {
                        text: string;
                        parameters: {
                            name: string;
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                            required: boolean;
                            list: boolean;
                            permitted?: {
                                values: (string | boolean | null)[];
                            } | {
                                minimum?: string | boolean | null;
                                maximum?: string | boolean | null;
                            };
                            variation?: {
                                key: string;
                                sql: string;
                            }[];
                        }[];
                    };
                };
            };
        };
        responses: {
            /** @description The source's tables and views, or, where a statement was sent, its result's columns */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "relations": [],
                     *       "truncated": false,
                     *       "leftOut": {
                     *         "relations": -9007199254740991,
                     *         "columns": -9007199254740991
                     *       }
                     *     }
                     */
                    "application/json": {
                        relations: {
                            schema: string;
                            name: string;
                            /** @enum {string} */
                            kind: "table" | "view" | "materializedView" | "foreignTable" | "partitionedTable";
                            columns: {
                                name: string;
                                sourceType: string;
                                nullable: boolean;
                                /** @description The column type the source proposes, or null where the author must declare one */
                                proposed: {
                                    [key: string]: unknown;
                                } | null;
                            }[];
                        }[];
                        /** @description Whether the list was cut short: past 2,000 relations, or before the answer would pass its size budget */
                        truncated: boolean;
                        /** @description How many relations, and columns of the relations listed, were left out because their names hold a control character or their types are longer than any PostgreSQL names */
                        leftOut: {
                            relations: number;
                            columns: number;
                        };
                    } | {
                        columns: {
                            name: string;
                            /** @description The source's own name for the column's type */
                            sourceType: string;
                            /** @description The column type proposed for it, or null where the author must declare one */
                            proposed: ({
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            }) | null;
                        }[];
                        /** @description Each parameter's type as the source reads it, in the order they are bound */
                        parameters: string[];
                    };
                };
            };
            /** @description `definition_invalid`: the statement does not lex whole or names a parameter it does not declare; `source_refused`: the source refused the statement, with what it said; `result_mismatch`: it has no columns to describe */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        problems?: ({
                            /** @constant */
                            rule: "definition_invalid";
                            /** @description The member refused, dotted, as `columns.2.name` */
                            path: string;
                            message: string;
                        } | {
                            parameter: string;
                            /** @enum {string} */
                            rule: "required" | "type" | "permitted" | "range" | "list" | "precision" | "scale" | "zone" | "variation";
                            /** @description The value as sent, cut to 1,000 characters */
                            value: string;
                        })[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the connection but may not use it, or, for a statement, may not write SQL against it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `connection_retired`: a retired connection runs nothing; `credential_missing`: no credential is set; `credential_target_changed`: the host, port, database, account or TLS changed after the credential was set, or it was set before credentials were bound to a target, so the password must be set again; `sql_not_permitted`: for a statement, the connection has not been tested clean at its latest version and credential (`untested`), or its account was found able to write (`not_read_only`) */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        /** @enum {string} */
                        reason?: "untested" | "not_read_only";
                    };
                };
            };
            /** @description `connection_failed`: the source could not be reached or signed in to; `connector_error`: the connector failed; `source_unsupported`: the source is older than PostgreSQL 14 */
            502: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description `connector_unavailable`: no connector is configured or it did not answer; `connector_busy`: it is full */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description `timeout`: the source did not answer in time */
            504: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    sampleConnection: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "definition": {
                 *         "schemaVersion": 1,
                 *         "connection": "00000000-0000-4000-8000-000000000001",
                 *         "parameters": [],
                 *         "fetch": {
                 *           "kind": "sql",
                 *           "text": "example"
                 *         },
                 *         "columns": [
                 *           {
                 *             "name": "example",
                 *             "from": {
                 *               "column": "example"
                 *             },
                 *             "type": {
                 *               "base": "text"
                 *             }
                 *           }
                 *         ],
                 *         "key": [],
                 *         "order": "multiset",
                 *         "empty": "valid",
                 *         "limits": {
                 *           "rows": 1,
                 *           "bytes": 1,
                 *           "seconds": 1
                 *         }
                 *       },
                 *       "values": {}
                 *     }
                 */
                "application/json": {
                    definition: {
                        /** @constant */
                        schemaVersion: 1;
                        /** Format: uuid */
                        connection: string;
                        parameters: {
                            name: string;
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                            required: boolean;
                            list: boolean;
                            permitted?: {
                                values: (string | boolean | null)[];
                            } | {
                                minimum?: string | boolean | null;
                                maximum?: string | boolean | null;
                            };
                            variation?: {
                                key: string;
                                sql: string;
                            }[];
                        }[];
                        fetch: {
                            /** @constant */
                            kind: "sql";
                            text: string;
                        };
                        columns: {
                            name: string;
                            from: {
                                column: string;
                            };
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                        }[];
                        key: string[];
                        order: "multiset" | {
                            column: string;
                            /** @enum {string} */
                            direction: "ascending" | "descending";
                        }[];
                        /** @enum {string} */
                        empty: "valid" | "invalid";
                        limits: {
                            rows: number;
                            bytes: number;
                            seconds: number;
                        };
                    };
                    /** @description Each parameter's value by name, in its type's canonical form, or a list of them for a list parameter */
                    values: {
                        [key: string]: (string | boolean | null) | (string | boolean | null)[];
                    };
                };
            };
        };
        responses: {
            /** @description Run: the first 100 rows, how many there were, the checksum and the SQL that ran, or one named failure with its attribution */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "outcome": "ok",
                     *       "columns": [],
                     *       "rows": [],
                     *       "rowCount": -9007199254740991,
                     *       "checksum": "example",
                     *       "ran": {
                     *         "sql": "example"
                     *       },
                     *       "durationMs": -9007199254740991
                     *     }
                     */
                    "application/json": {
                        /** @constant */
                        outcome: "ok";
                        /** @description Each column's name and its type's base */
                        columns: [
                            string,
                            string
                        ][];
                        /** @description The first 100 rows, each value in its canonical form */
                        rows: (string | boolean | null)[][];
                        /** @description How many rows the whole result holds */
                        rowCount: number;
                        /** @description The SHA-256 of the whole result in canonical form, in hexadecimal */
                        checksum: string;
                        ran: {
                            /** @description The SQL that ran, each value a bound parameter */
                            sql: string;
                        };
                        durationMs: number;
                    } | {
                        /** @constant */
                        outcome: "failed";
                        failure: {
                            /** @description Stable and machine-readable */
                            code: string;
                            /**
                             * @description Whose failure it is: the source's side, the query's author, or the product
                             * @enum {string}
                             */
                            attribution: "connector" | "query" | "product";
                            message: string;
                            /** @description What the source said, where it refused the statement: `source_refused` alone */
                            source?: {
                                /** @description The source's five-character SQLSTATE */
                                sqlstate: string;
                                /** @description The source's own message, cut to 1,000 characters */
                                message: string;
                            };
                            /** @description The column the failure names, where it names one */
                            column?: string;
                            /** @description The row the failure names, counted from 1 */
                            row?: number;
                        };
                    };
                };
            };
            /** @description `definition_invalid`: the draft fails a rule, each problem named, or is for another connection; `parameter_invalid`: a value fails its declaration, each named with the parameter, the rule and the value */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        problems?: ({
                            /** @constant */
                            rule: "definition_invalid";
                            /** @description The member refused, dotted, as `columns.2.name` */
                            path: string;
                            message: string;
                        } | {
                            parameter: string;
                            /** @enum {string} */
                            rule: "required" | "type" | "permitted" | "range" | "list" | "precision" | "scale" | "zone" | "variation";
                            /** @description The value as sent, cut to 1,000 characters */
                            value: string;
                        })[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the connection but may not use it or write SQL against it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `connection_retired`: a retired connection runs nothing; `credential_missing`: no credential is set; `credential_target_changed`: the host, port, database, account or TLS changed after the credential was set, or it was set before credentials were bound to a target, so the password must be set again; `sql_not_permitted`: for a statement, the connection has not been tested clean at its latest version and credential (`untested`), or its account was found able to write (`not_read_only`) */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        /** @enum {string} */
                        reason?: "untested" | "not_read_only";
                    };
                };
            };
            /** @description `connector_unavailable`: no connector is configured or it did not answer; `connector_busy`: it is full */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    testConnection: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /** @example {} */
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description Tested, and recorded against the version tested: ok with its findings, or one reason */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "outcome": "ok",
                     *       "findings": [],
                     *       "at": "example"
                     *     }
                     */
                    "application/json": {
                        /** @constant */
                        outcome: "ok";
                        /** @description What the test found of the account once it had signed in */
                        findings: "account_not_read_only"[];
                        at: string;
                    } | {
                        /** @constant */
                        outcome: "failed";
                        failure: {
                            /** @description Stable and machine-readable */
                            code: string;
                            /**
                             * @description Whose failure it is: the source's side, the query's author, or the product
                             * @enum {string}
                             */
                            attribution: "connector" | "query" | "product";
                            message: string;
                            /** @description What the source said, where it refused the statement: `source_refused` alone */
                            source?: {
                                /** @description The source's five-character SQLSTATE */
                                sqlstate: string;
                                /** @description The source's own message, cut to 1,000 characters */
                                message: string;
                            };
                            /** @description The column the failure names, where it names one */
                            column?: string;
                            /** @description The row the failure names, counted from 1 */
                            row?: number;
                        };
                        at: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the connection but may not use it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `connection_retired`: a retired connection runs nothing; `credential_missing`: no credential is set; `credential_target_changed`: the host, port, database, account or TLS changed after the credential was set, or it was set before credentials were bound to a target, so the password must be set again */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description `connector_unavailable`: no connector is configured or it did not answer; `connector_busy`: it is full */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getConnectionUses: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The query definitions whose latest versions name it: those the caller may read, and how many more */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "definitions": {
                     *         "readable": [],
                     *         "others": -9007199254740991
                     *       }
                     *     }
                     */
                    "application/json": {
                        definitions: {
                            readable: {
                                id: string;
                                title: string;
                                retired: boolean;
                            }[];
                            /** @description How many more name it that the caller may not read */
                            others: number;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a connection the caller may not read is not found */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    recordConnectionVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "settings": {
                 *         "schemaVersion": 1,
                 *         "name": "example",
                 *         "description": "example",
                 *         "type": "postgres",
                 *         "source": {
                 *           "host": "example",
                 *           "port": 1,
                 *           "database": "example",
                 *           "account": "example",
                 *           "tls": "require"
                 *         },
                 *         "identity": {
                 *           "kind": "service"
                 *         },
                 *         "retired": false
                 *       }
                 *     }
                 */
                "application/json": {
                    openedFrom: string & (unknown & unknown);
                    settings: {
                        /** @constant */
                        schemaVersion: 1;
                        name: string;
                        description: string;
                        /** @constant */
                        type: "postgres";
                        source: {
                            host: string;
                            port: number;
                            database: string;
                            account: string;
                            /** @enum {string} */
                            tls: "require" | "verifyFull";
                        };
                        identity: {
                            /** @constant */
                            kind: "service";
                        } | {
                            /** @constant */
                            kind: "endUser";
                            /** @constant */
                            mechanism: "delegated";
                            tokenEndpoint: string;
                            audience: string;
                        } | {
                            /** @constant */
                            kind: "endUser";
                            /** @constant */
                            mechanism: "asserted";
                            /** @enum {string} */
                            attribute: "email" | "subject";
                            /** @enum {string} */
                            assertion?: "sessionContext" | "executeAs";
                        };
                        retired: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description The connection at its latest version: the one cut, or the one before where nothing changed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "settings": {
                     *         "schemaVersion": 1,
                     *         "name": "example",
                     *         "description": "example",
                     *         "type": "postgres",
                     *         "source": {
                     *           "host": "example",
                     *           "port": 1,
                     *           "database": "example",
                     *           "account": "example",
                     *           "tls": "require"
                     *         },
                     *         "identity": {
                     *           "kind": "service"
                     *         },
                     *         "retired": false
                     *       },
                     *       "credential": {
                     *         "set": false
                     *       },
                     *       "lastTest": {
                     *         "outcome": "ok",
                     *         "findings": [],
                     *         "at": "example",
                     *         "by": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "version": "example",
                     *         "credentialCurrent": false
                     *       },
                     *       "mayAdminister": false,
                     *       "mayUse": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        settings: {
                            /** @constant */
                            schemaVersion: 1;
                            name: string;
                            description: string;
                            /** @constant */
                            type: "postgres";
                            source: {
                                host: string;
                                port: number;
                                database: string;
                                account: string;
                                /** @enum {string} */
                                tls: "require" | "verifyFull";
                            };
                            identity: {
                                /** @constant */
                                kind: "service";
                            } | {
                                /** @constant */
                                kind: "endUser";
                                /** @constant */
                                mechanism: "delegated";
                                tokenEndpoint: string;
                                audience: string;
                            } | {
                                /** @constant */
                                kind: "endUser";
                                /** @constant */
                                mechanism: "asserted";
                                /** @enum {string} */
                                attribute: "email" | "subject";
                                /** @enum {string} */
                                assertion?: "sessionContext" | "executeAs";
                            };
                            retired: boolean;
                        };
                        credential: {
                            /** @constant */
                            set: false;
                        } | {
                            /** @constant */
                            set: true;
                            setBy: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            setAt: string;
                            /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                            targetChanged: boolean;
                            /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                            setBeforeBinding: boolean;
                        };
                        lastTest: {
                            /** @enum {string} */
                            outcome: "ok" | "failed";
                            findings: "account_not_read_only"[];
                            failure?: {
                                /** @description Stable and machine-readable */
                                code: string;
                                /**
                                 * @description Whose failure it is: the source's side, the query's author, or the product
                                 * @enum {string}
                                 */
                                attribution: "connector" | "query" | "product";
                                message: string;
                                /** @description What the source said, where it refused the statement: `source_refused` alone */
                                source?: {
                                    /** @description The source's five-character SQLSTATE */
                                    sqlstate: string;
                                    /** @description The source's own message, cut to 1,000 characters */
                                    message: string;
                                };
                                /** @description The column the failure names, where it names one */
                                column?: string;
                                /** @description The row the failure names, counted from 1 */
                                row?: number;
                            };
                            at: string;
                            by: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            /** @description The connection version it tested */
                            version: string;
                            /** @description Whether it was made with the credential set now; a test of an earlier credential says nothing of this one */
                            credentialCurrent: boolean;
                        } | null;
                        /** @description Whether the caller may change it and set its credential */
                        mayAdminister: boolean;
                        /** @description Whether the caller may test it and list its tables */
                        mayUse: boolean;
                    };
                };
            };
            /** @description `connection_invalid` or `identity_not_supported`: the settings are refused by rule, each problem named */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        problems?: {
                            /** @enum {string} */
                            rule: "connection_invalid" | "identity_not_supported";
                            path?: string;
                            message?: string;
                            type?: string;
                            mechanism?: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            settings: {
                                /** @constant */
                                schemaVersion: 1;
                                name: string;
                                description: string;
                                /** @constant */
                                type: "postgres";
                                source: {
                                    host: string;
                                    port: number;
                                    database: string;
                                    account: string;
                                    /** @enum {string} */
                                    tls: "require" | "verifyFull";
                                };
                                identity: {
                                    /** @constant */
                                    kind: "service";
                                } | {
                                    /** @constant */
                                    kind: "endUser";
                                    /** @constant */
                                    mechanism: "delegated";
                                    tokenEndpoint: string;
                                    audience: string;
                                } | {
                                    /** @constant */
                                    kind: "endUser";
                                    /** @constant */
                                    mechanism: "asserted";
                                    /** @enum {string} */
                                    attribute: "email" | "subject";
                                    /** @enum {string} */
                                    assertion?: "sessionContext" | "executeAs";
                                };
                                retired: boolean;
                            };
                            credential: {
                                /** @constant */
                                set: false;
                            } | {
                                /** @constant */
                                set: true;
                                setBy: {
                                    id: string;
                                    /** @description Their name, or their address where they have none */
                                    name: string | null;
                                };
                                setAt: string;
                                /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                                targetChanged: boolean;
                                /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                                setBeforeBinding: boolean;
                            };
                            lastTest: {
                                /** @enum {string} */
                                outcome: "ok" | "failed";
                                findings: "account_not_read_only"[];
                                failure?: {
                                    /** @description Stable and machine-readable */
                                    code: string;
                                    /**
                                     * @description Whose failure it is: the source's side, the query's author, or the product
                                     * @enum {string}
                                     */
                                    attribution: "connector" | "query" | "product";
                                    message: string;
                                    /** @description What the source said, where it refused the statement: `source_refused` alone */
                                    source?: {
                                        /** @description The source's five-character SQLSTATE */
                                        sqlstate: string;
                                        /** @description The source's own message, cut to 1,000 characters */
                                        message: string;
                                    };
                                    /** @description The column the failure names, where it names one */
                                    column?: string;
                                    /** @description The row the failure names, counted from 1 */
                                    row?: number;
                                };
                                at: string;
                                by: {
                                    id: string;
                                    /** @description Their name, or their address where they have none */
                                    name: string | null;
                                };
                                /** @description The connection version it tested */
                                version: string;
                                /** @description Whether it was made with the credential set now; a test of an earlier credential says nothing of this one */
                                credentialCurrent: boolean;
                            } | null;
                            /** @description Whether the caller may change it and set its credential */
                            mayAdminister: boolean;
                            /** @description Whether the caller may test it and list its tables */
                            mayUse: boolean;
                        };
                        /** @description Where retiring is refused, the query definitions still naming the connection that are not retired */
                        definitions?: {
                            readable: {
                                id: string;
                                title: string;
                                retired: boolean;
                            }[];
                            /** @description How many more name it that the caller may not read */
                            others: number;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the connection but may not administer it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such connection in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `version_precondition`: the connection has a newer version than the one named; `connection_in_use`: a version retiring it is refused while a query definition that is not retired names it, those the caller may read named and the rest counted */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        problems?: {
                            /** @enum {string} */
                            rule: "connection_invalid" | "identity_not_supported";
                            path?: string;
                            message?: string;
                            type?: string;
                            mechanism?: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            settings: {
                                /** @constant */
                                schemaVersion: 1;
                                name: string;
                                description: string;
                                /** @constant */
                                type: "postgres";
                                source: {
                                    host: string;
                                    port: number;
                                    database: string;
                                    account: string;
                                    /** @enum {string} */
                                    tls: "require" | "verifyFull";
                                };
                                identity: {
                                    /** @constant */
                                    kind: "service";
                                } | {
                                    /** @constant */
                                    kind: "endUser";
                                    /** @constant */
                                    mechanism: "delegated";
                                    tokenEndpoint: string;
                                    audience: string;
                                } | {
                                    /** @constant */
                                    kind: "endUser";
                                    /** @constant */
                                    mechanism: "asserted";
                                    /** @enum {string} */
                                    attribute: "email" | "subject";
                                    /** @enum {string} */
                                    assertion?: "sessionContext" | "executeAs";
                                };
                                retired: boolean;
                            };
                            credential: {
                                /** @constant */
                                set: false;
                            } | {
                                /** @constant */
                                set: true;
                                setBy: {
                                    id: string;
                                    /** @description Their name, or their address where they have none */
                                    name: string | null;
                                };
                                setAt: string;
                                /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                                targetChanged: boolean;
                                /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                                setBeforeBinding: boolean;
                            };
                            lastTest: {
                                /** @enum {string} */
                                outcome: "ok" | "failed";
                                findings: "account_not_read_only"[];
                                failure?: {
                                    /** @description Stable and machine-readable */
                                    code: string;
                                    /**
                                     * @description Whose failure it is: the source's side, the query's author, or the product
                                     * @enum {string}
                                     */
                                    attribution: "connector" | "query" | "product";
                                    message: string;
                                    /** @description What the source said, where it refused the statement: `source_refused` alone */
                                    source?: {
                                        /** @description The source's five-character SQLSTATE */
                                        sqlstate: string;
                                        /** @description The source's own message, cut to 1,000 characters */
                                        message: string;
                                    };
                                    /** @description The column the failure names, where it names one */
                                    column?: string;
                                    /** @description The row the failure names, counted from 1 */
                                    row?: number;
                                };
                                at: string;
                                by: {
                                    id: string;
                                    /** @description Their name, or their address where they have none */
                                    name: string | null;
                                };
                                /** @description The connection version it tested */
                                version: string;
                                /** @description Whether it was made with the credential set now; a test of an earlier credential says nothing of this one */
                                credentialCurrent: boolean;
                            } | null;
                            /** @description Whether the caller may change it and set its credential */
                            mayAdminister: boolean;
                            /** @description Whether the caller may test it and list its tables */
                            mayUse: boolean;
                        };
                        /** @description Where retiring is refused, the query definitions still naming the connection that are not retired */
                        definitions?: {
                            readable: {
                                id: string;
                                title: string;
                                retired: boolean;
                            }[];
                            /** @description How many more name it that the caller may not read */
                            others: number;
                        };
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listDefinitions: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the definitions, by name */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            /** @enum {string} */
                            kind: "field" | "metadataSchema" | "componentType";
                            name: string;
                            version: {
                                id: string;
                                number: string;
                            };
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not read the environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createDefinition: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "kind": "field",
                 *       "definition": {
                 *         "schemaVersion": 1,
                 *         "name": "Study number",
                 *         "dataType": "text",
                 *         "multiplicity": "one",
                 *         "validation": {}
                 *       }
                 *     }
                 */
                "application/json": {
                    /** @enum {string} */
                    kind: "field" | "metadataSchema" | "componentType";
                    definition: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Made, at version 0.1 */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "kind": "field",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {}
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        kind: "field" | "metadataSchema" | "componentType";
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's payload (metadata.md, "Definitions"), as stored */
                        definition: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description `definition_unresolved`, `definition_invalid`, `definition_name_taken` (MET-031), `assignment_conflict` (MET-008), `schema_conflict` (MET-040) or `field_breaks_default` (MET-037); or `invalid_request`, a payload that is not a definition of its kind */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description definition_unresolved: what it names that is not there */
                        missing?: string[];
                        /** @description definition_unresolved, definition_invalid and assignment_conflict: each failure in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description definition_name_taken: the definition of its kind holding the name */
                        holder?: {
                            id: string;
                            name: string;
                        };
                        /** @description schema_conflict: each field, the schema beside it and every place the two meet */
                        conflicts?: {
                            field: string;
                            other: string;
                            places: {
                                [key: string]: unknown;
                            }[];
                        }[];
                        /** @description field_breaks_default: each schema whose default the field's next version refuses */
                        broken?: {
                            schema: string;
                            default: unknown;
                            rule: string;
                            detail: string;
                        }[];
                        /** @description version_precondition: the definition as it now stands */
                        current?: {
                            id: string;
                            /** @enum {string} */
                            kind: "field" | "metadataSchema" | "componentType";
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's payload (metadata.md, "Definitions"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not manage definitions */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getDefinition: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The definition */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "kind": "field",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {}
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        kind: "field" | "metadataSchema" | "componentType";
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's payload (metadata.md, "Definitions"), as stored */
                        definition: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a definition the caller may not read is not found */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such definition in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    recordDefinitionVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "definition": {}
                 *     }
                 */
                "application/json": {
                    openedFrom: string & (unknown & unknown);
                    definition: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description The definition at its latest version: the one cut, or the one before where nothing changed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "kind": "field",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {}
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        kind: "field" | "metadataSchema" | "componentType";
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's payload (metadata.md, "Definitions"), as stored */
                        definition: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description `definition_unresolved`, `definition_invalid`, `definition_name_taken` (MET-031), `assignment_conflict` (MET-008), `schema_conflict` (MET-040) or `field_breaks_default` (MET-037); or `invalid_request`, a payload that is not a definition of its kind */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description definition_unresolved: what it names that is not there */
                        missing?: string[];
                        /** @description definition_unresolved, definition_invalid and assignment_conflict: each failure in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description definition_name_taken: the definition of its kind holding the name */
                        holder?: {
                            id: string;
                            name: string;
                        };
                        /** @description schema_conflict: each field, the schema beside it and every place the two meet */
                        conflicts?: {
                            field: string;
                            other: string;
                            places: {
                                [key: string]: unknown;
                            }[];
                        }[];
                        /** @description field_breaks_default: each schema whose default the field's next version refuses */
                        broken?: {
                            schema: string;
                            default: unknown;
                            rule: string;
                            detail: string;
                        }[];
                        /** @description version_precondition: the definition as it now stands */
                        current?: {
                            id: string;
                            /** @enum {string} */
                            kind: "field" | "metadataSchema" | "componentType";
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's payload (metadata.md, "Definitions"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the definition but not manage it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such definition in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `version_precondition`: the definition has a newer version than the one named */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description definition_unresolved: what it names that is not there */
                        missing?: string[];
                        /** @description definition_unresolved, definition_invalid and assignment_conflict: each failure in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description definition_name_taken: the definition of its kind holding the name */
                        holder?: {
                            id: string;
                            name: string;
                        };
                        /** @description schema_conflict: each field, the schema beside it and every place the two meet */
                        conflicts?: {
                            field: string;
                            other: string;
                            places: {
                                [key: string]: unknown;
                            }[];
                        }[];
                        /** @description field_breaks_default: each schema whose default the field's next version refuses */
                        broken?: {
                            schema: string;
                            default: unknown;
                            rule: string;
                            detail: string;
                        }[];
                        /** @description version_precondition: the definition as it now stands */
                        current?: {
                            id: string;
                            /** @enum {string} */
                            kind: "field" | "metadataSchema" | "componentType";
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's payload (metadata.md, "Definitions"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listDocuments: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                spaces?: string;
                publishing?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of documents */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "facets": {
                     *         "spaces": [],
                     *         "publishing": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            title: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            /** @description `revision.version` of the latest version */
                            version: string;
                            /** @description When its latest version was made */
                            changedAt: string;
                            /** @description The sections in its latest outline, at every depth */
                            sections: number;
                            /** @description The component references in its latest outline, at every depth */
                            components: number;
                            /**
                             * @description Whether the latest publication the caller may read is of the latest version, an earlier one, or there is none they may read
                             * @enum {string}
                             */
                            publishing: "published" | "changedSince" | "neverPublished";
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                            publishing: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The document */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "outline": {},
                     *       "values": {},
                     *       "fields": {
                     *         "document": [],
                     *         "section": []
                     *       },
                     *       "schemas": [],
                     *       "template": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         }
                     *       },
                     *       "mayEdit": false,
                     *       "mayPublish": false,
                     *       "layout": {
                     *         "id": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         },
                     *         "language": "en",
                     *         "scheme": {},
                     *         "words": {},
                     *         "formats": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                        values: {
                            [key: string]: unknown;
                        };
                        /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                        fields: {
                            document: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                            section: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                        };
                        /** @description The schemas behind those fields, by name, for naming which require or fix one */
                        schemas: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                        template: {
                            id: string;
                            name: string;
                            version: {
                                id: string;
                                number: string;
                            };
                        } | null;
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                        layout: {
                            id: string;
                            version: {
                                id: string;
                                number: string;
                            };
                            language: string;
                            /** @description The numbering scheme this document is numbered and published with */
                            scheme: {
                                [key: string]: unknown;
                            };
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                            words: {
                                [key: string]: unknown;
                            };
                            /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                            formats: string[];
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one they may open */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getContributions: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Each occurrence and its contributions */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "document": "example",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example"
                     *       },
                     *       "occurrences": [],
                     *       "versions": []
                     *     }
                     */
                    "application/json": {
                        document: string;
                        version: {
                            id: string;
                            number: string;
                        };
                        /** @description Each component reference, in outline order, and the component version it resolved to: null where the caller may not read the component, where it waits on revisions, or where its content does not read, and what it contributes is then not known */
                        occurrences: {
                            node: string;
                            version: string | null;
                        }[];
                        /** @description What each version an occurrence resolved to contributes, in document order, each once however many occurrences name it */
                        versions: {
                            id: string;
                            contributions: {
                                block: string;
                                sequence: string;
                                numbered: boolean;
                                /** @description A figure's or a table's caption; null for anything else */
                                caption: string | null;
                            }[];
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one whose contributions they may read */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getNumbering: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The numbering table */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "document": "example",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example"
                     *       },
                     *       "scheme": "example",
                     *       "layout": {
                     *         "id": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         }
                     *       },
                     *       "occurrences": [],
                     *       "entries": []
                     *     }
                     */
                    "application/json": {
                        document: string;
                        version: {
                            id: string;
                            number: string;
                        };
                        /** @description The scheme numbered against, by its id: the layout's */
                        scheme: string;
                        /** @description The layout whose scheme these numbers were taken from, at the version read */
                        layout: {
                            id: string;
                            version: {
                                id: string;
                                number: string;
                            };
                        };
                        /** @description Each component reference, in outline order, and the component version it resolved to: null where the caller may not read the component, where it waits on revisions, or where its content does not read. Its contributions are then not counted, and every number it could have moved is null */
                        occurrences: {
                            node: string;
                            version: string | null;
                        }[];
                        entries: {
                            /** @description The outline node that produced it */
                            node: string;
                            /** @description The block or footnote, for a caption or a footnote */
                            block: string | null;
                            sequence: string;
                            /** @enum {string} */
                            matter: "front" | "body" | "appendix";
                            /** @description The section counter stack at this point */
                            sections: number[];
                            /** @description This sequence's counter; null when not known */
                            value: number | null;
                            /** @description The node that last restarted the counter */
                            restartedAt: string | null;
                            number: string | null;
                            label: string | null;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one they may number */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    editOutline: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "operation": {
                 *         "operation": "remove",
                 *         "node": "aaaaaaaaaaaaaaaaaaaaaaaaaa"
                 *       }
                 *     }
                 */
                "application/json": {
                    /** @description The version the outline was read at, which must be the latest */
                    openedFrom: string & (unknown & unknown);
                    operation: {
                        /** @constant */
                        operation: "insert";
                        parent: string | null;
                        position: number;
                        node: {
                            /** @constant */
                            type: "section";
                            title: ({
                                /** @constant */
                                type: "text";
                                value: string;
                                /** @default [] */
                                marks?: ({
                                    /** @constant */
                                    type: "emphasis";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "strong";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "underline";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "subscript";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "superscript";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "inlineCode";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "quotedPhrase";
                                    id: string;
                                } | {
                                    /** @constant */
                                    type: "definedTerm";
                                    id: string;
                                    term: string;
                                } | {
                                    /** @constant */
                                    type: "condition";
                                    id: string;
                                    axis: string;
                                    values: string[];
                                } | {
                                    /** @constant */
                                    type: "suggestion";
                                    id: string;
                                    /** @enum {string} */
                                    operation: "insert" | "delete" | "replace";
                                    author: string;
                                } | {
                                    /** @constant */
                                    type: "comment";
                                    id: string;
                                    threadId: string;
                                } | {
                                    /** @constant */
                                    type: "hyperlink";
                                    id: string;
                                    href: string;
                                    title?: string;
                                } | {
                                    /** @constant */
                                    type: "language";
                                    id: string;
                                    tag: string;
                                })[];
                            } | {
                                /** @constant */
                                type: "equation";
                                mathml: string;
                                latex?: string;
                            } | {
                                /** @constant */
                                type: "footnote";
                                id: string;
                                anchor: {
                                    /** @constant */
                                    kind: "span";
                                } | {
                                    /** @constant */
                                    kind: "cell";
                                    key: string;
                                } | {
                                    /** @constant */
                                    kind: "cellPosition";
                                    row: number;
                                    column: number;
                                } | {
                                    /** @constant */
                                    kind: "table";
                                };
                                content: unknown[];
                            } | {
                                /** @constant */
                                type: "crossReference";
                                id: string;
                                target: {
                                    /** @constant */
                                    kind: "block";
                                    block: string;
                                } | {
                                    /** @constant */
                                    kind: "component";
                                    component: string;
                                    block: string;
                                } | {
                                    /** @constant */
                                    kind: "node";
                                    node: string;
                                };
                                /** @enum {string} */
                                display: "number" | "title" | "numberAndTitle" | "page" | "relative";
                                /** @enum {string} */
                                withoutPages?: "number" | "title" | "numberAndTitle";
                            } | {
                                /** @constant */
                                type: "citation";
                                entry: string;
                                locator?: string;
                            } | {
                                /** @constant */
                                type: "variable";
                                name: string;
                            } | {
                                /** @constant */
                                type: "binding";
                                query: string;
                            } | {
                                /** @constant */
                                type: "image";
                                asset: string;
                                imageStyle: string;
                                alternative: {
                                    /** @constant */
                                    kind: "own";
                                    text: string;
                                } | {
                                    /** @constant */
                                    kind: "inherited";
                                } | {
                                    /** @constant */
                                    kind: "decorative";
                                };
                            })[];
                        } | {
                            /** @constant */
                            type: "reference";
                            component: string;
                            mode: {
                                /** @constant */
                                kind: "pinned";
                                version: string;
                            } | {
                                /** @constant */
                                kind: "latest";
                            } | {
                                /** @constant */
                                kind: "approved";
                            };
                        };
                    } | {
                        /** @constant */
                        operation: "move";
                        node: string;
                        parent: string | null;
                        position: number;
                    } | {
                        /** @constant */
                        operation: "remove";
                        node: string;
                    } | {
                        /** @constant */
                        operation: "retitle";
                        node: string;
                        title: ({
                            /** @constant */
                            type: "text";
                            value: string;
                            /** @default [] */
                            marks?: ({
                                /** @constant */
                                type: "emphasis";
                                id: string;
                            } | {
                                /** @constant */
                                type: "strong";
                                id: string;
                            } | {
                                /** @constant */
                                type: "underline";
                                id: string;
                            } | {
                                /** @constant */
                                type: "subscript";
                                id: string;
                            } | {
                                /** @constant */
                                type: "superscript";
                                id: string;
                            } | {
                                /** @constant */
                                type: "inlineCode";
                                id: string;
                            } | {
                                /** @constant */
                                type: "quotedPhrase";
                                id: string;
                            } | {
                                /** @constant */
                                type: "definedTerm";
                                id: string;
                                term: string;
                            } | {
                                /** @constant */
                                type: "condition";
                                id: string;
                                axis: string;
                                values: string[];
                            } | {
                                /** @constant */
                                type: "suggestion";
                                id: string;
                                /** @enum {string} */
                                operation: "insert" | "delete" | "replace";
                                author: string;
                            } | {
                                /** @constant */
                                type: "comment";
                                id: string;
                                threadId: string;
                            } | {
                                /** @constant */
                                type: "hyperlink";
                                id: string;
                                href: string;
                                title?: string;
                            } | {
                                /** @constant */
                                type: "language";
                                id: string;
                                tag: string;
                            })[];
                        } | {
                            /** @constant */
                            type: "equation";
                            mathml: string;
                            latex?: string;
                        } | {
                            /** @constant */
                            type: "footnote";
                            id: string;
                            anchor: {
                                /** @constant */
                                kind: "span";
                            } | {
                                /** @constant */
                                kind: "cell";
                                key: string;
                            } | {
                                /** @constant */
                                kind: "cellPosition";
                                row: number;
                                column: number;
                            } | {
                                /** @constant */
                                kind: "table";
                            };
                            content: unknown[];
                        } | {
                            /** @constant */
                            type: "crossReference";
                            id: string;
                            target: {
                                /** @constant */
                                kind: "block";
                                block: string;
                            } | {
                                /** @constant */
                                kind: "component";
                                component: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "node";
                                node: string;
                            };
                            /** @enum {string} */
                            display: "number" | "title" | "numberAndTitle" | "page" | "relative";
                            /** @enum {string} */
                            withoutPages?: "number" | "title" | "numberAndTitle";
                        } | {
                            /** @constant */
                            type: "citation";
                            entry: string;
                            locator?: string;
                        } | {
                            /** @constant */
                            type: "variable";
                            name: string;
                        } | {
                            /** @constant */
                            type: "binding";
                            query: string;
                        } | {
                            /** @constant */
                            type: "image";
                            asset: string;
                            imageStyle: string;
                            alternative: {
                                /** @constant */
                                kind: "own";
                                text: string;
                            } | {
                                /** @constant */
                                kind: "inherited";
                            } | {
                                /** @constant */
                                kind: "decorative";
                            };
                        })[];
                    } | {
                        /** @constant */
                        operation: "set";
                        node: string;
                        numbered?: boolean;
                        /** @enum {string} */
                        matter?: "front" | "body" | "appendix";
                        /** @enum {string} */
                        pageBreak?: "none" | "page" | "recto";
                        mode?: {
                            /** @constant */
                            kind: "pinned";
                            version: string;
                        } | {
                            /** @constant */
                            kind: "latest";
                        } | {
                            /** @constant */
                            kind: "approved";
                        };
                        /** @description A section's field values, whole: each a field its document's template applies to sections */
                        values?: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Applied, or nothing changed: the document at its latest version */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "outline": {},
                     *       "values": {},
                     *       "fields": {
                     *         "document": [],
                     *         "section": []
                     *       },
                     *       "schemas": [],
                     *       "template": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         }
                     *       },
                     *       "mayEdit": false,
                     *       "mayPublish": false,
                     *       "layout": {
                     *         "id": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         },
                     *         "language": "en",
                     *         "scheme": {},
                     *         "words": {},
                     *         "formats": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                        values: {
                            [key: string]: unknown;
                        };
                        /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                        fields: {
                            document: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                            section: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                        };
                        /** @description The schemas behind those fields, by name, for naming which require or fix one */
                        schemas: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                        template: {
                            id: string;
                            name: string;
                            version: {
                                id: string;
                                number: string;
                            };
                        } | null;
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                        layout: {
                            id: string;
                            version: {
                                id: string;
                                number: string;
                            };
                            language: string;
                            /** @description The numbering scheme this document is numbered and published with */
                            scheme: {
                                [key: string]: unknown;
                            };
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                            words: {
                                [key: string]: unknown;
                            };
                            /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                            formats: string[];
                        };
                    };
                };
            };
            /** @description outline_invalid: the operation does not apply to the latest outline; values_invalid: a section's value does not fit; values_unresolved: the document's template no longer resolves; or invalid_request: a body this route does not accept */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the document as it now stands */
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                            outline: {
                                [key: string]: unknown;
                            };
                            /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                            values: {
                                [key: string]: unknown;
                            };
                            /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                            fields: {
                                document: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                                section: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                            };
                            /** @description The schemas behind those fields, by name, for naming which require or fix one */
                            schemas: {
                                id: string;
                                name: string;
                            }[];
                            /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                            template: {
                                id: string;
                                name: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                            } | null;
                            /** @description Whether the caller may restructure the outline */
                            mayEdit: boolean;
                            /** @description Whether the caller may publish the document */
                            mayPublish: boolean;
                            /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                            layout: {
                                id: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                                language: string;
                                /** @description The numbering scheme this document is numbered and published with */
                                scheme: {
                                    [key: string]: unknown;
                                };
                                /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                                words: {
                                    [key: string]: unknown;
                                };
                                /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                                formats: string[];
                            };
                        };
                        /** @description outline_invalid: why the operation does not apply */
                        reason?: string;
                        /** @description values_invalid: each value that does not fit its field, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the document but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description version_precondition: the outline has changed since it was read */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the document as it now stands */
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                            outline: {
                                [key: string]: unknown;
                            };
                            /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                            values: {
                                [key: string]: unknown;
                            };
                            /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                            fields: {
                                document: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                                section: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                            };
                            /** @description The schemas behind those fields, by name, for naming which require or fix one */
                            schemas: {
                                id: string;
                                name: string;
                            }[];
                            /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                            template: {
                                id: string;
                                name: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                            } | null;
                            /** @description Whether the caller may restructure the outline */
                            mayEdit: boolean;
                            /** @description Whether the caller may publish the document */
                            mayPublish: boolean;
                            /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                            layout: {
                                id: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                                language: string;
                                /** @description The numbering scheme this document is numbered and published with */
                                scheme: {
                                    [key: string]: unknown;
                                };
                                /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                                words: {
                                    [key: string]: unknown;
                                };
                                /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                                formats: string[];
                            };
                        };
                        /** @description outline_invalid: why the operation does not apply */
                        reason?: string;
                        /** @description values_invalid: each value that does not fit its field, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getDocumentPresentation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The theme and the frame */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "theme": {
                     *         "versionId": "example",
                     *         "number": "example",
                     *         "content": {},
                     *         "catalogues": []
                     *       },
                     *       "frame": {
                     *         "measure": 0,
                     *         "textHeight": 0
                     *       }
                     *     }
                     */
                    "application/json": {
                        theme: {
                            versionId: string;
                            /** @description The theme version, as VER-009 presents it */
                            number: string;
                            /** @description The theme version as stored, naming its catalogues by version */
                            content: {
                                [key: string]: unknown;
                            };
                            /** @description Each catalogue version the theme names */
                            catalogues: {
                                versionId: string;
                                /** @description The catalogue version as stored */
                                content: {
                                    [key: string]: unknown;
                                };
                            }[];
                        };
                        /** @description The layout's page, as far as an image style's lengths are shares of it */
                        frame: {
                            /** @description The width of the layout's text block, in points */
                            measure: number;
                            /** @description The height of the layout's text block, in points */
                            textHeight: number;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one they may see set */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document, or not one the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    requestPreview: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "version": "00000000-0000-4000-8000-000000000001"
                 *     }
                 */
                "application/json": {
                    /** @description The document version the caller is previewing, which must be the latest */
                    version: string & (unknown & unknown);
                };
            };
        };
        responses: {
            /** @description Asked for, and queued; follow the request for its outcome and its PDF */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "document": "example",
                     *       "kind": "publish",
                     *       "state": "queued",
                     *       "failures": [],
                     *       "publication": "example",
                     *       "preview": {
                     *         "view": "example",
                     *         "download": "example",
                     *         "expiresAt": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        document: string;
                        /**
                         * @description A publish, which makes a publication, or a preview, which makes a PDF for an hour
                         * @enum {string}
                         */
                        kind: "publish" | "preview";
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        failures: {
                            /** @enum {string} */
                            stage: "resolve" | "compose" | "engine" | "store";
                            /** @enum {string} */
                            code: "occurrence_unreadable" | "occurrence_unresolved" | "asset_unreadable" | "component_metadata_invalid" | "title_not_publishable" | "block_not_publishable" | "inline_not_publishable" | "style_missing" | "language_not_publishable" | "glyph_missing" | "character_disallowed" | "nothing_to_publish" | "layout_glyph_missing" | "layout_language_not_publishable" | "code_glyph_missing" | "line_too_wide" | "table_without_caption" | "table_header_spans_body" | "figure_without_caption" | "alternative_missing" | "caption_too_long" | "image_too_wide" | "image_in_caption" | "footnote_not_publishable_here" | "footnote_anchor_unresolved" | "footnote_empty" | "footnote_unnumbered" | "cross_reference_unresolved" | "cross_reference_form_unavailable" | "equation_unrenderable" | "equation_unnumbered" | "math_glyph_missing" | "style_not_applicable" | "typeface_not_embeddable" | "typeface_unavailable" | "continuation_words_missing" | "word_not_yet" | "format_unsupported" | "numbering_not_in_word" | "list_not_in_word" | "cross_reference_not_in_word" | "preview_words_missing" | "heading_too_deep" | "engine_failed" | "store_failed";
                            /** @description The outline node it concerns */
                            node: string | null;
                            /** @description The block within that node's component */
                            block: string | null;
                            /** @description The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read */
                            detail: string | null;
                        }[];
                        /** @description The publication it made, once done */
                        publication: string | null;
                        /** @description A done preview's links and expiry, until it expires; none for a publish, or a preview not done or expired */
                        preview: {
                            /** @description A link to the PDF, valid for five minutes, that a browser shows rather than saves */
                            view: string;
                            /** @description A link to the same bytes, valid for five minutes, that saves them, named by the request's id */
                            download: string;
                            /** @description When the preview goes, an hour after it was made; after it, there are no links */
                            expiresAt: string;
                        } | null;
                    };
                };
            };
            /** @description `format_unsupported`: the layout makes no PDF; `layout_language`: the document is not in its layout's language; `section_required`: a section its template requires is missing; `metadata_invalid`: its values, or a section's, do not satisfy its template; `values_unresolved`: its template no longer resolves */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the version the document is at */
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description section_required: each section the document's template requires that none of its sections came from */
                        sections?: {
                            key: string;
                            title: string;
                        }[];
                        /** @description metadata_invalid: each value that does not satisfy the document's template, in MET-022's shape, with the node it belongs to, null for the document's own */
                        failures?: {
                            node: string | null;
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one they may preview */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `version_precondition`: the document has a newer version than the one named, which `current` names */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the version the document is at */
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description section_required: each section the document's template requires that none of its sections came from */
                        sections?: {
                            key: string;
                            title: string;
                        }[];
                        /** @description metadata_invalid: each value that does not satisfy the document's template, in MET-022's shape, with the node it belongs to, null for the document's own */
                        failures?: {
                            node: string | null;
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listPublications: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "published" | "title";
                order?: "asc" | "desc";
                spaces?: string;
                documents?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the publications */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "facets": {
                     *         "spaces": [],
                     *         "documents": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            document: string;
                            version: {
                                id: string;
                                number: string;
                            };
                            /** @description The document's title at the version published */
                            title: string;
                            publisher: {
                                id: string;
                                displayName: string | null;
                            };
                            publishedAt: string;
                            /**
                             * @description `none`: a draft. Nothing in T1 can approve a publication
                             * @constant
                             */
                            approval: "none";
                            formats: string[];
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                            documents: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one whose listing they may read */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    requestPublication: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "version": "00000000-0000-4000-8000-000000000001",
                 *       "formats": [
                 *         "example"
                 *       ]
                 *     }
                 */
                "application/json": {
                    /** @description The document version the caller is publishing, which must be the latest */
                    version: string & (unknown & unknown);
                    /** @description The formats to publish, each once: `pdf`, `docx`, or both, where the document's layout makes them. A format it does not make is refused by name, and one without `pdf` where the document cites a page */
                    formats: string[];
                };
            };
        };
        responses: {
            /** @description Asked for, and queued; follow the request for its outcome */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "document": "example",
                     *       "kind": "publish",
                     *       "state": "queued",
                     *       "failures": [],
                     *       "publication": "example",
                     *       "preview": {
                     *         "view": "example",
                     *         "download": "example",
                     *         "expiresAt": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        document: string;
                        /**
                         * @description A publish, which makes a publication, or a preview, which makes a PDF for an hour
                         * @enum {string}
                         */
                        kind: "publish" | "preview";
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        failures: {
                            /** @enum {string} */
                            stage: "resolve" | "compose" | "engine" | "store";
                            /** @enum {string} */
                            code: "occurrence_unreadable" | "occurrence_unresolved" | "asset_unreadable" | "component_metadata_invalid" | "title_not_publishable" | "block_not_publishable" | "inline_not_publishable" | "style_missing" | "language_not_publishable" | "glyph_missing" | "character_disallowed" | "nothing_to_publish" | "layout_glyph_missing" | "layout_language_not_publishable" | "code_glyph_missing" | "line_too_wide" | "table_without_caption" | "table_header_spans_body" | "figure_without_caption" | "alternative_missing" | "caption_too_long" | "image_too_wide" | "image_in_caption" | "footnote_not_publishable_here" | "footnote_anchor_unresolved" | "footnote_empty" | "footnote_unnumbered" | "cross_reference_unresolved" | "cross_reference_form_unavailable" | "equation_unrenderable" | "equation_unnumbered" | "math_glyph_missing" | "style_not_applicable" | "typeface_not_embeddable" | "typeface_unavailable" | "continuation_words_missing" | "word_not_yet" | "format_unsupported" | "numbering_not_in_word" | "list_not_in_word" | "cross_reference_not_in_word" | "preview_words_missing" | "heading_too_deep" | "engine_failed" | "store_failed";
                            /** @description The outline node it concerns */
                            node: string | null;
                            /** @description The block within that node's component */
                            block: string | null;
                            /** @description The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read */
                            detail: string | null;
                        }[];
                        /** @description The publication it made, once done */
                        publication: string | null;
                        /** @description A done preview's links and expiry, until it expires; none for a publish, or a preview not done or expired */
                        preview: {
                            /** @description A link to the PDF, valid for five minutes, that a browser shows rather than saves */
                            view: string;
                            /** @description A link to the same bytes, valid for five minutes, that saves them, named by the request's id */
                            download: string;
                            /** @description When the preview goes, an hour after it was made; after it, there are no links */
                            expiresAt: string;
                        } | null;
                    };
                };
            };
            /** @description `format_unsupported`: a format the layout does not make; `layout_language`: the document is not in its layout's language; `page_reference_without_pdf`: the document cites a page and the PDF was not asked for; `section_required`: a section its template requires is missing; `metadata_invalid`: its values, or a section's, do not satisfy its template; `values_unresolved`: its template no longer resolves */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the version the document is at */
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description section_required: each section the document's template requires that none of its sections came from */
                        sections?: {
                            key: string;
                            title: string;
                        }[];
                        /** @description metadata_invalid: each value that does not satisfy the document's template, in MET-022's shape, with the node it belongs to, null for the document's own */
                        failures?: {
                            node: string | null;
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the document but may not publish it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `version_precondition`: the document has a newer version than the one named, which `current` names */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the version the document is at */
                        current?: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description section_required: each section the document's template requires that none of its sections came from */
                        sections?: {
                            key: string;
                            title: string;
                        }[];
                        /** @description metadata_invalid: each value that does not satisfy the document's template, in MET-022's shape, with the node it belongs to, null for the document's own */
                        failures?: {
                            node: string | null;
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            [key: string]: unknown;
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getDocumentTexts: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Each occurrence, and each version it resolved to with its content */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "document": "example",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example"
                     *       },
                     *       "occurrences": [],
                     *       "versions": []
                     *     }
                     */
                    "application/json": {
                        document: string;
                        version: {
                            id: string;
                            number: string;
                        };
                        /** @description Each component reference, in outline order, and the version it resolved to: null where the caller may not read the component, where it waits on revisions, or where its content does not read */
                        occurrences: {
                            node: string;
                            version: string | null;
                            /** @description Whether the caller may edit the component: false where they may not read it */
                            mayEdit: boolean;
                            /** @description Who holds the component now and until when: null where nobody does, or where the caller may not read it */
                            lock: {
                                holder: {
                                    id: string;
                                    name: string | null;
                                };
                                /** @description When it lapses unless the holder saves again */
                                expectedRelease: string;
                                /** @description Whether the caller holds it, from this session or another */
                                yours: boolean;
                                /** @description The holding session, told only to its own principal */
                                session: string | null;
                            } | null;
                        }[];
                        /** @description Each version an occurrence resolved to, once, however many occurrences name it, with its number */
                        versions: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The version's content document */
                            content: {
                                [key: string]: unknown;
                            };
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a document the caller may read is one whose text they may read, as far as they may read it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    recordDocumentValues: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "values": {}
                 *     }
                 */
                "application/json": {
                    /** @description The version the values were read at, which must be the latest */
                    openedFrom: string & (unknown & unknown);
                    /** @description The document's values, by field identifier */
                    values: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Written, or nothing changed: the document at its latest version */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "outline": {},
                     *       "values": {},
                     *       "fields": {
                     *         "document": [],
                     *         "section": []
                     *       },
                     *       "schemas": [],
                     *       "template": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         }
                     *       },
                     *       "mayEdit": false,
                     *       "mayPublish": false,
                     *       "layout": {
                     *         "id": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         },
                     *         "language": "en",
                     *         "scheme": {},
                     *         "words": {},
                     *         "formats": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                        values: {
                            [key: string]: unknown;
                        };
                        /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                        fields: {
                            document: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                            section: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                        };
                        /** @description The schemas behind those fields, by name, for naming which require or fix one */
                        schemas: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                        template: {
                            id: string;
                            name: string;
                            version: {
                                id: string;
                                number: string;
                            };
                        } | null;
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                        layout: {
                            id: string;
                            version: {
                                id: string;
                                number: string;
                            };
                            language: string;
                            /** @description The numbering scheme this document is numbered and published with */
                            scheme: {
                                [key: string]: unknown;
                            };
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                            words: {
                                [key: string]: unknown;
                            };
                            /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                            formats: string[];
                        };
                    };
                };
            };
            /** @description values_invalid: a value is for a field the document's template does not apply, or does not fit its field; values_unresolved: the template no longer resolves; or invalid_request: a body this route does not accept */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the document as it now stands */
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                            outline: {
                                [key: string]: unknown;
                            };
                            /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                            values: {
                                [key: string]: unknown;
                            };
                            /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                            fields: {
                                document: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                                section: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                            };
                            /** @description The schemas behind those fields, by name, for naming which require or fix one */
                            schemas: {
                                id: string;
                                name: string;
                            }[];
                            /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                            template: {
                                id: string;
                                name: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                            } | null;
                            /** @description Whether the caller may restructure the outline */
                            mayEdit: boolean;
                            /** @description Whether the caller may publish the document */
                            mayPublish: boolean;
                            /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                            layout: {
                                id: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                                language: string;
                                /** @description The numbering scheme this document is numbered and published with */
                                scheme: {
                                    [key: string]: unknown;
                                };
                                /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                                words: {
                                    [key: string]: unknown;
                                };
                                /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                                formats: string[];
                            };
                        };
                        /** @description outline_invalid: why the operation does not apply */
                        reason?: string;
                        /** @description values_invalid: each value that does not fit its field, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the document but may not edit it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such document in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description version_precondition: the document has changed since it was read */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @description version_precondition: the document as it now stands */
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                            outline: {
                                [key: string]: unknown;
                            };
                            /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                            values: {
                                [key: string]: unknown;
                            };
                            /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                            fields: {
                                document: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                                section: {
                                    id: string;
                                    name: string;
                                    dataType: string;
                                    /** @enum {string} */
                                    multiplicity: "one" | "many";
                                    maxValues?: number;
                                    validation: {
                                        [key: string]: unknown;
                                    };
                                    required: boolean;
                                    /** @description Every schema that makes it required, by identifier */
                                    requiredBy: string[];
                                    fixed: boolean;
                                    /** @description Every schema that fixes it, by identifier */
                                    fixedBy: string[];
                                    /** @description Absent where no schema gives one */
                                    default?: unknown;
                                }[];
                            };
                            /** @description The schemas behind those fields, by name, for naming which require or fix one */
                            schemas: {
                                id: string;
                                name: string;
                            }[];
                            /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                            template: {
                                id: string;
                                name: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                            } | null;
                            /** @description Whether the caller may restructure the outline */
                            mayEdit: boolean;
                            /** @description Whether the caller may publish the document */
                            mayPublish: boolean;
                            /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                            layout: {
                                id: string;
                                version: {
                                    id: string;
                                    number: string;
                                };
                                language: string;
                                /** @description The numbering scheme this document is numbered and published with */
                                scheme: {
                                    [key: string]: unknown;
                                };
                                /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                                words: {
                                    [key: string]: unknown;
                                };
                                /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                                formats: string[];
                            };
                        };
                        /** @description outline_invalid: why the operation does not apply */
                        reason?: string;
                        /** @description values_invalid: each value that does not fit its field, in MET-022's shape */
                        failures?: {
                            code: string;
                            field: string;
                            rule: string;
                            schemas: string[];
                            detail: string;
                        }[];
                        /** @description values_unresolved: what the document's template names that does not resolve now */
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listGrants: {
        parameters: {
            query: {
                level: string;
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                types?: string;
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of grants */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            role: {
                                id: string;
                                name: string;
                            };
                            subject: {
                                principal: {
                                    id: string;
                                    name: string | null;
                                    email: string | null;
                                };
                            } | {
                                group: {
                                    id: string;
                                    name: string;
                                };
                            };
                            /** @description `tenant`, `space:<id>` or `artifact:<id>` */
                            level: string;
                            /** @enum {string} */
                            effect: "allow" | "deny";
                            /** @description When it stops conferring anything, or null for never */
                            expiresAt: string | null;
                            /** @description The grant this one replaced by extending it */
                            extends: string | null;
                            grantedBy: {
                                id: string;
                                name: string | null;
                            };
                            grantedAt: string;
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the level but may not administer it, or anything above it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such level or grant in this environment, or none the caller may see */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    makeGrant: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "role": "00000000-0000-4000-8000-000000000001",
                 *       "subject": {
                 *         "principal": "00000000-0000-4000-8000-000000000001"
                 *       },
                 *       "level": "tenant",
                 *       "effect": "allow"
                 *     }
                 */
                "application/json": {
                    /** @description The role granted */
                    role: string & (unknown & unknown);
                    /** @description Who it is granted to: a principal, or a group and so each of its members */
                    subject: {
                        principal: string & (unknown & unknown);
                    } | {
                        group: string & (unknown & unknown);
                    };
                    /** @description Where it is granted */
                    level: string;
                    /**
                     * @description deny refuses everything the role holds, there
                     * @enum {string}
                     */
                    effect: "allow" | "deny";
                };
            };
        };
        responses: {
            /** @description Granted */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "grant": {
                     *         "id": "example",
                     *         "role": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "subject": {
                     *           "principal": {
                     *             "id": "example",
                     *             "name": "example",
                     *             "email": "example"
                     *           }
                     *         },
                     *         "level": "tenant",
                     *         "effect": "allow",
                     *         "expiresAt": "example",
                     *         "extends": "example",
                     *         "grantedBy": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "grantedAt": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        grant: {
                            id: string;
                            role: {
                                id: string;
                                name: string;
                            };
                            subject: {
                                principal: {
                                    id: string;
                                    name: string | null;
                                    email: string | null;
                                };
                            } | {
                                group: {
                                    id: string;
                                    name: string;
                                };
                            };
                            /** @description `tenant`, `space:<id>` or `artifact:<id>` */
                            level: string;
                            /** @enum {string} */
                            effect: "allow" | "deny";
                            /** @description When it stops conferring anything, or null for never */
                            expiresAt: string | null;
                            /** @description The grant this one replaced by extending it */
                            extends: string | null;
                            grantedBy: {
                                id: string;
                                name: string | null;
                            };
                            grantedAt: string;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the level but may not administer it, or anything above it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such level or grant in this environment, or none the caller may see */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description grant_duplicate, grant_allow_without_read, grant_administer_denied_at_tenant, grant_role_missing, grant_subject_missing, grant_external_at_tenant, grant_external_capped or grant_external_past_cap */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    removeGrant: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Removed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "removed": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description The grant removed */
                        removed: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such level or grant in this environment, or none the caller may see */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description grant_last_administrator */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listGroups: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                types?: string;
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of groups */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            /**
                             * @description tenant: the environment's own, whose members an administrator names. provider: stands for a value the organisation's provider asserts, and its members are whoever signed in last asserting it
                             * @enum {string}
                             */
                            source: "tenant" | "provider";
                            /** @description The value of the provider's groups claim this group stands for; null for tenant */
                            providerValue: string | null;
                            members: {
                                id: string;
                                name: string | null;
                                email: string | null;
                            }[];
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createGroup: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "name": "example"
                 *     }
                 */
                "application/json": {
                    /** @description 1 to 80 characters, trimmed; unique here */
                    name: string;
                    /** @description Given: the group stands for this value of the provider's groups claim, matched exactly, and its members are the sign-ins' to decide. Absent: the environment's own group */
                    providerValue?: string;
                };
            };
        };
        responses: {
            /** @description Made, with no members yet */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "group": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "source": "tenant",
                     *         "providerValue": "example",
                     *         "members": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        group: {
                            id: string;
                            name: string;
                            /**
                             * @description tenant: the environment's own, whose members an administrator names. provider: stands for a value the organisation's provider asserts, and its members are whoever signed in last asserting it
                             * @enum {string}
                             */
                            source: "tenant" | "provider";
                            /** @description The value of the provider's groups claim this group stands for; null for tenant */
                            providerValue: string | null;
                            members: {
                                id: string;
                                name: string | null;
                                email: string | null;
                            }[];
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description group_name_taken or group_value_taken */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    deleteGroup: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "deleted": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description The group deleted, with its memberships and every grant it held */
                        deleted: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such group in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    setGroupMembers: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "principals": []
                 *     }
                 */
                "application/json": {
                    /** @description Every member the group is to have: those not named are removed. Each counted once */
                    principals: (string & (unknown & unknown))[];
                };
            };
        };
        responses: {
            /** @description Set: the group as it now is */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "group": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "source": "tenant",
                     *         "providerValue": "example",
                     *         "members": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        group: {
                            id: string;
                            name: string;
                            /**
                             * @description tenant: the environment's own, whose members an administrator names. provider: stands for a value the organisation's provider asserts, and its members are whoever signed in last asserting it
                             * @enum {string}
                             */
                            source: "tenant" | "provider";
                            /** @description The value of the provider's groups claim this group stands for; null for tenant */
                            providerValue: string | null;
                            members: {
                                id: string;
                                name: string | null;
                                email: string | null;
                            }[];
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such group in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description group_from_provider, group_member_missing, grant_external_at_tenant, grant_external_capped or grant_external_past_cap */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listInvitations: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                types?: string;
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of invitations */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            /** @description The address invited, in lower case */
                            email: string;
                            /** @description The principal the invitation made: a grant names it, and its first sign-in becomes it */
                            person: string;
                            /** @description Invited as somebody from outside the organisation */
                            external: boolean;
                            /** @description Null for an invitation made by whoever provisioned the environment */
                            invitedBy: {
                                id: string;
                                name: string | null;
                            } | null;
                            createdAt: string;
                            /** @description When it can no longer be accepted, or null for never */
                            expiresAt: string | null;
                            /** @description Waiting, and past its expiry: nobody can accept it until renewed */
                            lapsed: boolean;
                            acceptedAt: string | null;
                            acceptedThrough: ("organisation" | "google") | null;
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    invite: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "email": "developer@example.com"
                 *     }
                 */
                "application/json": {
                    /**
                     * Format: email
                     * @description The address to invite; its case is not kept
                     */
                    email: string;
                    /** @description true: from outside the organisation, and held to the external rules. false if absent */
                    external?: boolean;
                };
            };
        };
        responses: {
            /** @description Invited, or the waiting invitation renewed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "invitation": {
                     *         "id": "example",
                     *         "email": "example",
                     *         "person": "example",
                     *         "external": false,
                     *         "invitedBy": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "createdAt": "example",
                     *         "expiresAt": "example",
                     *         "lapsed": false,
                     *         "acceptedAt": "example",
                     *         "acceptedThrough": "organisation"
                     *       },
                     *       "renewed": false
                     *     }
                     */
                    "application/json": {
                        invitation: {
                            id: string;
                            /** @description The address invited, in lower case */
                            email: string;
                            /** @description The principal the invitation made: a grant names it, and its first sign-in becomes it */
                            person: string;
                            /** @description Invited as somebody from outside the organisation */
                            external: boolean;
                            /** @description Null for an invitation made by whoever provisioned the environment */
                            invitedBy: {
                                id: string;
                                name: string | null;
                            } | null;
                            createdAt: string;
                            /** @description When it can no longer be accepted, or null for never */
                            expiresAt: string | null;
                            /** @description Waiting, and past its expiry: nobody can accept it until renewed */
                            lapsed: boolean;
                            acceptedAt: string | null;
                            acceptedThrough: ("organisation" | "google") | null;
                        };
                        /** @description true: an invitation already waited for the address, and was renewed */
                        renewed: boolean;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description invitation_signed_in or invitation_kind_differs */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    withdrawInvitation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Withdrawn */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "withdrawn": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description The invitation withdrawn, with its person and their grants */
                        withdrawn: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such invitation in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description invitation_accepted */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The signed-in principal */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "displayName": "example",
                     *       "email": "example",
                     *       "environment": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description The principal, stable for as long as the environment exists */
                        id: string;
                        displayName: string | null;
                        email: string | null;
                        /** @description The environment signed in to, as its people see it */
                        environment: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listPeople: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the people, by when each first appeared, invited or signed in */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getPresentation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The theme and the frame */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "theme": {
                     *         "versionId": "example",
                     *         "number": "example",
                     *         "content": {},
                     *         "catalogues": []
                     *       },
                     *       "frame": {
                     *         "measure": 0,
                     *         "textHeight": 0
                     *       }
                     *     }
                     */
                    "application/json": {
                        theme: {
                            versionId: string;
                            /** @description The theme version, as VER-009 presents it */
                            number: string;
                            /** @description The theme version as stored, naming its catalogues by version */
                            content: {
                                [key: string]: unknown;
                            };
                            /** @description Each catalogue version the theme names */
                            catalogues: {
                                versionId: string;
                                /** @description The catalogue version as stored */
                                content: {
                                    [key: string]: unknown;
                                };
                            }[];
                        };
                        /** @description The layout's page, as far as an image style's lengths are shares of it */
                        frame: {
                            /** @description The width of the layout's text block, in points */
                            measure: number;
                            /** @description The height of the layout's text block, in points */
                            textHeight: number;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listPrincipals: {
        parameters: {
            query: {
                level: string;
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                types?: string;
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of people */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string | null;
                            email: string | null;
                            /**
                             * @description external: from outside the organisation, and held to the external rules
                             * @enum {string}
                             */
                            kind: "user" | "service" | "external";
                            /** @description Invited by address, and not yet signed in */
                            invited: boolean;
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the level but may not administer it, or anything above it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such level or grant in this environment, or none the caller may see */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listPrincipalTokens: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the person's tokens */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            /** @description What the person called it, to tell their tokens apart */
                            name: string;
                            /** @description The permissions it may use, of those its creator holds; reading is never masked, so none reads and does nothing else */
                            scopes: ("create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql")[];
                            createdAt: string;
                            /** @description When it stops working; nothing extends a token */
                            expiresAt: string;
                            /** @description When a request last used it, to the minute, or null for never */
                            lastUsedAt: string | null;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description forbidden: the caller may not administer this environment; or token_not_allowed: an administrator manages tokens with a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such person in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    revokePrincipalToken: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
                token: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "revoked": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description The token revoked */
                        revoked: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description forbidden: the caller may not administer this environment; or token_not_allowed: an administrator manages tokens with a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such token of that person's in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getPublicationRequest: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The request */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "document": "example",
                     *       "kind": "publish",
                     *       "state": "queued",
                     *       "failures": [],
                     *       "publication": "example",
                     *       "preview": {
                     *         "view": "example",
                     *         "download": "example",
                     *         "expiresAt": "example"
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        document: string;
                        /**
                         * @description A publish, which makes a publication, or a preview, which makes a PDF for an hour
                         * @enum {string}
                         */
                        kind: "publish" | "preview";
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        failures: {
                            /** @enum {string} */
                            stage: "resolve" | "compose" | "engine" | "store";
                            /** @enum {string} */
                            code: "occurrence_unreadable" | "occurrence_unresolved" | "asset_unreadable" | "component_metadata_invalid" | "title_not_publishable" | "block_not_publishable" | "inline_not_publishable" | "style_missing" | "language_not_publishable" | "glyph_missing" | "character_disallowed" | "nothing_to_publish" | "layout_glyph_missing" | "layout_language_not_publishable" | "code_glyph_missing" | "line_too_wide" | "table_without_caption" | "table_header_spans_body" | "figure_without_caption" | "alternative_missing" | "caption_too_long" | "image_too_wide" | "image_in_caption" | "footnote_not_publishable_here" | "footnote_anchor_unresolved" | "footnote_empty" | "footnote_unnumbered" | "cross_reference_unresolved" | "cross_reference_form_unavailable" | "equation_unrenderable" | "equation_unnumbered" | "math_glyph_missing" | "style_not_applicable" | "typeface_not_embeddable" | "typeface_unavailable" | "continuation_words_missing" | "word_not_yet" | "format_unsupported" | "numbering_not_in_word" | "list_not_in_word" | "cross_reference_not_in_word" | "preview_words_missing" | "heading_too_deep" | "engine_failed" | "store_failed";
                            /** @description The outline node it concerns */
                            node: string | null;
                            /** @description The block within that node's component */
                            block: string | null;
                            /** @description The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read */
                            detail: string | null;
                        }[];
                        /** @description The publication it made, once done */
                        publication: string | null;
                        /** @description A done preview's links and expiry, until it expires; none for a publish, or a preview not done or expired */
                        preview: {
                            /** @description A link to the PDF, valid for five minutes, that a browser shows rather than saves */
                            view: string;
                            /** @description A link to the same bytes, valid for five minutes, that saves them, named by the request's id */
                            download: string;
                            /** @description When the preview goes, an hour after it was made; after it, there are no links */
                            expiresAt: string;
                        } | null;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such request, or one somebody else asked for */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description A done preview, and this environment has nowhere to keep documents yet */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listPublicationsEverywhere: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "published" | "title";
                order?: "asc" | "desc";
                spaces?: string;
                documents?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the publications */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "facets": {
                     *         "spaces": [],
                     *         "documents": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            document: string;
                            version: {
                                id: string;
                                number: string;
                            };
                            /** @description The document's title at the version published */
                            title: string;
                            publisher: {
                                id: string;
                                displayName: string | null;
                            };
                            publishedAt: string;
                            /**
                             * @description `none`: a draft. Nothing in T1 can approve a publication
                             * @constant
                             */
                            approval: "none";
                            formats: string[];
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                            documents: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getPublication: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The publication */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "document": "example",
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example"
                     *       },
                     *       "title": "example",
                     *       "publisher": {
                     *         "id": "example",
                     *         "displayName": "example"
                     *       },
                     *       "publishedAt": "example",
                     *       "approval": "none",
                     *       "formats": [],
                     *       "engine": {
                     *         "name": "typst",
                     *         "version": "example"
                     *       },
                     *       "template": {
                     *         "name": "publication",
                     *         "version": -9007199254740991
                     *       },
                     *       "pipeline": "example",
                     *       "outputs": []
                     *     }
                     */
                    "application/json": {
                        id: string;
                        document: string;
                        version: {
                            id: string;
                            number: string;
                        };
                        /** @description The document's title at the version published */
                        title: string;
                        publisher: {
                            id: string;
                            displayName: string | null;
                        };
                        publishedAt: string;
                        /**
                         * @description `none`: a draft. Nothing in T1 can approve a publication
                         * @constant
                         */
                        approval: "none";
                        formats: string[];
                        /** @description The PDF's engine; none where the publication has no PDF */
                        engine: {
                            /** @constant */
                            name: "typst";
                            version: string;
                        } | null;
                        /** @description The PDF's template; none where the publication has no PDF */
                        template: {
                            /** @constant */
                            name: "publication";
                            version: number;
                        } | null;
                        pipeline: string;
                        /** @description One per format, the PDF first */
                        outputs: ({
                            /** @constant */
                            format: "pdf";
                            bytes: number;
                            sha256: string;
                            /** @constant */
                            standard: "ua-1";
                            /** @constant */
                            producer: "typst";
                            /** @description The template version it was set by */
                            producerVersion: string;
                            report: [
                            ];
                            /** @description A link to the bytes, valid for five minutes, named by the publication id and format */
                            download: string;
                            /** @description A link to the same bytes, valid for five minutes, that a browser shows rather than saves */
                            view: string;
                            /** @description What veraPDF found of the PDF against PDF/UA-1; none until it has been checked, which follows the recording */
                            check: {
                                /** @constant */
                                checker: "verapdf";
                                /** @description veraPDF's own version, as its report names it */
                                checkerVersion: string;
                                /**
                                 * @description The profile it checked against: PDF/UA-1
                                 * @constant
                                 */
                                profile: "ua1";
                                compliant: boolean;
                                /** @description Each rule the PDF failed; none where it passed */
                                failedRules: {
                                    /** @description The clause of ISO 14289-1 the rule belongs to */
                                    clause: string;
                                    /** @description The rule's test within its clause */
                                    test: number;
                                    /** @description What the rule asks for, in veraPDF's words */
                                    description?: string;
                                }[];
                                /** @description veraPDF's whole report, as it wrote it, kept with the publication */
                                report: {
                                    bytes: number;
                                    sha256: string;
                                    /** @description A link to veraPDF's whole report, its JSON, valid for five minutes, saved as `{id}-verapdf.json` */
                                    download: string;
                                };
                                checkedAt: string;
                            } | null;
                            /**
                             * @description Where the PDF's check stands: `pending`, not yet checked; `passed` or `failed`, as its check says; `gave_up`, not checked and never to be, its checks having given up as often as they are tried
                             * @enum {string}
                             */
                            checkState: "pending" | "passed" | "failed" | "gave_up";
                        } | {
                            /** @constant */
                            format: "docx";
                            bytes: number;
                            sha256: string;
                            standard: null;
                            /** @constant */
                            producer: "word";
                            /** @description The Word writer's version, as `word/1` */
                            producerVersion: string;
                            /** @description What Word could not carry: a face it set in another; a table's header column, repeated header or continuation label; a heading or caption whose equation Word's rebuilt entries flatten; each structure the PDF tags that Word has no place for, by its place; the maths' alternatives and the Word face's characters, once; the titles the PDF tags as headings that Word sets as body text, once; a list after the contents Word cannot link; that page numbers cite the PDF; that it carries no page-cited output */
                            report: ({
                                /** @constant */
                                kind: "face_substituted";
                                family: string;
                                wordFamily: string;
                            } | {
                                /** @constant */
                                kind: "no_page_cited_output";
                            } | {
                                /** @constant */
                                kind: "pages_cite_the_pdf";
                            } | {
                                /** @constant */
                                kind: "header_column_lost";
                                node: string;
                                block: string;
                                label: string | null;
                            } | {
                                /** @constant */
                                kind: "header_repeated";
                                node: string;
                                block: string;
                                label: string | null;
                            } | {
                                /** @constant */
                                kind: "continuation_label_omitted";
                                node: string;
                                block: string;
                                label: string | null;
                            } | {
                                /** @constant */
                                kind: "equation_flattened";
                                node: string;
                                block: string | null;
                                label: string | null;
                            } | {
                                /** @constant */
                                kind: "description_language_lost";
                                node: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "quotation_not_structure";
                                node: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "preformatted_not_structure";
                                node: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "definition_list_not_structure";
                                node: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "quoted_phrase_not_structure";
                                node: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "inline_code_not_structure";
                                node: string;
                                block: string;
                            } | {
                                /** @constant */
                                kind: "equation_numbered_as_table";
                                node: string;
                                block: string;
                                label: string;
                            } | {
                                /** @constant */
                                kind: "equation_alternative_lost";
                            } | {
                                /** @constant */
                                kind: "maths_coverage_unchecked";
                                wordFamily: string;
                            } | {
                                /** @constant */
                                kind: "titles_not_headings";
                                titles: ("document" | "contents" | "lists")[];
                            } | {
                                /** @constant */
                                kind: "list_not_linked";
                                /** @constant */
                                sequence: "figure";
                            })[];
                            /** @description A link to the bytes, valid for five minutes, named by the publication id and format */
                            download: string;
                            /** @description None: a browser saves a Word document rather than showing it */
                            view: null;
                        })[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a publication the caller may read is one they may open */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such publication in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description This environment has nowhere to keep documents yet */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listQueryDefinitions: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                spaces?: string;
                connection?: string & (unknown & unknown);
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of query definitions */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "facets": {
                     *         "spaces": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            title: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            /** @description The connection it names, by its latest name */
                            connection: {
                                id: string;
                                name: string;
                            } | null;
                            retired: boolean;
                            version: {
                                id: string;
                                number: string;
                            };
                            /** @description When its latest version was made */
                            changedAt: string;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getQueryDefinition: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The query definition */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {
                     *         "schemaVersion": 1,
                     *         "connection": "00000000-0000-4000-8000-000000000001",
                     *         "parameters": [],
                     *         "fetch": {
                     *           "kind": "sql",
                     *           "text": "example"
                     *         },
                     *         "columns": [
                     *           {
                     *             "name": "example",
                     *             "from": {
                     *               "column": "example"
                     *             },
                     *             "type": {
                     *               "base": "text"
                     *             }
                     *           }
                     *         ],
                     *         "key": [],
                     *         "order": "multiset",
                     *         "empty": "valid",
                     *         "limits": {
                     *           "rows": 1,
                     *           "bytes": 1,
                     *           "seconds": 1
                     *         },
                     *         "title": "example",
                     *         "description": "example",
                     *         "retired": false
                     *       },
                     *       "connection": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "identity": "service",
                     *         "retired": false
                     *       },
                     *       "mayEdit": false,
                     *       "mayRun": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        definition: {
                            /** @constant */
                            schemaVersion: 1;
                            /** Format: uuid */
                            connection: string;
                            parameters: {
                                name: string;
                                type: {
                                    /** @constant */
                                    base: "text";
                                } | {
                                    /** @constant */
                                    base: "integer";
                                } | {
                                    /** @constant */
                                    base: "decimal";
                                    precision: number;
                                    scale: number;
                                } | {
                                    /** @constant */
                                    base: "date";
                                } | {
                                    /** @constant */
                                    base: "time";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "localDateTime";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "instant";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "boolean";
                                };
                                required: boolean;
                                list: boolean;
                                permitted?: {
                                    values: (string | boolean | null)[];
                                } | {
                                    minimum?: string | boolean | null;
                                    maximum?: string | boolean | null;
                                };
                                variation?: {
                                    key: string;
                                    sql: string;
                                }[];
                            }[];
                            fetch: {
                                /** @constant */
                                kind: "sql";
                                text: string;
                            };
                            columns: {
                                name: string;
                                from: {
                                    column: string;
                                };
                                type: {
                                    /** @constant */
                                    base: "text";
                                } | {
                                    /** @constant */
                                    base: "integer";
                                } | {
                                    /** @constant */
                                    base: "decimal";
                                    precision: number;
                                    scale: number;
                                } | {
                                    /** @constant */
                                    base: "date";
                                } | {
                                    /** @constant */
                                    base: "time";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "localDateTime";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "instant";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "boolean";
                                };
                            }[];
                            key: string[];
                            order: "multiset" | {
                                column: string;
                                /** @enum {string} */
                                direction: "ascending" | "descending";
                            }[];
                            /** @enum {string} */
                            empty: "valid" | "invalid";
                            limits: {
                                rows: number;
                                bytes: number;
                                seconds: number;
                            };
                            title: string;
                            description: string;
                            retired: boolean;
                        };
                        /** @description The connection it names, at its latest version */
                        connection: {
                            id: string;
                            name: string;
                            /**
                             * @description Whose identity the connection runs a query as
                             * @enum {string}
                             */
                            identity: "service" | "endUser";
                            retired: boolean;
                        } | null;
                        /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                        mayEdit: boolean;
                        /** @description Whether the caller may describe and sample SQL against its connection */
                        mayRun: boolean;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a definition the caller may not read is not found */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such query definition in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    recordQueryDefinitionVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "definition": {
                 *         "schemaVersion": 1,
                 *         "connection": "00000000-0000-4000-8000-000000000001",
                 *         "parameters": [],
                 *         "fetch": {
                 *           "kind": "sql",
                 *           "text": "example"
                 *         },
                 *         "columns": [
                 *           {
                 *             "name": "example",
                 *             "from": {
                 *               "column": "example"
                 *             },
                 *             "type": {
                 *               "base": "text"
                 *             }
                 *           }
                 *         ],
                 *         "key": [],
                 *         "order": "multiset",
                 *         "empty": "valid",
                 *         "limits": {
                 *           "rows": 1,
                 *           "bytes": 1,
                 *           "seconds": 1
                 *         },
                 *         "title": "example",
                 *         "description": "example",
                 *         "retired": false
                 *       }
                 *     }
                 */
                "application/json": {
                    openedFrom: string & (unknown & unknown);
                    definition: {
                        /** @constant */
                        schemaVersion: 1;
                        /** Format: uuid */
                        connection: string;
                        parameters: {
                            name: string;
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                            required: boolean;
                            list: boolean;
                            permitted?: {
                                values: (string | boolean | null)[];
                            } | {
                                minimum?: string | boolean | null;
                                maximum?: string | boolean | null;
                            };
                            variation?: {
                                key: string;
                                sql: string;
                            }[];
                        }[];
                        fetch: {
                            /** @constant */
                            kind: "sql";
                            text: string;
                        };
                        columns: {
                            name: string;
                            from: {
                                column: string;
                            };
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                        }[];
                        key: string[];
                        order: "multiset" | {
                            column: string;
                            /** @enum {string} */
                            direction: "ascending" | "descending";
                        }[];
                        /** @enum {string} */
                        empty: "valid" | "invalid";
                        limits: {
                            rows: number;
                            bytes: number;
                            seconds: number;
                        };
                        title: string;
                        description: string;
                        retired: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description The definition at its latest version: the one cut, or the one before where nothing changed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {
                     *         "schemaVersion": 1,
                     *         "connection": "00000000-0000-4000-8000-000000000001",
                     *         "parameters": [],
                     *         "fetch": {
                     *           "kind": "sql",
                     *           "text": "example"
                     *         },
                     *         "columns": [
                     *           {
                     *             "name": "example",
                     *             "from": {
                     *               "column": "example"
                     *             },
                     *             "type": {
                     *               "base": "text"
                     *             }
                     *           }
                     *         ],
                     *         "key": [],
                     *         "order": "multiset",
                     *         "empty": "valid",
                     *         "limits": {
                     *           "rows": 1,
                     *           "bytes": 1,
                     *           "seconds": 1
                     *         },
                     *         "title": "example",
                     *         "description": "example",
                     *         "retired": false
                     *       },
                     *       "connection": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "identity": "service",
                     *         "retired": false
                     *       },
                     *       "mayEdit": false,
                     *       "mayRun": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        definition: {
                            /** @constant */
                            schemaVersion: 1;
                            /** Format: uuid */
                            connection: string;
                            parameters: {
                                name: string;
                                type: {
                                    /** @constant */
                                    base: "text";
                                } | {
                                    /** @constant */
                                    base: "integer";
                                } | {
                                    /** @constant */
                                    base: "decimal";
                                    precision: number;
                                    scale: number;
                                } | {
                                    /** @constant */
                                    base: "date";
                                } | {
                                    /** @constant */
                                    base: "time";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "localDateTime";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "instant";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "boolean";
                                };
                                required: boolean;
                                list: boolean;
                                permitted?: {
                                    values: (string | boolean | null)[];
                                } | {
                                    minimum?: string | boolean | null;
                                    maximum?: string | boolean | null;
                                };
                                variation?: {
                                    key: string;
                                    sql: string;
                                }[];
                            }[];
                            fetch: {
                                /** @constant */
                                kind: "sql";
                                text: string;
                            };
                            columns: {
                                name: string;
                                from: {
                                    column: string;
                                };
                                type: {
                                    /** @constant */
                                    base: "text";
                                } | {
                                    /** @constant */
                                    base: "integer";
                                } | {
                                    /** @constant */
                                    base: "decimal";
                                    precision: number;
                                    scale: number;
                                } | {
                                    /** @constant */
                                    base: "date";
                                } | {
                                    /** @constant */
                                    base: "time";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "localDateTime";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "instant";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "boolean";
                                };
                            }[];
                            key: string[];
                            order: "multiset" | {
                                column: string;
                                /** @enum {string} */
                                direction: "ascending" | "descending";
                            }[];
                            /** @enum {string} */
                            empty: "valid" | "invalid";
                            limits: {
                                rows: number;
                                bytes: number;
                                seconds: number;
                            };
                            title: string;
                            description: string;
                            retired: boolean;
                        };
                        /** @description The connection it names, at its latest version */
                        connection: {
                            id: string;
                            name: string;
                            /**
                             * @description Whose identity the connection runs a query as
                             * @enum {string}
                             */
                            identity: "service" | "endUser";
                            retired: boolean;
                        } | null;
                        /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                        mayEdit: boolean;
                        /** @description Whether the caller may describe and sample SQL against its connection */
                        mayRun: boolean;
                    };
                };
            };
            /** @description `definition_invalid`: the definition fails a rule, each problem named, or names no connection the caller may read */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        /** @enum {string} */
                        reason?: "untested" | "not_read_only";
                        problems?: {
                            /** @constant */
                            rule: "definition_invalid";
                            /** @description The member refused, dotted, as `columns.2.name` */
                            path: string;
                            message: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            definition: {
                                /** @constant */
                                schemaVersion: 1;
                                /** Format: uuid */
                                connection: string;
                                parameters: {
                                    name: string;
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                    required: boolean;
                                    list: boolean;
                                    permitted?: {
                                        values: (string | boolean | null)[];
                                    } | {
                                        minimum?: string | boolean | null;
                                        maximum?: string | boolean | null;
                                    };
                                    variation?: {
                                        key: string;
                                        sql: string;
                                    }[];
                                }[];
                                fetch: {
                                    /** @constant */
                                    kind: "sql";
                                    text: string;
                                };
                                columns: {
                                    name: string;
                                    from: {
                                        column: string;
                                    };
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                }[];
                                key: string[];
                                order: "multiset" | {
                                    column: string;
                                    /** @enum {string} */
                                    direction: "ascending" | "descending";
                                }[];
                                /** @enum {string} */
                                empty: "valid" | "invalid";
                                limits: {
                                    rows: number;
                                    bytes: number;
                                    seconds: number;
                                };
                                title: string;
                                description: string;
                                retired: boolean;
                            };
                            /** @description The connection it names, at its latest version */
                            connection: {
                                id: string;
                                name: string;
                                /**
                                 * @description Whose identity the connection runs a query as
                                 * @enum {string}
                                 */
                                identity: "service" | "endUser";
                                retired: boolean;
                            } | null;
                            /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                            mayEdit: boolean;
                            /** @description Whether the caller may describe and sample SQL against its connection */
                            mayRun: boolean;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the definition but may not edit it, or does not hold use connection and write SQL on the connection */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such query definition in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `version_precondition`: the definition has a newer version than the one named, answered with it; `connection_retired`: the connection it names is retired; `sql_not_permitted`: the connection has not been tested clean at its latest version and credential, or its account was found able to write, and SQL is refused on it */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        /** @enum {string} */
                        reason?: "untested" | "not_read_only";
                        problems?: {
                            /** @constant */
                            rule: "definition_invalid";
                            /** @description The member refused, dotted, as `columns.2.name` */
                            path: string;
                            message: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            definition: {
                                /** @constant */
                                schemaVersion: 1;
                                /** Format: uuid */
                                connection: string;
                                parameters: {
                                    name: string;
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                    required: boolean;
                                    list: boolean;
                                    permitted?: {
                                        values: (string | boolean | null)[];
                                    } | {
                                        minimum?: string | boolean | null;
                                        maximum?: string | boolean | null;
                                    };
                                    variation?: {
                                        key: string;
                                        sql: string;
                                    }[];
                                }[];
                                fetch: {
                                    /** @constant */
                                    kind: "sql";
                                    text: string;
                                };
                                columns: {
                                    name: string;
                                    from: {
                                        column: string;
                                    };
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                }[];
                                key: string[];
                                order: "multiset" | {
                                    column: string;
                                    /** @enum {string} */
                                    direction: "ascending" | "descending";
                                }[];
                                /** @enum {string} */
                                empty: "valid" | "invalid";
                                limits: {
                                    rows: number;
                                    bytes: number;
                                    seconds: number;
                                };
                                title: string;
                                description: string;
                                retired: boolean;
                            };
                            /** @description The connection it names, at its latest version */
                            connection: {
                                id: string;
                                name: string;
                                /**
                                 * @description Whose identity the connection runs a query as
                                 * @enum {string}
                                 */
                                identity: "service" | "endUser";
                                retired: boolean;
                            } | null;
                            /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                            mayEdit: boolean;
                            /** @description Whether the caller may describe and sample SQL against its connection */
                            mayRun: boolean;
                        };
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listRoles: {
        parameters: {
            query: {
                level: string;
                cursor?: string;
                limit?: string;
                sort?: "title" | "changed";
                order?: "asc" | "desc";
                types?: string;
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of roles */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            permissions: ("read" | "create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql")[];
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the level but may not administer it, or anything above it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such level or grant in this environment, or none the caller may see */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    requestSample: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Asked for; a worker will make it */
            202: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "state": "queued",
                     *       "download": "example"
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        /** @description A link to the PDF, good for a few minutes, once a worker has made it */
                        download: string | null;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description token_not_allowed: this takes a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description This environment has nowhere to keep documents yet */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getSample: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                sampleId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The sample */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "state": "queued",
                     *       "download": "example"
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        /** @description A link to the PDF, good for a few minutes, once a worker has made it */
                        download: string | null;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such sample in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    search: {
        parameters: {
            query?: {
                q?: string;
                offset?: string;
                limit?: string;
                kind?: string;
                space?: string;
                type?: string;
                owner?: string;
                changed?: "today" | "week" | "month" | "year" | "earlier";
                changedFrom?: string;
                changedTo?: string;
                value?: string | string[];
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The results, or by name why there are none to give */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "outcome": "empty",
                     *       "message": "example"
                     *     }
                     */
                    "application/json": {
                        /** @constant */
                        outcome: "empty";
                        /** @description The outcome in a sentence, for the reader */
                        message: string;
                    } | {
                        /** @constant */
                        outcome: "nothing_to_match";
                        /** @description What the query left out, with nothing to look for */
                        excluded: string[];
                        /** @description The outcome in a sentence, for the reader */
                        message: string;
                    } | {
                        /** @constant */
                        outcome: "unknown_field";
                        name: string;
                        /** @description The outcome in a sentence, for the reader */
                        message: string;
                    } | {
                        /** @constant */
                        outcome: "results";
                        /** @description How many match, up to 1,000 */
                        count: number;
                        /** @description Whether more match than the count, which is then a lower bound */
                        capped: boolean;
                        items: {
                            /** @enum {string} */
                            kind: "component" | "document" | "section" | "publication" | "template" | "asset" | "field" | "metadataSchema" | "componentType" | "queryDefinition";
                            artifactId: string;
                            /** @description A section's outline node; null for anything else */
                            node: string | null;
                            title: string;
                            space: {
                                id: string;
                                name: string;
                            } | null;
                            changedAt: string;
                            /** @description Where it matched best: `title`, `block:<id>`, `field:<id>`, `section:<key>`, `description`, `fields`, `schemas`, `columns` or `connection` */
                            place: string | null;
                            /** @description Words from that place, about thirty, each matched word a piece of its own */
                            passage: {
                                text: string;
                                matched: boolean;
                            }[];
                        }[];
                        /** @description Every declared dimension, each counted with the other filters in force and its own left out */
                        facets: {
                            kinds: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                /** @description How many it would leave, up to 1,000 */
                                count: number;
                                /** @description Whether more than the count, which is then a lower bound */
                                capped: boolean;
                            }[];
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                /** @description How many it would leave, up to 1,000 */
                                count: number;
                                /** @description Whether more than the count, which is then a lower bound */
                                capped: boolean;
                            }[];
                            componentTypes: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                /** @description How many it would leave, up to 1,000 */
                                count: number;
                                /** @description Whether more than the count, which is then a lower bound */
                                capped: boolean;
                            }[];
                            owners: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                /** @description How many it would leave, up to 1,000 */
                                count: number;
                                /** @description Whether more than the count, which is then a lower bound */
                                capped: boolean;
                            }[];
                            /** @description Each declared range, in order: today, week, month, year, earlier */
                            changed: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                /** @description How many it would leave, up to 1,000 */
                                count: number;
                                /** @description Whether more than the count, which is then a lower bound */
                                capped: boolean;
                            }[];
                            fields: {
                                field: string;
                                name: string;
                                dataType: string;
                                /** @description Its ten commonest values */
                                values: {
                                    /** @description What to filter by to leave these */
                                    value: string;
                                    label: string;
                                    /** @description How many it would leave, up to 1,000 */
                                    count: number;
                                    /** @description Whether more than the count, which is then a lower bound */
                                    capped: boolean;
                                }[];
                            }[];
                        };
                        /** @description The outcome in a sentence, for the reader */
                        message: string;
                    };
                };
            };
            /** @description An offset or a limit out of range, or a filter that is not one */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getDataSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The data settings, with the ceilings */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "rows": -9007199254740991,
                     *       "bytes": -9007199254740991,
                     *       "seconds": -9007199254740991,
                     *       "ceilings": {
                     *         "rows": -9007199254740991,
                     *         "bytes": -9007199254740991,
                     *         "seconds": -9007199254740991
                     *       }
                     *     }
                     */
                    "application/json": {
                        rows: number | null;
                        bytes: number | null;
                        seconds: number | null;
                        /** @description The product's ceilings, which no definition passes and an environment only lowers */
                        ceilings: {
                            rows: number;
                            bytes: number;
                            seconds: number;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    setDataSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /** @example {} */
                "application/json": {
                    /** @description The most rows a run may read, 1 to 100000; null or absent lowers none */
                    rows?: number | null;
                    /** @description The most bytes a run's result may hold, 1 to 26214400; null or absent lowers none */
                    bytes?: number | null;
                    /** @description The most seconds a run may take, 1 to 120; null or absent lowers none */
                    seconds?: number | null;
                };
            };
        };
        responses: {
            /** @description The data settings, as changed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "rows": -9007199254740991,
                     *       "bytes": -9007199254740991,
                     *       "seconds": -9007199254740991,
                     *       "ceilings": {
                     *         "rows": -9007199254740991,
                     *         "bytes": -9007199254740991,
                     *         "seconds": -9007199254740991
                     *       }
                     *     }
                     */
                    "application/json": {
                        rows: number | null;
                        bytes: number | null;
                        seconds: number | null;
                        /** @description The product's ceilings, which no definition passes and an environment only lowers */
                        ceilings: {
                            rows: number;
                            bytes: number;
                            seconds: number;
                        };
                    };
                };
            };
            /** @description A limit that is not a whole number from 1 to its ceiling */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getEditingSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The editing settings */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "iterationRetentionDays": 1
                     *     }
                     */
                    "application/json": {
                        /** @description How many days an iteration is kept after the next version of its component is made: 1 to 365, 30 unless changed */
                        iterationRetentionDays: number;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    setEditingSettings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "iterationRetentionDays": 1
                 *     }
                 */
                "application/json": {
                    /** @description How many days an iteration is kept after the next version of its component is made: 1 to 365, 30 unless changed */
                    iterationRetentionDays: number;
                };
            };
        };
        responses: {
            /** @description The editing settings, as changed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "iterationRetentionDays": 1
                     *     }
                     */
                    "application/json": {
                        /** @description How many days an iteration is kept after the next version of its component is made: 1 to 365, 30 unless changed */
                        iterationRetentionDays: number;
                    };
                };
            };
            /** @description A window that is not a whole number of days from 1 to 365 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not administer this environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    startGoogleSignIn: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description On to Google */
            302: {
                headers: {
                    /** @description Where to go next */
                    Location?: string;
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description This environment does not permit signing in this way */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    finishGoogleSignIn: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
                error?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Admitted, and on to the environment that asked, with a one-time code */
            302: {
                headers: {
                    /** @description Where to go next */
                    Location?: string;
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The sign-in could not be completed */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description This account is not invited to that environment */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description This is not the sign-in address */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    completeGoogleSignIn: {
        parameters: {
            query: {
                code: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed in, and on to the application */
            302: {
                headers: {
                    /** @description Where to go next */
                    Location?: string;
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The sign-in could not be completed */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    startOrganisationSignIn: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description On to the identity provider */
            302: {
                headers: {
                    /** @description Where to go next */
                    Location?: string;
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description This environment does not permit signing in this way */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    finishOrganisationSignIn: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
                error?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed in, and on to the application */
            302: {
                headers: {
                    /** @description Where to go next */
                    Location?: string;
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The sign-in could not be completed */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    signOut: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out, everywhere this session was in use */
            204: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description token_not_allowed: this takes a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listSpaces: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the spaces, by name */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            /** @description Whether the caller may create a component in this space */
                            mayCreate: boolean;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createAssetUpload: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "alternative": {
                 *         "text": "example",
                 *         "language": "en"
                 *       }
                 *     }
                 */
                "application/json": {
                    /** @description The image's default description for somebody who cannot see it, in a language, or null for none */
                    alternative: {
                        text: string;
                        language: string;
                    } | null;
                };
            };
        };
        responses: {
            /** @description The upload, awaiting its bytes */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": "example",
                     *       "state": "awaiting",
                     *       "reason": "not_permitted",
                     *       "assetVersion": "example"
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: string;
                        /**
                         * @description `awaiting` its bytes; `checking` them; `ready`, with its asset version; or `refused`, with why. Nothing can place an upload that is not ready
                         * @enum {string}
                         */
                        state: "awaiting" | "checking" | "ready" | "refused";
                        /** @description Why it was refused, once refused */
                        reason: ("not_permitted" | "too_large" | "too_many_pixels" | "malformed" | "undecodable" | "unchecked") | null;
                        /** @description The asset version it made, once ready */
                        assetVersion: string | null;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the space but not create in it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such thing in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listComponentTypes: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the component types, by name */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            /** @description The environment's default, preselected (MET-011, MET-042) */
                            isDefault: boolean;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the space but may not create in it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such space in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createComponent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "title": "example",
                 *       "language": "en",
                 *       "direction": "ltr"
                 *     }
                 */
                "application/json": {
                    title: string;
                    language: string;
                    /** @enum {string} */
                    direction: "ltr" | "rtl";
                    /** @description Absent: the environment's default (MET-011) */
                    componentType?: string & (unknown & unknown);
                };
            };
        };
        responses: {
            /** @description Created, at version 0.1 */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "content": {},
                     *       "mayEdit": false,
                     *       "lock": {
                     *         "holder": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "expectedRelease": "example",
                     *         "yours": false,
                     *         "session": "example"
                     *       },
                     *       "unsaved": {
                     *         "savedAt": "example"
                     *       },
                     *       "sequence": -9007199254740991,
                     *       "type": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "fields": [],
                     *       "schemas": [],
                     *       "values": {}
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's content document (content-model.md), exactly as stored */
                        content: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may take the lock and write */
                        mayEdit: boolean;
                        lock: {
                            holder: {
                                id: string;
                                name: string | null;
                            };
                            /** @description When it lapses unless the holder saves again */
                            expectedRelease: string;
                            /** @description Whether the caller holds it, from this session or another */
                            yours: boolean;
                            /** @description The holding session, told only to its own principal */
                            session: string | null;
                        } | null;
                        /** @description The caller's own newest iteration opened from the latest version, work saved and never made a version, by its time alone; null where there is none */
                        unsaved: {
                            /** @description When the service accepted it */
                            savedAt: string;
                        } | null;
                        /** @description The latest sequence the service has accepted from the editing session the `session` query names, the caller's own; null where none is named or it has saved none */
                        sequence: number | null;
                        /** @description The component type its latest version records, at the current version */
                        type: {
                            id: string;
                            name: string;
                        };
                        /** @description Its fields at the current definitions of its type, in resolution order: what its next version is written against */
                        fields: {
                            id: string;
                            name: string;
                            dataType: string;
                            /** @enum {string} */
                            multiplicity: "one" | "many";
                            maxValues?: number;
                            validation: {
                                [key: string]: unknown;
                            };
                            required: boolean;
                            /** @description Every schema that makes it required, by identifier */
                            requiredBy: string[];
                            fixed: boolean;
                            /** @description Every schema that fixes it, by identifier */
                            fixedBy: string[];
                            /** @description Absent where no schema gives one */
                            default?: unknown;
                        }[];
                        /** @description The schemas its type assigns, by name, for naming which require or fix a field */
                        schemas: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The latest version's values, by field identifier */
                        values: {
                            [key: string]: unknown;
                        };
                    };
                };
            };
            /** @description The title, language or direction is not one the content model accepts */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the space but may not create in it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such space in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description component_type_missing: no such component type in this environment */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createConnection: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "settings": {
                 *         "schemaVersion": 1,
                 *         "name": "example",
                 *         "description": "example",
                 *         "type": "postgres",
                 *         "source": {
                 *           "host": "example",
                 *           "port": 1,
                 *           "database": "example",
                 *           "account": "example",
                 *           "tls": "require"
                 *         },
                 *         "identity": {
                 *           "kind": "service"
                 *         },
                 *         "retired": false
                 *       }
                 *     }
                 */
                "application/json": {
                    settings: {
                        /** @constant */
                        schemaVersion: 1;
                        name: string;
                        description: string;
                        /** @constant */
                        type: "postgres";
                        source: {
                            host: string;
                            port: number;
                            database: string;
                            account: string;
                            /** @enum {string} */
                            tls: "require" | "verifyFull";
                        };
                        identity: {
                            /** @constant */
                            kind: "service";
                        } | {
                            /** @constant */
                            kind: "endUser";
                            /** @constant */
                            mechanism: "delegated";
                            tokenEndpoint: string;
                            audience: string;
                        } | {
                            /** @constant */
                            kind: "endUser";
                            /** @constant */
                            mechanism: "asserted";
                            /** @enum {string} */
                            attribute: "email" | "subject";
                            /** @enum {string} */
                            assertion?: "sessionContext" | "executeAs";
                        };
                        retired: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Made, at version 0.1 */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "settings": {
                     *         "schemaVersion": 1,
                     *         "name": "example",
                     *         "description": "example",
                     *         "type": "postgres",
                     *         "source": {
                     *           "host": "example",
                     *           "port": 1,
                     *           "database": "example",
                     *           "account": "example",
                     *           "tls": "require"
                     *         },
                     *         "identity": {
                     *           "kind": "service"
                     *         },
                     *         "retired": false
                     *       },
                     *       "credential": {
                     *         "set": false
                     *       },
                     *       "lastTest": {
                     *         "outcome": "ok",
                     *         "findings": [],
                     *         "at": "example",
                     *         "by": {
                     *           "id": "example",
                     *           "name": "example"
                     *         },
                     *         "version": "example",
                     *         "credentialCurrent": false
                     *       },
                     *       "mayAdminister": false,
                     *       "mayUse": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        settings: {
                            /** @constant */
                            schemaVersion: 1;
                            name: string;
                            description: string;
                            /** @constant */
                            type: "postgres";
                            source: {
                                host: string;
                                port: number;
                                database: string;
                                account: string;
                                /** @enum {string} */
                                tls: "require" | "verifyFull";
                            };
                            identity: {
                                /** @constant */
                                kind: "service";
                            } | {
                                /** @constant */
                                kind: "endUser";
                                /** @constant */
                                mechanism: "delegated";
                                tokenEndpoint: string;
                                audience: string;
                            } | {
                                /** @constant */
                                kind: "endUser";
                                /** @constant */
                                mechanism: "asserted";
                                /** @enum {string} */
                                attribute: "email" | "subject";
                                /** @enum {string} */
                                assertion?: "sessionContext" | "executeAs";
                            };
                            retired: boolean;
                        };
                        credential: {
                            /** @constant */
                            set: false;
                        } | {
                            /** @constant */
                            set: true;
                            setBy: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            setAt: string;
                            /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                            targetChanged: boolean;
                            /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                            setBeforeBinding: boolean;
                        };
                        lastTest: {
                            /** @enum {string} */
                            outcome: "ok" | "failed";
                            findings: "account_not_read_only"[];
                            failure?: {
                                /** @description Stable and machine-readable */
                                code: string;
                                /**
                                 * @description Whose failure it is: the source's side, the query's author, or the product
                                 * @enum {string}
                                 */
                                attribution: "connector" | "query" | "product";
                                message: string;
                                /** @description What the source said, where it refused the statement: `source_refused` alone */
                                source?: {
                                    /** @description The source's five-character SQLSTATE */
                                    sqlstate: string;
                                    /** @description The source's own message, cut to 1,000 characters */
                                    message: string;
                                };
                                /** @description The column the failure names, where it names one */
                                column?: string;
                                /** @description The row the failure names, counted from 1 */
                                row?: number;
                            };
                            at: string;
                            by: {
                                id: string;
                                /** @description Their name, or their address where they have none */
                                name: string | null;
                            };
                            /** @description The connection version it tested */
                            version: string;
                            /** @description Whether it was made with the credential set now; a test of an earlier credential says nothing of this one */
                            credentialCurrent: boolean;
                        } | null;
                        /** @description Whether the caller may change it and set its credential */
                        mayAdminister: boolean;
                        /** @description Whether the caller may test it and list its tables */
                        mayUse: boolean;
                    };
                };
            };
            /** @description `connection_invalid` or `identity_not_supported`: the settings are refused by rule, each problem named */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        problems?: {
                            /** @enum {string} */
                            rule: "connection_invalid" | "identity_not_supported";
                            path?: string;
                            message?: string;
                            type?: string;
                            mechanism?: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            settings: {
                                /** @constant */
                                schemaVersion: 1;
                                name: string;
                                description: string;
                                /** @constant */
                                type: "postgres";
                                source: {
                                    host: string;
                                    port: number;
                                    database: string;
                                    account: string;
                                    /** @enum {string} */
                                    tls: "require" | "verifyFull";
                                };
                                identity: {
                                    /** @constant */
                                    kind: "service";
                                } | {
                                    /** @constant */
                                    kind: "endUser";
                                    /** @constant */
                                    mechanism: "delegated";
                                    tokenEndpoint: string;
                                    audience: string;
                                } | {
                                    /** @constant */
                                    kind: "endUser";
                                    /** @constant */
                                    mechanism: "asserted";
                                    /** @enum {string} */
                                    attribute: "email" | "subject";
                                    /** @enum {string} */
                                    assertion?: "sessionContext" | "executeAs";
                                };
                                retired: boolean;
                            };
                            credential: {
                                /** @constant */
                                set: false;
                            } | {
                                /** @constant */
                                set: true;
                                setBy: {
                                    id: string;
                                    /** @description Their name, or their address where they have none */
                                    name: string | null;
                                };
                                setAt: string;
                                /** @description Whether the host, port, database, account or TLS has changed since it was set: if so it is never used again, and must be set again */
                                targetChanged: boolean;
                                /** @description Whether it was set before credentials were bound to where a connection signs in: if so it is never used, and must be set again, though nothing changed */
                                setBeforeBinding: boolean;
                            };
                            lastTest: {
                                /** @enum {string} */
                                outcome: "ok" | "failed";
                                findings: "account_not_read_only"[];
                                failure?: {
                                    /** @description Stable and machine-readable */
                                    code: string;
                                    /**
                                     * @description Whose failure it is: the source's side, the query's author, or the product
                                     * @enum {string}
                                     */
                                    attribution: "connector" | "query" | "product";
                                    message: string;
                                    /** @description What the source said, where it refused the statement: `source_refused` alone */
                                    source?: {
                                        /** @description The source's five-character SQLSTATE */
                                        sqlstate: string;
                                        /** @description The source's own message, cut to 1,000 characters */
                                        message: string;
                                    };
                                    /** @description The column the failure names, where it names one */
                                    column?: string;
                                    /** @description The row the failure names, counted from 1 */
                                    row?: number;
                                };
                                at: string;
                                by: {
                                    id: string;
                                    /** @description Their name, or their address where they have none */
                                    name: string | null;
                                };
                                /** @description The connection version it tested */
                                version: string;
                                /** @description Whether it was made with the credential set now; a test of an earlier credential says nothing of this one */
                                credentialCurrent: boolean;
                            } | null;
                            /** @description Whether the caller may change it and set its credential */
                            mayAdminister: boolean;
                            /** @description Whether the caller may test it and list its tables */
                            mayUse: boolean;
                        };
                        /** @description Where retiring is refused, the query definitions still naming the connection that are not retired */
                        definitions?: {
                            readable: {
                                id: string;
                                title: string;
                                retired: boolean;
                            }[];
                            /** @description How many more name it that the caller may not read */
                            others: number;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the space but may not administer it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such space in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createDocument: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "title": "example",
                 *       "language": "en",
                 *       "direction": "ltr"
                 *     }
                 */
                "application/json": {
                    title: string;
                    language: string;
                    /** @enum {string} */
                    direction: "ltr" | "rtl";
                    /** @description The template to make it from, at its latest version (templates.md); without one, a blank document */
                    template?: string & (unknown & unknown);
                };
            };
        };
        responses: {
            /** @description Created, at version 0.1 */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "outline": {},
                     *       "values": {},
                     *       "fields": {
                     *         "document": [],
                     *         "section": []
                     *       },
                     *       "schemas": [],
                     *       "template": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         }
                     *       },
                     *       "mayEdit": false,
                     *       "mayPublish": false,
                     *       "layout": {
                     *         "id": "example",
                     *         "version": {
                     *           "id": "example",
                     *           "number": "example"
                     *         },
                     *         "language": "en",
                     *         "scheme": {},
                     *         "words": {},
                     *         "formats": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description The latest version's own field values, by field identifier: empty for a document with no template */
                        values: {
                            [key: string]: unknown;
                        };
                        /** @description The fields the document's template applies to the document and to each of its sections, at the current definitions; none for a document made blank, or whose template no longer resolves */
                        fields: {
                            document: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                            section: {
                                id: string;
                                name: string;
                                dataType: string;
                                /** @enum {string} */
                                multiplicity: "one" | "many";
                                maxValues?: number;
                                validation: {
                                    [key: string]: unknown;
                                };
                                required: boolean;
                                /** @description Every schema that makes it required, by identifier */
                                requiredBy: string[];
                                fixed: boolean;
                                /** @description Every schema that fixes it, by identifier */
                                fixedBy: string[];
                                /** @description Absent where no schema gives one */
                                default?: unknown;
                            }[];
                        };
                        /** @description The schemas behind those fields, by name, for naming which require or fix one */
                        schemas: {
                            id: string;
                            name: string;
                        }[];
                        /** @description The template, and the version of it, the document was made from (TPL-025), named as that version names it. Null for a document made blank, or from a template the caller may not read */
                        template: {
                            id: string;
                            name: string;
                            version: {
                                id: string;
                                number: string;
                            };
                        } | null;
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The document's layout at its latest version - its template's, or the environment's for a document made blank - which is the version a publish requested now would be made under (publishing.md, "The layout"; templates.md) */
                        layout: {
                            id: string;
                            version: {
                                id: string;
                                number: string;
                            };
                            language: string;
                            /** @description The numbering scheme this document is numbered and published with */
                            scheme: {
                                [key: string]: unknown;
                            };
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2), and `preview`, the notice and sentence a preview says in place of the draft's, which a layout read at schema 5 or before has none of (the preview, PV-D) */
                            words: {
                                [key: string]: unknown;
                            };
                            /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                            formats: string[];
                        };
                    };
                };
            };
            /** @description The title, language or direction is not one an outline accepts; or `template_unresolved`: a theme, layout, schema or field the template names does not resolve */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's definition (templates.md, "The definition"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                            /** @description Whether the caller may change the template */
                            mayDesign: boolean;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the space but may not create in it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such space in this environment, or none the caller may read; or no such template, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createQueryDefinition: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "definition": {
                 *         "schemaVersion": 1,
                 *         "connection": "00000000-0000-4000-8000-000000000001",
                 *         "parameters": [],
                 *         "fetch": {
                 *           "kind": "sql",
                 *           "text": "example"
                 *         },
                 *         "columns": [
                 *           {
                 *             "name": "example",
                 *             "from": {
                 *               "column": "example"
                 *             },
                 *             "type": {
                 *               "base": "text"
                 *             }
                 *           }
                 *         ],
                 *         "key": [],
                 *         "order": "multiset",
                 *         "empty": "valid",
                 *         "limits": {
                 *           "rows": 1,
                 *           "bytes": 1,
                 *           "seconds": 1
                 *         },
                 *         "title": "example",
                 *         "description": "example",
                 *         "retired": false
                 *       }
                 *     }
                 */
                "application/json": {
                    definition: {
                        /** @constant */
                        schemaVersion: 1;
                        /** Format: uuid */
                        connection: string;
                        parameters: {
                            name: string;
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                            required: boolean;
                            list: boolean;
                            permitted?: {
                                values: (string | boolean | null)[];
                            } | {
                                minimum?: string | boolean | null;
                                maximum?: string | boolean | null;
                            };
                            variation?: {
                                key: string;
                                sql: string;
                            }[];
                        }[];
                        fetch: {
                            /** @constant */
                            kind: "sql";
                            text: string;
                        };
                        columns: {
                            name: string;
                            from: {
                                column: string;
                            };
                            type: {
                                /** @constant */
                                base: "text";
                            } | {
                                /** @constant */
                                base: "integer";
                            } | {
                                /** @constant */
                                base: "decimal";
                                precision: number;
                                scale: number;
                            } | {
                                /** @constant */
                                base: "date";
                            } | {
                                /** @constant */
                                base: "time";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "localDateTime";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "instant";
                                fraction: number;
                            } | {
                                /** @constant */
                                base: "boolean";
                            };
                        }[];
                        key: string[];
                        order: "multiset" | {
                            column: string;
                            /** @enum {string} */
                            direction: "ascending" | "descending";
                        }[];
                        /** @enum {string} */
                        empty: "valid" | "invalid";
                        limits: {
                            rows: number;
                            bytes: number;
                            seconds: number;
                        };
                        title: string;
                        description: string;
                        retired: boolean;
                    };
                };
            };
        };
        responses: {
            /** @description Made, at version 0.1 */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {
                     *         "schemaVersion": 1,
                     *         "connection": "00000000-0000-4000-8000-000000000001",
                     *         "parameters": [],
                     *         "fetch": {
                     *           "kind": "sql",
                     *           "text": "example"
                     *         },
                     *         "columns": [
                     *           {
                     *             "name": "example",
                     *             "from": {
                     *               "column": "example"
                     *             },
                     *             "type": {
                     *               "base": "text"
                     *             }
                     *           }
                     *         ],
                     *         "key": [],
                     *         "order": "multiset",
                     *         "empty": "valid",
                     *         "limits": {
                     *           "rows": 1,
                     *           "bytes": 1,
                     *           "seconds": 1
                     *         },
                     *         "title": "example",
                     *         "description": "example",
                     *         "retired": false
                     *       },
                     *       "connection": {
                     *         "id": "example",
                     *         "name": "example",
                     *         "identity": "service",
                     *         "retired": false
                     *       },
                     *       "mayEdit": false,
                     *       "mayRun": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        definition: {
                            /** @constant */
                            schemaVersion: 1;
                            /** Format: uuid */
                            connection: string;
                            parameters: {
                                name: string;
                                type: {
                                    /** @constant */
                                    base: "text";
                                } | {
                                    /** @constant */
                                    base: "integer";
                                } | {
                                    /** @constant */
                                    base: "decimal";
                                    precision: number;
                                    scale: number;
                                } | {
                                    /** @constant */
                                    base: "date";
                                } | {
                                    /** @constant */
                                    base: "time";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "localDateTime";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "instant";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "boolean";
                                };
                                required: boolean;
                                list: boolean;
                                permitted?: {
                                    values: (string | boolean | null)[];
                                } | {
                                    minimum?: string | boolean | null;
                                    maximum?: string | boolean | null;
                                };
                                variation?: {
                                    key: string;
                                    sql: string;
                                }[];
                            }[];
                            fetch: {
                                /** @constant */
                                kind: "sql";
                                text: string;
                            };
                            columns: {
                                name: string;
                                from: {
                                    column: string;
                                };
                                type: {
                                    /** @constant */
                                    base: "text";
                                } | {
                                    /** @constant */
                                    base: "integer";
                                } | {
                                    /** @constant */
                                    base: "decimal";
                                    precision: number;
                                    scale: number;
                                } | {
                                    /** @constant */
                                    base: "date";
                                } | {
                                    /** @constant */
                                    base: "time";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "localDateTime";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "instant";
                                    fraction: number;
                                } | {
                                    /** @constant */
                                    base: "boolean";
                                };
                            }[];
                            key: string[];
                            order: "multiset" | {
                                column: string;
                                /** @enum {string} */
                                direction: "ascending" | "descending";
                            }[];
                            /** @enum {string} */
                            empty: "valid" | "invalid";
                            limits: {
                                rows: number;
                                bytes: number;
                                seconds: number;
                            };
                            title: string;
                            description: string;
                            retired: boolean;
                        };
                        /** @description The connection it names, at its latest version */
                        connection: {
                            id: string;
                            name: string;
                            /**
                             * @description Whose identity the connection runs a query as
                             * @enum {string}
                             */
                            identity: "service" | "endUser";
                            retired: boolean;
                        } | null;
                        /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                        mayEdit: boolean;
                        /** @description Whether the caller may describe and sample SQL against its connection */
                        mayRun: boolean;
                    };
                };
            };
            /** @description `definition_invalid`: the definition fails a rule, each problem named, or names no connection the caller may read */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        /** @enum {string} */
                        reason?: "untested" | "not_read_only";
                        problems?: {
                            /** @constant */
                            rule: "definition_invalid";
                            /** @description The member refused, dotted, as `columns.2.name` */
                            path: string;
                            message: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            definition: {
                                /** @constant */
                                schemaVersion: 1;
                                /** Format: uuid */
                                connection: string;
                                parameters: {
                                    name: string;
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                    required: boolean;
                                    list: boolean;
                                    permitted?: {
                                        values: (string | boolean | null)[];
                                    } | {
                                        minimum?: string | boolean | null;
                                        maximum?: string | boolean | null;
                                    };
                                    variation?: {
                                        key: string;
                                        sql: string;
                                    }[];
                                }[];
                                fetch: {
                                    /** @constant */
                                    kind: "sql";
                                    text: string;
                                };
                                columns: {
                                    name: string;
                                    from: {
                                        column: string;
                                    };
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                }[];
                                key: string[];
                                order: "multiset" | {
                                    column: string;
                                    /** @enum {string} */
                                    direction: "ascending" | "descending";
                                }[];
                                /** @enum {string} */
                                empty: "valid" | "invalid";
                                limits: {
                                    rows: number;
                                    bytes: number;
                                    seconds: number;
                                };
                                title: string;
                                description: string;
                                retired: boolean;
                            };
                            /** @description The connection it names, at its latest version */
                            connection: {
                                id: string;
                                name: string;
                                /**
                                 * @description Whose identity the connection runs a query as
                                 * @enum {string}
                                 */
                                identity: "service" | "endUser";
                                retired: boolean;
                            } | null;
                            /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                            mayEdit: boolean;
                            /** @description Whether the caller may describe and sample SQL against its connection */
                            mayRun: boolean;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may not edit in the space, or does not hold use connection and write SQL on the connection */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such space in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `connection_retired`: the connection it names is retired; `sql_not_permitted`: the connection has not been tested clean at its latest version and credential, or its account was found able to write, and SQL is refused on it */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        /** @enum {string} */
                        attribution?: "connector" | "query" | "product";
                        /** @description What the source said, where it refused the statement: `source_refused` alone */
                        source?: {
                            /** @description The source's five-character SQLSTATE */
                            sqlstate: string;
                            /** @description The source's own message, cut to 1,000 characters */
                            message: string;
                        };
                        column?: string;
                        row?: number;
                        /** @enum {string} */
                        reason?: "untested" | "not_read_only";
                        problems?: {
                            /** @constant */
                            rule: "definition_invalid";
                            /** @description The member refused, dotted, as `columns.2.name` */
                            path: string;
                            message: string;
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            definition: {
                                /** @constant */
                                schemaVersion: 1;
                                /** Format: uuid */
                                connection: string;
                                parameters: {
                                    name: string;
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                    required: boolean;
                                    list: boolean;
                                    permitted?: {
                                        values: (string | boolean | null)[];
                                    } | {
                                        minimum?: string | boolean | null;
                                        maximum?: string | boolean | null;
                                    };
                                    variation?: {
                                        key: string;
                                        sql: string;
                                    }[];
                                }[];
                                fetch: {
                                    /** @constant */
                                    kind: "sql";
                                    text: string;
                                };
                                columns: {
                                    name: string;
                                    from: {
                                        column: string;
                                    };
                                    type: {
                                        /** @constant */
                                        base: "text";
                                    } | {
                                        /** @constant */
                                        base: "integer";
                                    } | {
                                        /** @constant */
                                        base: "decimal";
                                        precision: number;
                                        scale: number;
                                    } | {
                                        /** @constant */
                                        base: "date";
                                    } | {
                                        /** @constant */
                                        base: "time";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "localDateTime";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "instant";
                                        fraction: number;
                                    } | {
                                        /** @constant */
                                        base: "boolean";
                                    };
                                }[];
                                key: string[];
                                order: "multiset" | {
                                    column: string;
                                    /** @enum {string} */
                                    direction: "ascending" | "descending";
                                }[];
                                /** @enum {string} */
                                empty: "valid" | "invalid";
                                limits: {
                                    rows: number;
                                    bytes: number;
                                    seconds: number;
                                };
                                title: string;
                                description: string;
                                retired: boolean;
                            };
                            /** @description The connection it names, at its latest version */
                            connection: {
                                id: string;
                                name: string;
                                /**
                                 * @description Whose identity the connection runs a query as
                                 * @enum {string}
                                 */
                                identity: "service" | "endUser";
                                retired: boolean;
                            } | null;
                            /** @description Whether the caller may cut its next version: edit on it, and use connection and write SQL on its connection */
                            mayEdit: boolean;
                            /** @description Whether the caller may describe and sample SQL against its connection */
                            mayRun: boolean;
                        };
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createTemplate: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "definition": {
                 *         "schemaVersion": 1,
                 *         "name": "example",
                 *         "theme": "00000000-0000-4000-8000-000000000001",
                 *         "layout": "00000000-0000-4000-8000-000000000001",
                 *         "schemas": [],
                 *         "outline": {
                 *           "sections": []
                 *         },
                 *         "changes": {
                 *           "add": false,
                 *           "remove": false,
                 *           "reorder": false
                 *         }
                 *       }
                 *     }
                 */
                "application/json": {
                    definition: {
                        /** @constant */
                        schemaVersion: 1;
                        name: string;
                        /** Format: uuid */
                        theme: string;
                        /** Format: uuid */
                        layout: string;
                        schemas: {
                            schema: string;
                            requires: string[];
                            /** @enum {string} */
                            level: "document" | "section";
                        }[];
                        outline: {
                            sections: components["schemas"]["createTemplateBody_schema0"][];
                        };
                        changes: {
                            add: boolean;
                            remove: boolean;
                            reorder: boolean;
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Made, at version 0.1 */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {},
                     *       "mayDesign": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's definition (templates.md, "The definition"), as stored */
                        definition: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may change the template */
                        mayDesign: boolean;
                    };
                };
            };
            /** @description `template_unresolved`: a theme, layout, schema or field it names does not resolve */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's definition (templates.md, "The definition"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                            /** @description Whether the caller may change the template */
                            mayDesign: boolean;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the space but may not design in it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such space in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    openStream: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stream: a snapshot, then what happens next */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description token_not_allowed: this takes a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description This environment cannot stream yet */
            503: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listTemplates: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                sort?: "name" | "changed";
                order?: "asc" | "desc";
                spaces?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of templates */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example",
                     *       "total": -9007199254740991,
                     *       "facets": {
                     *         "spaces": []
                     *       }
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                number: string;
                            };
                            /** @description When its latest version was made */
                            changedAt: string;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                        /** @description How many there are with the filters in force, as of the walk this page belongs to */
                        total: number;
                        /** @description Each filter the listing takes, counted with the others in force and its own left out */
                        facets: {
                            spaces: {
                                /** @description What to filter by to leave these */
                                value: string;
                                label: string;
                                count: number;
                            }[];
                        };
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getTemplate: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The template */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {},
                     *       "mayDesign": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's definition (templates.md, "The definition"), as stored */
                        definition: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may change the template */
                        mayDesign: boolean;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description Never answered: a template the caller may not read is not found */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such template in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    recordTemplateVersion: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
                /** @description Use the same key to retry this mutation without applying it twice. */
                "Idempotency-Key"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "openedFrom": "00000000-0000-4000-8000-000000000001",
                 *       "definition": {
                 *         "schemaVersion": 1,
                 *         "name": "example",
                 *         "theme": "00000000-0000-4000-8000-000000000001",
                 *         "layout": "00000000-0000-4000-8000-000000000001",
                 *         "schemas": [],
                 *         "outline": {
                 *           "sections": []
                 *         },
                 *         "changes": {
                 *           "add": false,
                 *           "remove": false,
                 *           "reorder": false
                 *         }
                 *       }
                 *     }
                 */
                "application/json": {
                    openedFrom: string & (unknown & unknown);
                    definition: {
                        /** @constant */
                        schemaVersion: 1;
                        name: string;
                        /** Format: uuid */
                        theme: string;
                        /** Format: uuid */
                        layout: string;
                        schemas: {
                            schema: string;
                            requires: string[];
                            /** @enum {string} */
                            level: "document" | "section";
                        }[];
                        outline: {
                            sections: components["schemas"]["recordTemplateVersionBody_schema0"][];
                        };
                        changes: {
                            add: boolean;
                            remove: boolean;
                            reorder: boolean;
                        };
                    };
                };
            };
        };
        responses: {
            /** @description The template at its latest version: the one cut, or the one before where nothing changed */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    /** @description True when this answer is a replay of an earlier keyed request. */
                    "Idempotent-Replayed"?: "true";
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "space": {
                     *         "id": "example",
                     *         "name": "example"
                     *       },
                     *       "version": {
                     *         "id": "example",
                     *         "number": "example",
                     *         "author": "example",
                     *         "createdAt": "example",
                     *         "note": "example"
                     *       },
                     *       "definition": {},
                     *       "mayDesign": false
                     *     }
                     */
                    "application/json": {
                        id: string;
                        space: {
                            id: string;
                            name: string;
                        };
                        version: {
                            id: string;
                            /** @description `revision.version`, as `0.2` */
                            number: string;
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's definition (templates.md, "The definition"), as stored */
                        definition: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may change the template */
                        mayDesign: boolean;
                    };
                };
            };
            /** @description `template_unresolved`: a theme, layout, schema or field it names does not resolve */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's definition (templates.md, "The definition"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                            /** @description Whether the caller may change the template */
                            mayDesign: boolean;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description The caller may read the template but may not change it */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such template in this environment, or none the caller may read */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description `version_precondition`: the template has a newer version than the one named */
            409: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                        unresolved?: {
                            /** @enum {string} */
                            reference: "theme" | "layout" | "schema" | "field" | "requires" | "conflict";
                            id: string;
                            field?: string;
                            /** @enum {string} */
                            level?: "document" | "section";
                            schemas?: string[];
                        }[];
                        current?: {
                            id: string;
                            space: {
                                id: string;
                                name: string;
                            };
                            version: {
                                id: string;
                                /** @description `revision.version`, as `0.2` */
                                number: string;
                                /** @description The principal who cut it; null for a starter definition */
                                author: string | null;
                                createdAt: string;
                                note: string | null;
                            };
                            /** @description The latest version's definition (templates.md, "The definition"), as stored */
                            definition: {
                                [key: string]: unknown;
                            };
                            /** @description Whether the caller may change the template */
                            mayDesign: boolean;
                        };
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    getTenant: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The environment */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "name": "example"
                     *     }
                     */
                    "application/json": {
                        /** @description What this environment is called, as its own people see it */
                        name: string;
                    };
                };
            };
            /** @description No environment is served at this address */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    listTokens: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
            };
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of the caller's tokens */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "items": [],
                     *       "next": "example"
                     *     }
                     */
                    "application/json": {
                        items: {
                            id: string;
                            /** @description What the person called it, to tell their tokens apart */
                            name: string;
                            /** @description The permissions it may use, of those its creator holds; reading is never masked, so none reads and does nothing else */
                            scopes: ("create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql")[];
                            createdAt: string;
                            /** @description When it stops working; nothing extends a token */
                            expiresAt: string;
                            /** @description When a request last used it, to the minute, or null for never */
                            lastUsedAt: string | null;
                        }[];
                        /** @description The cursor for the next page, or null at the end. A walk is read as of its first page: what changes after it is found by listing again */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description token_not_allowed: tokens are managed with a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    createToken: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                /**
                 * @example {
                 *       "name": "example",
                 *       "scopes": [],
                 *       "expiresAt": "2026-01-01T00:00:00.000Z"
                 *     }
                 */
                "application/json": {
                    /** @description 1 to 80 characters, trimmed */
                    name: string;
                    /** @description The permissions it may use: a mask over its creator's grants, never a grant */
                    scopes: ("create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql")[];
                    /**
                     * Format: date-time
                     * @description When it stops working: required, in the future and at most 365 days away
                     */
                    expiresAt: string;
                };
            };
        };
        responses: {
            /** @description Issued, with its secret, shown this once */
            200: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    /**
                     * @example {
                     *       "id": "example",
                     *       "name": "example",
                     *       "scopes": [],
                     *       "createdAt": "example",
                     *       "expiresAt": "example",
                     *       "lastUsedAt": "example",
                     *       "secret": "example"
                     *     }
                     */
                    "application/json": {
                        id: string;
                        /** @description What the person called it, to tell their tokens apart */
                        name: string;
                        /** @description The permissions it may use, of those its creator holds; reading is never masked, so none reads and does nothing else */
                        scopes: ("create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer" | "use_connection" | "write_sql")[];
                        createdAt: string;
                        /** @description When it stops working; nothing extends a token */
                        expiresAt: string;
                        /** @description When a request last used it, to the minute, or null for never */
                        lastUsedAt: string | null;
                        /** @description The token, awt_ and 43 characters, shown this once: only its hash is kept */
                        secret: string;
                    };
                };
            };
            /** @description invalid_request, or token_expiry_invalid: an expiry past, or more than 365 days away */
            400: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description token_not_allowed: tokens are managed with a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
    revokeToken: {
        parameters: {
            query?: never;
            header?: {
                /** @description Optional caller-supplied trace identifier (up to 128 safe characters). */
                "X-Request-Id"?: string;
            };
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Revoked */
            204: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description token_not_allowed: tokens are managed with a signed-in session, never a token */
            403: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description No such token of the caller's in this environment */
            404: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    /** @description Trace identifier assigned to this request. */
                    "X-Request-Id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
                        /** @description For people. It may change between releases */
                        message: string;
                        /** @description The requirement or rule that refused the request, where one did */
                        rule?: string;
                        /** @description Quote this when reporting a problem */
                        traceId: string;
                    };
                };
            };
        };
    };
}
