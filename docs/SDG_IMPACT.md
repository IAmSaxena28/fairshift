# SDG 8 impact

FairShift addresses **UN Sustainable Development Goal 8: promote sustained, inclusive and sustainable economic growth, full and productive employment and decent work for all.** This page explains which parts of the goal it touches, how each feature connects to them, and how impact could be measured. It makes no claim of measured impact: FairShift is a prototype that has only been used with synthetic data.

## Targets addressed

| SDG 8 target | What it asks | How FairShift contributes |
| --- | --- | --- |
| **8.5** | Decent work for all, and equal pay for work of equal value | Workers can check their own pay against their own records, step by step, in their language. A shortfall is named by component and can be raised with one tap. Every worker in a pay group is replayed with the same versioned rules. |
| **8.8** | Protect labour rights and promote safe and secure working environments for all workers, including migrant workers and those in precarious employment | Safety problems and grievances can be reported by name or without a name, tracked with a code, and must move through a visible sequence of states. Urgent reports carry an acknowledgement deadline. Rest and working-time facts are shown to both sides. |

## The problem, in work terms

In workplaces with many hourly and shift workers, the records that decide pay (attendance, overtime, deductions) are usually held by the employer and rarely shown to the worker in a form they can check. When something looks wrong, the worker has to raise it with the person who keeps the records, often without a written trail. Safety concerns travel the same informal path. Workers who are new, on short contracts, or working in a second language are the least likely to raise either.

FairShift does not replace payroll, inspectors or unions. It gives the worker and the employer **the same explanation of the same records**, and puts every response on a record that cannot quietly change.

## Feature to outcome

| Feature | Intended outcome | Who benefits |
| --- | --- | --- |
| Fairness Replay | Pay errors are found by the person they affect, early, with the evidence attached | Workers, and payroll teams who want to catch their own mistakes |
| Correction workflow with written outcomes and kept versions | Disputes end with a recorded decision, not a conversation | Workers, supervisors |
| Missed check-out fix from the phone | Fewer unpaid shifts caused by a forgotten tap | Workers |
| "Keep my name out" reports with tracking codes | Concerns raised that would otherwise stay silent; the reporter still hears back | Workers, especially those worried about retaliation |
| Urgent flag and acknowledgement deadline | Dangerous conditions get a fast first response | Everyone on site |
| Rest and working-time facts | Long shifts, short rest and long weeks become visible before they become normal | Workers, employers planning rotas |
| Tamil, Hindi and English, read-aloud, icon-first report form | Workers with limited English or literacy can use the same tools | Migrant and low-literacy workers |
| Employer overview of pay mismatches, open cases and missed check-outs | Problems are fixed as patterns, not only one complaint at a time | Employers |

## Design choices that protect workers

- **No scoring.** FairShift never ranks or rates workers. Data collected to protect workers is not turned into a tool to discipline them.
- **No surveillance.** No location, camera, biometrics or device tracking. Check-in is a button press.
- **Honest confidentiality.** Reports are never called "anonymous". The limits are stated on screen before and after sending ([SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)).
- **No silent edits.** Attendance is append-only, payroll is versioned, pay rules cannot be back-dated, and the audit log is hash-chained.
- **Not legal advice.** The pay rules are the employer's own, shown transparently. FairShift does not claim to know what the law requires in a given case.

## How impact could be measured in a pilot

These are proposed measures for a real pilot. None of them has been measured yet.

| Question | Measure | Source in FairShift |
| --- | --- | --- |
| Are pay errors being found? | Share of pay periods with a mismatch; median time from mismatch to resolved correction | `payroll_records`, `correction_cases` |
| Are errors corrected, not just raised? | Share of pay requests resolved as "corrected" vs "no change", with reasons | `correction_cases.outcome` |
| Are concerns being raised? | Reports per 100 workers per month, by category and by named vs confidential | `safety_cases` (counts only) |
| Are concerns answered? | Median days to acknowledge and to resolve; share of urgent reports acknowledged within the deadline | `case_events` |
| Is working time improving? | Count of long-shift, short-rest and long-week facts per month | Rest and working-time facts |
| Can workers use it? | Task completion for check-in, reading pay, filing a report, by language, in moderated sessions | Usability study |

A pilot should also ask workers directly, through people they trust, whether using FairShift ever caused them a problem.

## Scope

The two demo industries are construction and college facilities (security, housekeeping, maintenance). The same rules engine supports other shift-based workplaces such as warehouses, hospitals' support staff or hotels, by changing configuration only (see [INDUSTRY_USE_CASES.md](INDUSTRY_USE_CASES.md)).
