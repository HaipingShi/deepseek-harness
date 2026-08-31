# Delegate to an A2A agent

English | [中文](a2a-delegation.zh.md)

## Summary

The default-off A2A integration lets the Harness `subagent` tool send one text task to a reviewed remote agent. It uses the official A2A JavaScript SDK for Agent Card discovery and protocol transport, while the Harness owns the local subagent lifecycle and final result. This first integration is outbound and one-shot: it does not expose the Harness as an A2A server or continue an interrupted remote task.

## Table of Contents

- [Review the destination](#review-the-destination)
- [Enable the provider](#enable-the-provider)
- [Verify a deployment](#verify-a-deployment)
- [Operational limits](#operational-limits)
- [Further Exploration](#further-exploration)

-----

<a id="review-the-destination"></a>
## Review the destination

Fetch and inspect `/.well-known/agent-card.json` before enabling the overlay. Confirm the organization controlling the origin, every supported interface URL, protocol version, security requirements, input and output media, skills, data retention, and downstream providers. An Agent Card is self-declared discovery metadata; parsing it successfully is not security or capability acceptance.

Decide which task data may leave the Harness and use a dedicated remote credential. A remote agent can retain the prompt and can invoke its own tools under its own policy. It receives no local tools or parent history automatically, but the delegated prompt itself can still contain sensitive session material.

<a id="enable-the-provider"></a>
## Enable the provider

Set the reviewed base URL and add the overlay to a composition that already mounts `@deepseek-ai/dsh-subagent` and the model-facing subagent tool:

```sh
export DSH_A2A_AGENT_URL='https://reviewed-agent.example'
pnpm dsh --profile headless \
  --patch apps/cli/config/examples/subagent-a2a/cordis.yml \
  'Delegate a bounded, non-sensitive task to the a2a provider.'
```

The checked-in overlay sends no authentication header. For an authenticated deployment, copy it into deployment-owned configuration and source the exact header from the environment:

```yaml
headers:
  authorization: !!js process.env.DSH_A2A_AUTHORIZATION
```

Non-loopback endpoints must use HTTPS. The provider forwards configured headers both while fetching the Agent Card and while sending the task because those resources commonly share one authentication policy. Requests stay on the `agentUrl` origin unless deployment configuration adds an exact `allowedOrigins` entry. HTTP redirects are rejected.

<a id="verify-a-deployment"></a>
## Verify a deployment

Use a non-sensitive canary task with a deterministic expected phrase. Preserve the remote service logs and the Harness session log, then confirm all of the following separately:

1. The fetched Agent Card and selected interface match the reviewed origin and protocol.
2. The Harness records one subagent start/end pair for the remote provider.
3. The remote service records exactly one accepted request under the intended identity.
4. The parent receives only the expected final text and the mapped terminal reason.
5. Canceling a canary stops local waiting; inspect remote evidence independently before claiming server-side cancellation.

The repository's keyless test performs this round trip against an official-SDK loopback fixture. It does not contact your deployment, validate its identity, or certify A2A conformance.

<a id="operational-limits"></a>
## Operational limits

Only `text/plain` input and output are accepted. The provider does not project images, files, structured data, streaming updates, remote token usage, follow-up turns, card-signature trust, or remote `input-required` and `auth-required` exchanges. A canceled local request may leave server-side work running. Set remote timeout, quota, retention, audit, and idempotency policy accordingly.

<a id="further-exploration"></a>
## Further Exploration

- [A2A provider package](../../../packages/subagent/subagent-a2a/README.md) — exhaustive configuration, state mapping, and limitations.
- [Subagent subsystem](../../subsystems/subagent.md) — shared provider lifecycle and result semantics.
- [A2A Protocol](https://a2a-protocol.org/latest/) and [official JavaScript SDK](https://github.com/a2aproject/a2a-js) — upstream protocol and implementation references.
