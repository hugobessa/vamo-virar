#!/usr/bin/env node
// Points the Railway services at the images a release just published and
// waits for each deployment to come up. Run by .github/workflows/release.yml
// after the images are pushed; does nothing without RAILWAY_TOKEN.
//
// Environment:
//   RAILWAY_TOKEN           a Railway *project* token for the environment to deploy
//   IMAGE_TAG               the release tag, e.g. v0.3.1
//   REGISTRY                e.g. ghcr.io/hugobessa
//   RAILWAY_NODE_SERVICE    service running community-node (default: node)
//   RAILWAY_PORTAL_SERVICE  service running the portal (default: portal; "" to skip)
//
// Usage: node scripts/deploy-railway.mjs

const API = "https://backboard.railway.com/graphql/v2";
const DONE = new Set(["SUCCESS"]);
const BROKEN = new Set(["FAILED", "CRASHED", "REMOVED", "SKIPPED"]);

export async function deploy({ env = process.env, fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 15 * 60_000 } = {}) {
  const token = env.RAILWAY_TOKEN?.trim();
  if (!token) {
    log("RAILWAY_TOKEN is not set: skipping the Railway deploy.");
    return [];
  }
  const tag = env.IMAGE_TAG?.trim();
  const registry = env.REGISTRY?.trim();
  if (!tag || !registry) throw new Error("IMAGE_TAG and REGISTRY are required");
  if (tag.includes("-")) {
    log(`${tag} is a pre-release: skipping the Railway deploy.`);
    return [];
  }

  async function gql(query, variables = {}) {
    const res = await fetchImpl(API, {
      method: "POST",
      headers: { "content-type": "application/json", "Project-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.errors?.length) {
      throw new Error(`Railway API: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    }
    return body.data;
  }

  const { projectToken } = await gql("query { projectToken { projectId environmentId } }");
  const { projectId, environmentId } = projectToken;
  const { project } = await gql("query ($id: String!) { project(id: $id) { services { edges { node { id name } } } } }", { id: projectId });
  const services = new Map(project.services.edges.map((e) => [e.node.name, e.node.id]));

  const targets = [[env.RAILWAY_NODE_SERVICE ?? "node", `${registry}/community-node:${tag}`]];
  const portal = env.RAILWAY_PORTAL_SERVICE ?? "portal";
  if (portal) targets.push([portal, `${registry}/vamo-virar-portal:${tag}`]);

  const results = [];
  // The node first: the portal talks to it.
  for (const [name, image] of targets) {
    const serviceId = services.get(name);
    if (!serviceId) throw new Error(`no service named "${name}" in the Railway project (has: ${[...services.keys()].join(", ")})`);
    await gql(
      "mutation ($environmentId: String!, $serviceId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(environmentId: $environmentId, serviceId: $serviceId, input: $input) }",
      { environmentId, serviceId, input: { source: { image } } },
    );
    const { serviceInstanceDeployV2: deploymentId } = await gql(
      "mutation ($environmentId: String!, $serviceId: String!) { serviceInstanceDeployV2(environmentId: $environmentId, serviceId: $serviceId) }",
      { environmentId, serviceId },
    );
    log(`${name}: deploying ${image} (deployment ${deploymentId})`);
    const started = Date.now();
    let status = "";
    for (;;) {
      ({ deployment: { status } } = await gql("query ($id: String!) { deployment(id: $id) { status } }", { id: deploymentId }));
      if (DONE.has(status) || BROKEN.has(status)) break;
      if (Date.now() - started > timeoutMs) throw new Error(`${name}: still ${status} after ${timeoutMs / 60_000} minutes`);
      await sleep(10_000);
    }
    if (!DONE.has(status)) throw new Error(`${name}: deployment ${deploymentId} ended ${status}; see the Railway dashboard`);
    log(`${name}: ${image} is live`);
    results.push({ name, image, deploymentId });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  deploy().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
