# Release verification

Verified locally on 4 September 2026 for the Razorpay AI Buildathon submission.

## Automated checks

| Area | Verification | Result |
|---|---|---:|
| API | Production build and Vitest suite | 43 files, 228 tests passed |
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

## Remaining external checks

- Run the two remaining live Gemini regression cases after the free-tier quota
  resets: `MISSING_SETTLEMENT` and `FEE_MISMATCH`.
- Build and start the supplied container definitions on a host with Docker. This
  WSL environment does not expose a Docker daemon, so the equivalent native
  production artifacts were tested here.
- Replace the three placeholder URLs in [Submission](SUBMISSION.md), deploy the
  final revision, and record the demo video.

