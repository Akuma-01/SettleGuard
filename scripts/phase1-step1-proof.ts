
// ============================================================
// [1] Domain types
// ============================================================

type PaymentStatus = "captured" | "failed" | "pending";
type PaymentMethod = "card" | "upi" | "netbanking" | "wallet";

interface Payment {
	id: string;
	orderId: string;
	amountPaise: number;
	currency: "INR";
	status: PaymentStatus;
	capturedAt: string;
	method: PaymentMethod;
	merchantReference: string;
}

interface Refund {
	id: string;
	paymentId: string;
	amountPaise: number;
	status: "processed";
	createdAt: string;
}

interface Adjustment {
	id: string;
	settlementId: string;
	amountPaise: number; // negative = deduction from settlement
	type: string;
	description: string;
	sourceReference: string | null; // null = no known record explains it
}

interface Settlement {
	id: string;
	grossAmountPaise: number;
	feeAmountPaise: number; // the fee AS REPORTED by the settlement file (may be wrong)
	taxAmountPaise: number; // tax computed on the reported fee
	adjustmentAmountPaise: number; // sum of adjustments applied
	reportedNetPaise: number;
	settledAt: string;
	bankReference: string;
}

interface BankTransaction {
	id: string;
	amountPaise: number;
	direction: "credit";
	postedAt: string;
	reference: string;
	description: string;
}

type ExceptionType = "FEE_MISMATCH" | "DUPLICATE_REFUND" | "UNKNOWN_ADJUSTMENT";
type Severity = "low" | "medium" | "high";

interface ExceptionRecord {
	id: string;
	type: ExceptionType;
	amountAtRiskPaise: number;
	relatedRecordIds: string[];
	severity: Severity;
	status: "OPEN";
	evidence: string;
}

// ============================================================
// Seeded RNG — deterministic so the dataset is reproducible.
// (mulberry32: small, fast, good enough for synthetic test data)
// ============================================================

function mulberry32(seed: number) {
	let a = seed;
	return function rand(): number {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SEED = 42;
const rand = mulberry32(SEED);

// ============================================================
// Money helpers — integer paise ONLY, never floats.
// ============================================================

function inr(paise: number): string {
	const rupees = paise / 100;
	const sign = rupees < 0 ? "-" : "";
	return `${sign}\u20B9${Math.abs(rupees).toLocaleString("en-IN", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

// Razorpay-style fee policy: 2% of transaction value + 18% GST on the fee.
const FEE_PERCENT = 0.02;
const GST_ON_FEE_PERCENT = 0.18;

function calculateFeePaise(amountPaise: number): number {
	return Math.round(amountPaise * FEE_PERCENT);
}
function calculateTaxPaise(feePaise: number): number {
	return Math.round(feePaise * GST_ON_FEE_PERCENT);
}

// ============================================================
// [2] Generate 50 valid payments + organic refunds
// ============================================================

const PAYMENT_COUNT = 50;
const METHODS: PaymentMethod[] = ["card", "upi", "netbanking", "wallet"];

function randomAmountPaise(): number {
	// Between ₹150.00 and ₹9,500.00
	return Math.floor(rand() * (950000 - 15000) + 15000);
}

const payments: Payment[] = [];
for (let i = 1; i <= PAYMENT_COUNT; i++) {
	const idNum = 1000 + i;
	const day = String((i % 20) + 1).padStart(2, "0");
	payments.push({
		id: `PAY_${idNum}`,
		orderId: `ORDER_${idNum}`,
		amountPaise: randomAmountPaise(),
		currency: "INR",
		status: "captured",
		capturedAt: `2026-08-${day}T10:00:00Z`,
		method: METHODS[Math.floor(rand() * METHODS.length)]!,
		merchantReference: `MREF_${idNum}`,
	});
}

// ~20% of payments get a refund (partial or full) — organic, not an error.
const refunds: Refund[] = [];
let refundSeq = 1;
for (const p of payments) {
	if (rand() < 0.2) {
		const isFull = rand() < 0.5;
		const amountPaise = isFull
			? p.amountPaise
			: Math.round(p.amountPaise * (0.3 + rand() * 0.4));
		refunds.push({
			id: `REF_${500 + refundSeq}`,
			paymentId: p.id,
			amountPaise,
			status: "processed",
			createdAt: p.capturedAt,
		});
		refundSeq++;
	}
}

// ============================================================
// [5a] Inject known error #1 — DUPLICATE_REFUND
// The exact same refund gets recorded twice under two different IDs.
// ============================================================

const originalRefund = refunds[0]!;
const duplicateRefund: Refund = {
	...originalRefund,
	id: `REF_${500 + refundSeq}`,
};
refunds.push(duplicateRefund);

// ============================================================
// [3] Produce one settlement
// True refund total is de-duplicated: two identical refund ROWS
// still represent only one real refund until investigated.
// ============================================================

const capturedTotalPaise = payments.reduce((sum, p) => sum + p.amountPaise, 0);

const seenRefundKeys = new Set<string>();
let trueRefundTotalPaise = 0;
for (const r of refunds) {
	const key = `${r.paymentId}|${r.amountPaise}|${r.createdAt}`;
	if (!seenRefundKeys.has(key)) {
		seenRefundKeys.add(key);
		trueRefundTotalPaise += r.amountPaise;
	}
}

const correctFeePaise = calculateFeePaise(capturedTotalPaise);
const correctTaxPaise = calculateTaxPaise(correctFeePaise);

// The settlement SHOULD look like this if nothing were wrong:
const expectedNetPaise = capturedTotalPaise - trueRefundTotalPaise - correctFeePaise - correctTaxPaise;

// ============================================================
// [5b] Inject known error #2 — FEE_MISMATCH
// The settlement file reports a fee ₹500 lower than the correct
// 2% + GST calculation.
// ============================================================

const INJECTED_FEE_ERROR_PAISE = -50000; // -₹500.00
const reportedFeePaise = correctFeePaise + INJECTED_FEE_ERROR_PAISE;
const reportedTaxPaise = calculateTaxPaise(reportedFeePaise);

// ============================================================
// [5c] Inject known error #3 — UNKNOWN_ADJUSTMENT
// An adjustment is deducted from the settlement with no source
// record explaining it. (Deliberately mirrors the ADJ_91 / -₹4,200
// worked example in the SettleGuard blueprint, section 49.)
// ============================================================

const settlementId = "SET_1042";
const unknownAdjustment: Adjustment = {
	id: "ADJ_91",
	settlementId,
	amountPaise: -420000, // -₹4,200.00
	type: "manual_adjustment",
	description: "manual adjustment",
	sourceReference: null,
};
const adjustments: Adjustment[] = [unknownAdjustment];
const adjustmentTotalPaise = adjustments.reduce((s, a) => s + a.amountPaise, 0);

const reportedNetPaise =
	capturedTotalPaise - trueRefundTotalPaise - reportedFeePaise - reportedTaxPaise + adjustmentTotalPaise;

const settlement: Settlement = {
	id: settlementId,
	grossAmountPaise: capturedTotalPaise,
	feeAmountPaise: reportedFeePaise,
	taxAmountPaise: reportedTaxPaise,
	adjustmentAmountPaise: adjustmentTotalPaise,
	reportedNetPaise,
	settledAt: "2026-08-21T18:00:00Z",
	bankReference: "UTR2026082199831",
};

// ============================================================
// [4] Produce one bank credit
// The bank pays out exactly what the settlement file says — the
// three injected errors live upstream of the bank, not in it.
// ============================================================

const bankTransaction: BankTransaction = {
	id: "BANK_920",
	amountPaise: settlement.reportedNetPaise,
	direction: "credit",
	postedAt: "2026-08-22T09:00:00Z",
	reference: settlement.bankReference,
	description: "NEFT settlement credit",
};

// ============================================================
// [6] Expected settlement calculation — already done above,
// deterministically, before any exception detection runs:
//
//   Expected Settlement = Captured Payments − Refunds − Fees − Taxes ± Adjustments
//
// The LLM never touches this. It is plain arithmetic.
// ============================================================

// ============================================================
// [7] Detect the three errors — deterministic code only
// ============================================================

const exceptions: ExceptionRecord[] = [];
let excSeq = 1;
const nextExcId = () => `EXC-${String(excSeq++).padStart(3, "0")}`;

// --- FEE_MISMATCH ---
if (reportedFeePaise !== correctFeePaise) {
	const feeDelta = Math.abs(reportedFeePaise - correctFeePaise);
	const taxDelta = Math.abs(reportedTaxPaise - correctTaxPaise);
	exceptions.push({
		id: nextExcId(),
		type: "FEE_MISMATCH",
		amountAtRiskPaise: feeDelta + taxDelta,
		relatedRecordIds: [settlement.id],
		severity: feeDelta + taxDelta > 100000 ? "high" : "medium",
		status: "OPEN",
		evidence: `Calculated fee ${inr(correctFeePaise)} (2% + GST) does not equal settlement-reported fee ${inr(reportedFeePaise)}.`,
	});
}

// --- DUPLICATE_REFUND ---
const refundGroups = new Map<string, Refund[]>();
for (const r of refunds) {
	const key = `${r.paymentId}|${r.amountPaise}|${r.createdAt}`;
	const group = refundGroups.get(key) ?? [];
	group.push(r);
	refundGroups.set(key, group);
}
for (const group of refundGroups.values()) {
	if (group.length > 1) {
		const ids = group.map((r) => r.id);
		exceptions.push({
			id: nextExcId(),
			type: "DUPLICATE_REFUND",
			amountAtRiskPaise: group[0]!.amountPaise,
			relatedRecordIds: ids,
			severity: "high",
			status: "OPEN",
			evidence: `${ids.length} refund records (${ids.join(", ")}) share the same payment, amount, and timestamp — likely one refund recorded twice.`,
		});
	}
}

// --- UNKNOWN_ADJUSTMENT ---
for (const adj of adjustments) {
	if (adj.sourceReference === null) {
		exceptions.push({
			id: nextExcId(),
			type: "UNKNOWN_ADJUSTMENT",
			amountAtRiskPaise: Math.abs(adj.amountPaise),
			relatedRecordIds: [settlement.id, adj.id],
			severity: Math.abs(adj.amountPaise) > 100000 ? "high" : "medium",
			status: "OPEN",
			evidence: `Adjustment ${adj.id} (${inr(adj.amountPaise)}) on settlement ${settlement.id} has no source_reference. No payment, refund, or fee rule explains it.`,
		});
	}
}

// ============================================================
// [8] Print a reconciliation summary
// ============================================================

const allRecordIds = [
	...payments.map((p) => p.id),
	...refunds.map((r) => r.id),
	settlement.id,
	bankTransaction.id,
	...adjustments.map((a) => a.id),
];
const totalRecords = allRecordIds.length;

const flaggedRecordIds = new Set<string>();
for (const exc of exceptions) {
	for (const id of exc.relatedRecordIds) flaggedRecordIds.add(id);
}
const matchedRecords = totalRecords - flaggedRecordIds.size;
const matchRate = (matchedRecords / totalRecords) * 100;

console.log("=".repeat(64));
console.log("SettleGuard — Phase 1 · Step 1 Proof Run");
console.log("=".repeat(64));
console.log(`Batch: demo-001   (seed ${SEED}, deterministic — rerun to verify)`);
console.log();
console.log(`Records processed: ${totalRecords}`);
console.log(`  Payments:          ${payments.length}`);
console.log(`  Refunds:           ${refunds.length}  (incl. 1 injected duplicate)`);
console.log(`  Settlements:       1`);
console.log(`  Bank transactions: 1`);
console.log(`  Adjustments:       ${adjustments.length}`);
console.log();
console.log(`Matched:    ${matchedRecords}`);
console.log(`Exceptions: ${exceptions.length}`);
console.log(`Match rate: ${matchRate.toFixed(2)}%`);
console.log();
console.log("Exceptions:");
for (const exc of exceptions) {
	console.log(`  ${exc.id}  ${exc.type.padEnd(20)} amount at risk ${inr(exc.amountAtRiskPaise)}  [${exc.severity}]`);
}
console.log();
console.log("-".repeat(64));
console.log("Reconciliation detail (settlement " + settlement.id + ")");
console.log("-".repeat(64));
console.log(`  Captured total (${payments.length} payments)      ${inr(capturedTotalPaise).padStart(14)}`);
console.log(`  True refunds (de-duplicated)         -${inr(trueRefundTotalPaise).padStart(13)}`);
console.log(`  Correct fee (2%)                     -${inr(correctFeePaise).padStart(13)}`);
console.log(`  Correct tax (18% GST on fee)          -${inr(correctTaxPaise).padStart(13)}`);
console.log(`  ${"-".repeat(50)}`);
console.log(`  Expected settlement                   ${inr(expectedNetPaise).padStart(14)}`);
console.log();
console.log(`  Reported fee (as filed)               -${inr(reportedFeePaise).padStart(13)}`);
console.log(`  Reported tax on filed fee             -${inr(reportedTaxPaise).padStart(13)}`);
console.log(`  Adjustment ${unknownAdjustment.id} (unexplained)        ${inr(unknownAdjustment.amountPaise).padStart(14)}`);
console.log(`  ${"-".repeat(50)}`);
console.log(`  Reported settlement (${settlement.id})       ${inr(settlement.reportedNetPaise).padStart(14)}`);
console.log(`  Bank credit received (${bankTransaction.id})     ${inr(bankTransaction.amountPaise).padStart(14)}`);
console.log();
console.log(`  Difference (expected − reported):      ${inr(expectedNetPaise - reportedNetPaise).padStart(14)}`);
console.log("=".repeat(64));

if (exceptions.length === 3) {
	console.log("PROOF PASSED: all 3 injected errors were detected deterministically. No LLM was called.");
} else {
	console.log(`PROOF FAILED: expected 3 exceptions, detected ${exceptions.length}. Fix detection logic before continuing.`);
	process.exitCode = 1;
}
