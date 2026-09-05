# Release verification

Verification snapshot captured locally on 4 September 2026.
The same build, test, and browser journey is enforced by the repository's
`Verify` workflow on every push to `main` and every pull request. It deliberately
uses no model API key: deterministic behavior and graceful provider fallback must
remain testable without spending live-model quota. The workflow provisions a
fresh PostgreSQL service and seeds both integration fixture datasets before the
test suite, preventing results from depending on a developer's existing database.
CI uses the checked-in demo ground truth for its fast six-class benchmark; the
larger 5,000-payment release benchmark remains the separately reported performance
measurement.

## Automated checks

| Area | Verification | Result |
|---|---|---:|
| API | Production build and Vitest suite | 43 files, 232 tests passed |
| Web | TypeScript check and production build | Passed |
| Browser flow | Playwright control-room journey | Passed |
| Repository | Tracked-file credential scan | No API keys detected |
| Patch quality | `git diff --check` | Passed |

## Production runtime smoke

The compiled API and Next.js standalone server were started together against the
local PostgreSQL database. The smoke check verified:

- the API health endpoint returned successfully and exposed the configured Gemini
  provider and model metadata;
- the control room returned HTTP 200 with the expected security headers;
- server-rendered HTML contained the operational dashboard state; and
- the generated static CSS asset returned HTTP 200.

The web production script runs the generated standalone server. The Dockerfile
uses the same artifact, copies static assets into it during the build, and runs as
the unprivileged `node` user.

## Reconciliation benchmark

A fresh deterministic benchmark processed 5,855 financial records, including
5,000 payments and 125 injected exceptions across six categories.

| Measure | Result |
|---|---:|
| Match rate | 98.05% |
| Precision | 100.00% (125/125) |
| Recall | 100.00% (125/125) |
| Reconciliation time | 1,501 ms |
| Throughput | 3,901 records/sec |

These figures measure deterministic matching and detection, not model quality.
See [Benchmark results](BENCHMARK_RESULTS.md) for methodology and caveats.

## Live Gemini verification

All six deterministic exception classes produced schema-validated results with
`gemini-3.6-flash` across local live-model runs on 4–5 September 2026.

| Exception | Root cause | Recommended action | Confidence | Effective control |
|---|---|---|---:|---|
| `UNKNOWN_ADJUSTMENT` | `unknown_adjustment` | `create_review_case` | 95% | Human approval required |
| `DUPLICATE_REFUND` | `duplicate_refund` | `create_review_case` | 100% | Human approval required |
| `BANK_CREDIT_MISMATCH` | `bank_credit_mismatch` | `propose_adjustment` | 100% | Human approval required |
| `AMBIGUOUS_MATCH` | `ambiguous_match` | `create_review_case` | 95% | Human approval required |
| `MISSING_SETTLEMENT` | `missing_settlement` | `rerun_reconciliation` | 100% | Human review required by deterministic amount/risk policy |
| `FEE_MISMATCH` | `fee_mismatch` | `propose_adjustment` | 100% | Human approval required |

Regression scoring evaluates approval at the effective system boundary: a model
preference cannot fail open when deterministic policy mandates review. Model
identity, root cause, action classification, and safe-unresolved behavior remain
independently checked.

## Environment limitation

- Build and start the supplied container definitions on a host with Docker. This
  WSL environment does not expose a Docker daemon, so the equivalent native
  production artifacts were tested here.
