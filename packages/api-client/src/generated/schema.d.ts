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
