"use strict";

/**
 * second-look.js — lo que se le pide a la segunda pasada.
 *
 * Hasta aca la segunda pasada era el mismo pedido mandado dos veces. Medido con la
 * configuracion actual sumaba ~32% de hallazgos, todos de lo que la primera no vio por azar.
 * Lo que las dos se pierden siempre es lo mismo: lo que exige poner un documento al lado de
 * otro. Una revision a mano de dos declaraciones reales encontro lo que ninguna pasada vio —
 * la residencia contradicha por los propios W-2 y 1098, un K-1 estimado tomado como respaldo,
 * prestamos de socios repartidos como nonrecourse, un pago estatal sin su eleccion— y ninguna
 * de esas cosas se encuentra leyendo un formulario por vez.
 *
 * Entonces la segunda pasada hace otro trabajo: recibe lo que ya se encontro, con la orden de
 * no repetirlo, y una lista fija de preguntas que obligan a cruzar documentos. Los documentos
 * son los mismos y siguen en el cache de prompt, asi que cuesta lo mismo que repetir.
 */

const CHECKLISTS = {
  individual: [
    "RESIDENCY. List every address printed on the W-2s, 1099s, 1098s, K-1s, IDs, closing statements and property records dated in the tax year or the January after, and compare them with the residency status and dates claimed on each state return. A document that places the taxpayer in another state during the year (wages from that state only, a mortgage statement mailed there, a license issued there) means the residency dates or the income allocation may be wrong: name the documents and the state return.",
    "EACH PASS-THROUGH ENTITY on Schedule E Part II and each K-1 in the package: is the K-1 here, and is it final or an estimate? For an S corporation the taxpayer controls: is there a W-2 from it (reasonable compensation), does Form 7203 start from last year's ending basis, and is the business a specified service trade or business for the QBI deduction?",
    "EACH PROPERTY on last year's Schedule E: is it on this year's return? If it was sold (closing statement, 1099-S), is the sale on Form 4797 or 8949, and were its suspended passive losses released (§469(g))? Do the rental days, rents and expenses fit the months it was actually owned and rented (large auto, travel or repair expenses on a property rented a few weeks)? Did depreciation continue for property still in service?",
    "EACH SALE: from the closing statement, compute the amount realized (price plus credits to the seller, less selling costs) and check what the return uses for basis, depreciation allowed or allowable, prorated property taxes and unamortized loan costs.",
    "TIMING: compare the date the return is prepared or filed with the April 15 due date. A balance paid late carries §6651 penalty and §6601 interest the client should be told about. Estimate vouchers whose due dates have already passed should be flagged.",
    "DOCUMENTS THE RETURN DOES NOT USE: every 1099, 1098, K-1, closing statement, notice or letter in the package should be reflected on the return or explained.",
    "ANSWERED QUESTIONS: check each Yes/No the return answers (1099 filing on Schedule E, digital assets, foreign accounts) against the documents.",
  ],
  partnership: [
    "EACH K-1 RECEIVED from a lower-tier fund: identify the issuer from the document itself, not the file name. Is it on the return with this year's amounts — not a record carried over from last year with zeros — and do the return's amounts match it box by box (interest, dividends, capital gains, portfolio deductions, section 199A)? Is it final, or an estimate or projection? If two versions exist, which one did the return use?",
    "OWNERSHIP CHANGES: buyouts, redemptions or new partners mentioned in the workpapers, the books or a note. Is the departing partner's K-1 marked final, with the redemption on Schedule M-2 and K-1 item L, and do the year-end percentages reflect the change?",
    "PARTNER LIABILITIES (K-1 item K): are the beginning and ending columns filled, do they add to the Schedule L liabilities, and are loans from partners allocated as recourse to the partner who lent (Treas. Reg. §1.752-2)? Is anything that is not a loan (taxes payable, accrued expenses) sitting inside the loan accounts?",
    "STATE ELECTIONS AND PAYMENTS: pass-through entity tax payments — is the election form there (for example California Form 3804), and is the payment treated as the elective tax rather than refunded or carried as an estimate? State apportionment and nexus for each state with activity.",
    "SCHEDULE B ANSWERS against the ownership table: with family and entity attribution (§267(c)), does any person own 50% or more (question 2 and Schedule B-1)? Also the 1099 filing, §754 and centralized audit answers.",
    "BOOKS VERSUS RETURN: where the balance sheet or the M-1 does not tie, identify the cause — for example K-1 income that was never booked, or a capital movement in the books that is not on the return.",
    "NATURE OF THE ACTIVITY: is the partnership carrying on a trade or business (§162) or only investing (§212, portfolio deductions on Schedule K line 13)? Large jumps in legal and professional fees against last year — do they relate to an ownership change or a financing that should be capitalized (§263)?",
    "INVESTMENT INCOME DETAIL from brokerage 1099s: tax-exempt interest, bond premium (it reduces tax-exempt interest; it is not other tax-exempt income), qualified dividends, foreign tax.",
  ],
  scorp: [
    "EACH K-1 RECEIVED by the corporation and each shareholder K-1 issued: are amounts complete and final (not estimates), and do the shareholder percentages match the stock ledger at every change during the year?",
    "SHAREHOLDER COMPENSATION: officer wages against distributions (reasonable compensation), and shareholder health insurance reported in box 1 of the W-2.",
    "SHAREHOLDER LOANS AND BASIS: loans to and from shareholders on Schedule L, interest on them, and whether distributions exceed stock basis (Form 7203) or AAA.",
    "STATE ELECTIONS AND PAYMENTS: pass-through entity tax payments and their election, and apportionment and nexus for each state with activity.",
    "BOOKS VERSUS RETURN: where the balance sheet, M-1 or M-2 does not tie, identify the cause.",
    "SALES OF ASSETS OR THE BUSINESS: closing statements, purchase agreements, Form 8594 or 8308 in the package — is each sale on Form 4797 with its recapture, and is the gain passed through on the K-1s?",
    "LARGE CHANGES against last year in any expense line: what explains them, and should any be capitalized?",
  ],
  corporation: [
    "OFFICER COMPENSATION AND RELATED PARTIES: officer wages against Form 1125-E, loans to and from shareholders, accrued amounts owed to related parties (§267(a)(2)), and interest on them.",
    "ESTIMATED TAX AND PENALTIES: were the quarterly estimates paid, and does the return compute the underpayment penalty (Form 2220)?",
    "BOOKS VERSUS RETURN: where the balance sheet, M-1 or M-2 does not tie, identify the cause.",
    "STATE APPORTIONMENT AND NEXUS for each state with activity, and state returns that dropped out against last year.",
    "SALES OF ASSETS, carryforwards (NOL, capital loss, credits) against last year's return, and the dividends-received deduction.",
    "LARGE CHANGES against last year in any expense line: what explains them, and should any be capitalized?",
  ],
};

/** 1040, 1065, 1120-S o 1120, a partir de lo que escribio el usuario en el formulario. */
function returnFamily(returnType) {
  const t = String(returnType || "").toUpperCase().replace(/\s+/g, "");
  if (/1120-?S/.test(t)) return "scorp";
  if (/1065/.test(t)) return "partnership";
  if (/1120/.test(t)) return "corporation";
  if (/1040|1041/.test(t)) return "individual";
  return "individual";
}

/** Lo ya encontrado, una linea por hallazgo, para que la segunda pasada no lo repita. */
function alreadyReported(issues) {
  const list = (Array.isArray(issues) ? issues : []).filter((i) => i && typeof i === "object");
  if (!list.length) return "None.";
  return list.map((issue, n) => {
    const where = String(issue.formOrSchedule || issue.areaReviewed || "").replace(/\s+/g, " ").trim();
    const what = String(issue.issueDescription || "").replace(/\s+/g, " ").trim().slice(0, 220);
    return `${n + 1}. [${String(issue.priority || "").toUpperCase() || "—"}] ${where}${where ? " — " : ""}${what}`;
  }).join("\n");
}

function buildSecondLookInstructions({ returnType, issues }) {
  const checklist = CHECKLISTS[returnFamily(returnType)];
  return [
    "SECOND LOOK — A DIFFERENT JOB FROM THE FIRST REVIEW.",
    "A first reviewer has already gone through this package and reported the findings listed below. Do not repeat, reword or re-verify them: they are already in the report. Your job is what first reviews systematically miss — questions that can only be answered by putting two or more documents side by side.",
    "Work through EVERY question below against the documents. Where the documents show a problem, report it as an issue: issueDescription is one sentence naming the two facts or figures that disagree, and evidence names both documents. Where they show no problem, say nothing about that question. A question you cannot answer from the package goes in openQuestions, never in issues.",
    "Not issues: differences under $100 (rounding), and documents dated after the tax year that do not change this year's return — a purchase or sale closing next year belongs to next year's review.",
    "",
    "ALREADY REPORTED (do not repeat):",
    alreadyReported(issues),
    "",
    "QUESTIONS:",
    ...checklist.map((q, n) => `${n + 1}. ${q}`),
    "",
    "The scanned documents attached above were already transcribed by the first reviewer: read them again only to answer these questions, and do not add SCANNED lines. Leave tieOutResults, infoConsistency, checkboxReview and verifiedItems empty — the first review produced them. Put everything you find in issues, missingDocuments and openQuestions.",
  ].join("\n");
}

module.exports = { buildSecondLookInstructions, returnFamily, alreadyReported, CHECKLISTS };
