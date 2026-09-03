# Known limitations

- Authentication and organization-level RBAC are not implemented. Reviewer IDs
  are recorded but are not backed by an identity provider.
- The MVP uses one default merchant. Multi-tenant isolation is future work.
- Ingestion, reconciliation, and investigation execute synchronously. The demo
  dataset is fast; large production workloads need queued jobs, retries, and live
  progress events.
- Uploaded files must use the five expected CSV filenames and are limited to
  5 MB each. There is no processor-specific mapping UI.
- Investigation requires an Anthropic API key and configured supported model.
  Provider outages produce explicit failures rather than fallback conclusions.
- The deterministic benchmark measures matching and exception detection.
  Live-model resolution accuracy is not claimed by that benchmark; the agent
  regression suite evaluates investigation/policy behavior separately.
- Database setup currently uses Drizzle schema push rather than a reviewed,
  versioned production migration chain.
- The control room has no live job progress, notification system, or historical
  trend charts. These are intentionally outside the P0 buildathon workflow.
- Container definitions are provided, but this WSL environment did not have
  Docker available for an actual image build; native production builds and
  compiled startup were verified instead.
