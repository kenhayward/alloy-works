// Stand-in cloud metadata endpoint. In a real cloud this sits at 169.254.169.254 and hands out
// instance credentials to anything that can reach it - which is why case 1 treats reaching it as a
// breach. Here it lives on aw-dc-platform at a declared address; the fake credential is obviously
// fake and never real.
import http from 'node:http';
const PORT = Number(process.env.PORT || 80);
const server = http.createServer((req, res) => {
  if (
    req.url.includes('meta-data') ||
    req.url.includes('iam') ||
    req.url === '/' ||
    req.url.includes('token')
  ) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    // A blatantly fake stand-in credential; reaching this at all is the finding.
    res.end(
      'AKIAFAKE-SPIKE-metadata-credential-DO-NOT-USE\nSecretAccessKey: fake/stand-in/metadata\n',
    );
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
server.listen(PORT, '0.0.0.0', () => console.log(`[metadata] listening on ${PORT}`));
