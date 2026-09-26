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
    "/v1/asset-uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** An upload the caller made: its state, and its asset version once ready */
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
        /** Fill an upload with its image's bytes, which are checked before anything may place it */
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
        /** An asset version's recorded properties */
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
        /** An asset version's image, as it was uploaded */
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
    "/v1/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The documents the caller may read */
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
        /** A document at its latest version, and whether the caller may restructure it */
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
        /** What each occurrence of the latest version contributes, as the caller is shown it */
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
        /** The latest version's numbering, as the caller is shown it */
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
        /** Apply one operation to the outline, as one version */
        post: operations["editOutline"];
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
        /** The document's publications the caller may read, newest first */
        get: operations["listPublications"];
        put?: never;
        /** Publish the latest version of this document */
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
        /** The text of every component the latest version places, as the caller is shown it */
        get: operations["getDocumentTexts"];
        put?: never;
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
    "/v1/invitations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every invitation, waiting or accepted, a page at a time */
        get: operations["listInvitations"];
        put?: never;
        /** Invite an address, so the person can be granted access before they first sign in */
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
        /** Withdraw an invitation nobody has accepted, with its person and their grants */
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
        /** The people a grant can name: everybody who has signed in or been invited */
        get: operations["listPrincipals"];
        put?: never;
        post?: never;
        delete?: never;
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
        /** A publish the caller asked for: its state, every failure, and its publication once made */
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
        /** Every publication the caller may read, of every document, newest first */
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
        /** A publication: its record, and a link to each output */
        get: operations["getPublication"];
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
    "/v1/spaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The spaces the caller may read, and whether they may create a component in each */
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
        /** Make an upload in this space, with the description its image will carry */
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
        /** The component types a component created here may take, with the default marked */
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
        /** Create a component in this space, at version 0.1 */
        post: operations["createComponent"];
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
        /** Create a document in this space, at version 0.1, with an empty outline */
        post: operations["createDocument"];
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
    getAssetUpload: {
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
            /** @description The upload */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    putAssetUploadBytes: {
        parameters: {
            query?: never;
            header?: never;
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
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            /** @description No such upload, or one somebody else made */
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
            /** @description `asset_upload_filled`: the upload already has its bytes */
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
            /** @description `asset_too_large`: more pixels than an image may have, which refuses the upload; or more bytes, read no further, which leaves it awaiting a smaller file */
            413: {
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
            /** @description `asset_bytes_expected`: the body is not application/octet-stream. Nothing is read, and the upload still awaits its bytes */
            415: {
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
    getAssetVersion: {
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
            /** @description The asset version */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    getAssetVersionContent: {
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
            /** @description The bytes, never sniffed and never run: a version never changes, so they may be kept for a year */
            200: {
                headers: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                spaces?: string;
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
                        /** @description The cursor for the next page, or null at the end */
                        next: string | null;
                        /** @description How many there are in all, in the spaces asked for */
                        total: number;
                        /** @description Every space the caller may read a component in, with how many: what to filter by */
                        spaces: {
                            id: string;
                            name: string;
                            count: number;
                        }[];
                    };
                };
            };
            /** @description A cursor this listing did not give out, a limit outside 1 to 100, or spaces that are not a list of ids */
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
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
    listDocuments: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The documents */
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
    getDocument: {
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
            /** @description The document */
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The environment's layout at its latest version, which is the version a publish requested now would be made under (publishing.md, "The layout") */
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
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2) */
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    getContributions: {
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
            /** @description Each occurrence and its contributions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    getNumbering: {
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
            /** @description The numbering table */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    editOutline: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
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
                        /** @description Empty: nothing may be written into a node's values until TPL-054 says what they hold */
                        values?: Record<string, never>;
                    };
                };
            };
        };
        responses: {
            /** @description Applied, or nothing changed: the document at its latest version */
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The environment's layout at its latest version, which is the version a publish requested now would be made under (publishing.md, "The layout") */
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
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2) */
                            words: {
                                [key: string]: unknown;
                            };
                            /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                            formats: string[];
                        };
                    };
                };
            };
            /** @description outline_invalid: the operation does not apply to the latest outline; or invalid_request: a body this route does not accept */
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
                            /** @description Whether the caller may restructure the outline */
                            mayEdit: boolean;
                            /** @description Whether the caller may publish the document */
                            mayPublish: boolean;
                            /** @description The environment's layout at its latest version, which is the version a publish requested now would be made under (publishing.md, "The layout") */
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
                                /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2) */
                                words: {
                                    [key: string]: unknown;
                                };
                                /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                                formats: string[];
                            };
                        };
                        /** @description outline_invalid: why the operation does not apply */
                        reason?: string;
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
            /** @description The caller may read the document but may not edit it */
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
            /** @description No such document in this environment, or none the caller may read */
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
            /** @description version_precondition: the outline has changed since it was read */
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
                            /** @description Whether the caller may restructure the outline */
                            mayEdit: boolean;
                            /** @description Whether the caller may publish the document */
                            mayPublish: boolean;
                            /** @description The environment's layout at its latest version, which is the version a publish requested now would be made under (publishing.md, "The layout") */
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
                                /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2) */
                                words: {
                                    [key: string]: unknown;
                                };
                                /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                                formats: string[];
                            };
                        };
                        /** @description outline_invalid: why the operation does not apply */
                        reason?: string;
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
    listPublications: {
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
            /** @description The publications */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
            /** @description Never answered: a document the caller may read is one whose listing they may read */
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
            /** @description No such document in this environment, or none the caller may read */
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
    requestPublication: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        document: string;
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        failures: {
                            /** @enum {string} */
                            stage: "resolve" | "compose" | "engine" | "store";
                            /** @enum {string} */
                            code: "occurrence_unreadable" | "occurrence_unresolved" | "asset_unreadable" | "title_not_publishable" | "block_not_publishable" | "inline_not_publishable" | "style_missing" | "language_not_publishable" | "glyph_missing" | "character_disallowed" | "nothing_to_publish" | "layout_glyph_missing" | "layout_language_not_publishable" | "code_glyph_missing" | "line_too_wide" | "table_without_caption" | "table_header_spans_body" | "figure_without_caption" | "alternative_missing" | "caption_too_long" | "image_too_wide" | "image_in_caption" | "footnote_not_publishable_here" | "footnote_anchor_unresolved" | "footnote_empty" | "footnote_unnumbered" | "cross_reference_unresolved" | "cross_reference_form_unavailable" | "equation_unrenderable" | "equation_unnumbered" | "math_glyph_missing" | "style_not_applicable" | "typeface_not_embeddable" | "typeface_unavailable" | "continuation_words_missing" | "word_not_yet" | "format_unsupported" | "numbering_not_in_word" | "list_not_in_word" | "cross_reference_not_in_word" | "engine_failed" | "store_failed";
                            /** @description The outline node it concerns */
                            node: string | null;
                            /** @description The block within that node's component */
                            block: string | null;
                            /** @description The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read */
                            detail: string | null;
                        }[];
                        /** @description The publication it made, once done */
                        publication: string | null;
                    };
                };
            };
            /** @description `format_unsupported`: a format the layout does not make; `layout_language`: the document is not in its layout's language; `page_reference_without_pdf`: the document cites a page and the PDF was not asked for */
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
            /** @description The caller may read the document but may not publish it */
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
            /** @description No such document in this environment, or none the caller may read */
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
            /** @description `version_precondition`: the document has a newer version than the one named */
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
    getDocumentTexts: {
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
            /** @description Each occurrence, and each version it resolved to with its content */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                        }[];
                        /** @description Each version an occurrence resolved to, once, however many occurrences name it */
                        versions: {
                            id: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    listGrants: {
        parameters: {
            query: {
                level: string;
                cursor?: string;
                limit?: string;
                spaces?: string;
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
    listInvitations: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: string;
                spaces?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A page of invitations */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
            /** @description The caller may not administer this environment */
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
    invite: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
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
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    withdrawInvitation: {
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
            /** @description Withdrawn */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description The invitation withdrawn, with its person and their grants */
                        withdrawn: string;
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
            /** @description The caller may not administer this environment */
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
            /** @description No such invitation in this environment */
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
            /** @description invitation_accepted */
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
                spaces?: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    getPublicationRequest: {
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
            /** @description The request */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        document: string;
                        /** @enum {string} */
                        state: "queued" | "done" | "failed";
                        failures: {
                            /** @enum {string} */
                            stage: "resolve" | "compose" | "engine" | "store";
                            /** @enum {string} */
                            code: "occurrence_unreadable" | "occurrence_unresolved" | "asset_unreadable" | "title_not_publishable" | "block_not_publishable" | "inline_not_publishable" | "style_missing" | "language_not_publishable" | "glyph_missing" | "character_disallowed" | "nothing_to_publish" | "layout_glyph_missing" | "layout_language_not_publishable" | "code_glyph_missing" | "line_too_wide" | "table_without_caption" | "table_header_spans_body" | "figure_without_caption" | "alternative_missing" | "caption_too_long" | "image_too_wide" | "image_in_caption" | "footnote_not_publishable_here" | "footnote_anchor_unresolved" | "footnote_empty" | "footnote_unnumbered" | "cross_reference_unresolved" | "cross_reference_form_unavailable" | "equation_unrenderable" | "equation_unnumbered" | "math_glyph_missing" | "style_not_applicable" | "typeface_not_embeddable" | "typeface_unavailable" | "continuation_words_missing" | "word_not_yet" | "format_unsupported" | "numbering_not_in_word" | "list_not_in_word" | "cross_reference_not_in_word" | "engine_failed" | "store_failed";
                            /** @description The outline node it concerns */
                            node: string | null;
                            /** @description The block within that node's component */
                            block: string | null;
                            /** @description The kind of block or mark, the style, the language tag, or the character as U+XXXX; null where the place is one the publisher may not read */
                            detail: string | null;
                        }[];
                        /** @description The publication it made, once done */
                        publication: string | null;
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
            /** @description No such request, or one somebody else asked for */
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
    listPublicationsEverywhere: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The publications */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
    getPublication: {
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
            /** @description The publication */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
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
                            /** @description What Word could not carry: a face it set in another, that page numbers cite the PDF, that it carries no page-cited output */
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    listRoles: {
        parameters: {
            query: {
                level: string;
                cursor?: string;
                limit?: string;
                spaces?: string;
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
    listSpaces: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The spaces */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            /** @description Whether the caller may create a component in this space */
                            mayCreate: boolean;
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
    createAssetUpload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
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
                    [name: string]: unknown;
                };
                content: {
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Stable and machine-readable: branch on this, never on the message */
                        code: string;
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
    listComponentTypes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The component types */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            name: string;
                            /** @description The environment's default, preselected (MET-011, MET-012) */
                            isDefault: boolean;
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
            /** @description The caller may read the space but may not create in it */
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
            /** @description No such space in this environment, or none the caller may read */
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
    createComponent: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
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
                    };
                };
            };
            /** @description The title, language or direction is not one the content model accepts */
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
            /** @description The caller may read the space but may not create in it */
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
            /** @description No such space in this environment, or none the caller may read */
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
            /** @description component_type_missing: no such component type in this environment */
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
    createDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                space: string & (unknown & unknown);
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    language: string;
                    /** @enum {string} */
                    direction: "ltr" | "rtl";
                };
            };
        };
        responses: {
            /** @description Created, at version 0.1 */
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
                            /** @description The principal who cut it; null for a starter definition */
                            author: string | null;
                            createdAt: string;
                            note: string | null;
                        };
                        /** @description The latest version's outline document (structure.md), as the caller is shown it: a reference to a component the caller may not read carries `component: null`, and a pinned one `mode.version: null`; everything else is as stored. Empty when the stored outline does not read */
                        outline: {
                            [key: string]: unknown;
                        };
                        /** @description Whether the caller may restructure the outline */
                        mayEdit: boolean;
                        /** @description Whether the caller may publish the document */
                        mayPublish: boolean;
                        /** @description The environment's layout at its latest version, which is the version a publish requested now would be made under (publishing.md, "The layout") */
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
                            /** @description The layout's own words - the contents' title, the draft notice, and, both or neither, what a relative cross-reference prints for above and below (cross-references 2, ruling R9), and `continued`, the words a continued table's label adds after its label, which a layout read at schema 3 or before has none of (themes 2, ruling R2) */
                            words: {
                                [key: string]: unknown;
                            };
                            /** @description The formats this layout makes, `pdf` first and then `docx` where it declares a Word page: what a publish may ask for (Word 1, ruling R14) */
                            formats: string[];
                        };
                    };
                };
            };
            /** @description The title, language or direction is not one an outline accepts */
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
            /** @description The caller may read the space but may not create in it */
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
            /** @description No such space in this environment, or none the caller may read */
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
