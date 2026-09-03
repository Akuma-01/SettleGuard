# Benchmark results

## Latest measured run

Command: `cd apps/api && npm run benchmark`

| Measure | Result |
|---|---:|
| Payments | 5,000 |
| Total financial records | 5,855 |
| Match rate | 98.05% |
| Detected exceptions | 125 |
| Ground-truth exceptions | 125 |
| True positives | 125 |
| Precision | 100.00% |
| Recall | 100.00% |
| Reconciliation duration | 1,663 ms |
| Throughput | 3,521 records/sec |

Exception counts are ground truth / detected / correctly matched:

| Exception type | Ground truth | Detected | Matched |
|---|---:|---:|---:|
| Missing settlement | 20 | 20 | 20 |
| Fee mismatch | 25 | 25 | 25 |
| Unknown adjustment | 20 | 20 | 20 |
| Duplicate refund | 20 | 20 | 20 |
| Bank credit mismatch | 25 | 25 | 25 |
| Ambiguous match | 15 | 15 | 15 |

## Methodology

The generator records every injected exception in `ground_truth.json`. Each
benchmark invocation creates a fresh batch, ingests all five CSV sources, times
deterministic reconciliation, resolves external ground-truth IDs to database IDs,
and compares detected exceptions field by field. The command exits non-zero if
precision or recall drops below 100%.

Throughput covers reconciliation only, not CSV ingestion, network transport, or
AI investigation. Runtime varies by hardware and database state; rerun the
command when presenting performance from another environment.

Resolution quality is evaluated separately by the six-class agent regression
suite because it measures investigation and policy behavior rather than
deterministic exception detection. No live-model score is claimed without a
configured provider key and a preserved run artifact.
