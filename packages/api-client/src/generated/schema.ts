export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Whether the service is up. Answers on any hostname */
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
        /** The caller's own answer for every permission on a target */
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
        /** Every permission a principal has on a target, and the grants and level behind each */
        get: operations["explainAccess"];
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
        /** The components the caller may read, a page at a time */
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
        /** A component at its latest version, whether the caller may edit it, and its lock */
        get: operations["getComponent"];
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
        /** Save the session's whole content as an iteration */
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
        /** Claim the lock for an editing session, or move it to this one */
        post: operations["claimLock"];
        /** Done editing: cut a version of what changed, then release the lock */
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
        get?: never;
        put?: never;
        /** Save version: cut a version from the session's latest iteration */
        post: operations["cutVersion"];
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
        /** The grants made at one level, a page at a time */
        get: operations["listGrants"];
        put?: never;
        /** Grant a role to a person at one level, as an allow or a denial */
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
        /** Remove a grant, unless it is the last that keeps this environment administered */
        delete: operations["removeGrant"];
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
        /** Who is signed in, and to which environment */
        get: operations["getMe"];
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
        /** The people a grant can name: everybody who has signed in to this environment */
        get: operations["listPrincipals"];
        put?: never;
        post?: never;
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
        /** The roles a grant can name, with what each holds, a page at a time */
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
        /** Ask for a sample PDF of this environment, which a worker makes */
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
        /** How a sample is coming along, and where to fetch it */
        get: operations["getSample"];
        put?: never;
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
        /** Begin signing in with a Google account, by way of the one sign-in address */
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
        /** Where Google returns, at the sign-in address only; hands the sign-in to its environment */
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
        /** Redeems the one-time code from the sign-in address, and signs in */
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
        /** Begin signing in with the organisation's identity provider */
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
        /** Where the identity provider returns; completes the sign-in */
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
        /** End this session, wherever it is in use */
        post: operations["signOut"];
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
        /** What is happening in this environment, as it happens */
        get: operations["openStream"];
        put?: never;
        post?: never;
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
        /** The environment this address serves, as its sign-in page shows it */
        get: operations["getTenant"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: never;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The service is up */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @constant */
                        status: "ok";
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every permission, allowed or not */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        target: string;
                        permissions: {
                            /** @enum {string} */
                            permission: "read" | "create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer";
                            allowed: boolean;
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every permission, with its explanation */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        principal: string;
                        target: string;
                        permissions: {
                            /** @enum {string} */
                            permission: "read" | "create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer";
                            allowed: boolean;
                            /**
                             * @description capped: an external principal, refused whatever the grants say
                             * @enum {string}
                             */
                            reason: "allowed" | "denied" | "not_granted" | "capped";
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
                                expiresAt: string | null;
                            }[];
                        }[];
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of components */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            query?: never;
            header?: never;
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
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
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path: {
                id: string & (unknown & unknown);
                session: string & (unknown & unknown);
                sequence: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The version the session opened from, which must be the latest */
                    openedFrom: string & (unknown & unknown);
                    /** @description The whole content document */
                    content: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            /** @description Accepted, and the lock extended */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
            /** @description The content is not a document the model accepts */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
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
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
                            createdAt: string;
                            note: string | null;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
                            createdAt: string;
                            note: string | null;
                        };
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description The principal who cut it */
                            author: string;
                            createdAt: string;
                            note: string | null;
                        };
                        latest?: number;
                    };
                };
            };
            /** @description An error, in the one shape every error takes */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of grants */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description The role granted */
                    role: string & (unknown & unknown);
                    /** @description Who it is granted to: a principal. Granting to a group is not offered yet */
                    subject: {
                        principal: string & (unknown & unknown);
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
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description The grant removed */
                        removed: string;
                    };
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The signed-in principal */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of people */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of roles */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            permissions: ("read" | "create" | "edit" | "comment" | "suggest" | "approve" | "publish" | "design" | "manage_definitions" | "administer")[];
                        }[];
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                    };
                };
            };
            /** @description A cursor this listing did not give out, or a limit outside 1 to 100 */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Asked for; a worker will make it */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description This environment does not permit signing in this way */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The sign-in could not be completed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The sign-in could not be completed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description This environment does not permit signing in this way */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
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
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description The sign-in could not be completed */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Signed out, everywhere this session was in use */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The stream: a snapshot, then what happens next */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            /** @description No session, or not one this environment issued */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The environment */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description What this environment is called, as its own people see it */
                        name: string;
                    };
                };
            };
            /** @description No environment is served at this address */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
