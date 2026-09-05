# Known limitations

- Authentication and organization-level RBAC are not implemented. Reviewer IDs
  are recorded but are not backed by an identity provider.
- The MVP uses one default merchant. Multi-tenant isolation is future work.
- Ingestion, reconciliation, and investigation execute synchronously. The demo
  dataset is fast; large production workloads need queued jobs, retries, and live
  progress events.
- Uploaded files must use the five expected CSV filenames and are limited to
  5 MB each. There is no processor-specific mapping UI.
- Investigation requires an API key and supported model for the selected Anthropic
  or Gemini provider. Quota and provider outages are labeled explicitly; the UI
  preserves deterministic evidence and routes the case to human review without
  fabricating an AI conclusion.
- The deterministic benchmark measures matching and exception detection.
  Live-model resolution accuracy is not claimed by that benchmark; the agent
  regression suite evaluates investigation/policy behavior separately.
- Database setup currently uses Drizzle schema push rather than a reviewed,
  versioned production migration chain.
- The control room has no live job progress, notification system, or historical
  trend charts. These are outside the current MVP workflow.
- Container definitions are provided, but this WSL environment did not have
  Docker available for an actual image build; native production builds and
  compiled standalone startup were verified instead. The exact checks are in
  [Release verification](RELEASE_VERIFICATION.md).
