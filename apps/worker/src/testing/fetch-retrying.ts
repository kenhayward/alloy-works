// A host's passing 5xx or a dropped connection says nothing about the code under test, so fetching a
// pinned tool tries four times before the step fails. A 4xx is an answer, and is handed back at once.
const ATTEMPTS = 4;
const PAUSE_MS = 10_000;

interface Seams {
  fetcher?: (url: string) => Promise<Response>;
  wait?: (ms: number) => Promise<unknown>;
}

export const fetchRetrying = async (url: string, seams: Seams = {}): Promise<Response> => {
  const fetcher = seams.fetcher ?? ((target: string) => fetch(target));
  const wait = seams.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetcher(url);
      if (response.status < 500 || attempt === ATTEMPTS) return response;
      console.log(
        `${url} answered ${response.status} (attempt ${attempt} of ${ATTEMPTS}); retrying`,
      );
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
      console.log(`${url} did not answer (attempt ${attempt} of ${ATTEMPTS}); retrying`);
    }
    await wait(PAUSE_MS);
  }
};
