import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { completeAtStandIn } from '@alloy-works/stand-in-idp/testing';
import type { TestProject } from 'vitest/node';
import { API, IDP, idpFromNode, SERVICE } from './addresses.js';
import { launchPinned } from './launch.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The browser context's storage state after signing in as Ada, which each test's context starts from. */
    storageState: string;
    /** Ada's session cookie, `name=value`, for the fixtures a test makes through the API from Node. */
    session: string;
  }
}

async function untilReady(within = 120_000): Promise<void> {
  const stop = Date.now() + within;
  for (;;) {
    try {
      const response = await fetch(`${API}/health`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > stop) throw new Error(`${API} never came up`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Signs in as the stand-in's Ada from Node, as the end-to-end suite does, returning the session cookie. */
async function signInFromNode(): Promise<string> {
  const started = await fetch(`${API}/v1/sign-in/organisation`, { redirect: 'manual' });
  const attempt = started.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_signin='));
  const sentTo = started.headers.get('location');
  if (!attempt || !sentTo) throw new Error(`signing in did not start: ${started.status}`);
  const back = await completeAtStandIn(sentTo, 'ada', IDP, idpFromNode());
  const finished = await fetch(`${API}${back.pathname}${back.search}`, {
    headers: { cookie: attempt },
    redirect: 'manual',
  });
  const session = finished.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .find((pair) => pair.startsWith('__Host-aw_session='));
  if (!session) throw new Error(`signing in did not finish: ${finished.status}`);
  return session;
}

/**
 * Signs in once per run, in the browser, the way a person does (the W13 plan's B-B): the renderer's
 * own **Sign in**, the service's redirect to the stand-in, Ada chosen from the stand-in's page, and the
 * redirect back. What the context holds then is saved, and every test's fresh context starts from it,
 * so nothing one test leaves in a page reaches the next. Node signs in too, for the API.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  await untilReady();
  const session = await signInFromNode();

  const directory = await mkdtemp(join(tmpdir(), 'alloy-browser-'));
  const storageState = join(directory, 'ada.json');
  const browser = await launchPinned();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(SERVICE);
    await page.getByRole('link', { name: 'Sign in' }).click();
    await page.getByRole('link', { name: /^Ada / }).click();
    // Back at the renderer, which names who is signed in.
    await page.getByRole('button', { name: /Ada/ }).waitFor();
    if (new URL(page.url()).origin !== new URL(SERVICE).origin) {
      throw new Error(`signing in in the browser ended at ${page.url()}`);
    }
    await context.storageState({ path: storageState });
  } finally {
    await browser.close();
  }

  project.provide('storageState', storageState);
  project.provide('session', session);
  return async () => {
    await rm(directory, { recursive: true, force: true });
  };
}
