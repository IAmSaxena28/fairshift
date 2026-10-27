# Demo guide

A guided tour of FairShift in about ten minutes. Every step uses the seeded demo data, which is generated relative to today's date each time the server starts. All people and organisations are fictional.

Open the app (locally `http://localhost:8080`, or the Cloud Run URL). The sign-in page lists one-tap demo accounts; the password for all of them is `fairshift-demo`. Use a phone-sized window for worker steps (browser dev tools, 360 to 400 px wide) and a desktop-sized one for employer steps.

To start again from clean data, restart the server (on Cloud Run, deploy again or wait for it to scale to zero).

## 1. A wage gap, found by the worker (construction)

**Ravi Kumar, mason** (`ravi`)

1. On **Today**, see today's shift and the check-in button.
2. Open **Pay**. The month selector shows last month.
3. Read the Fairness Replay from top to bottom: shifts and recorded time, unpaid breaks, paid time, the overtime split, normal pay, overtime pay, the ₹500 "Advance repaid" deduction, and the total his records support: **₹25,920.00**.
4. Below it: payroll recorded **₹24,720.00**, and a red box naming the gap: **₹1,200.00 less, in overtime pay** (₹6,980.00 expected, ₹5,780.00 recorded).
5. Tap **Listen** to hear the explanation (if the device has an English voice).
6. Tap **This looks wrong. Ask for a check**, add a note, **Send**.
7. Switch to **த** (Tamil) or **हि** (Hindi) at the top: the whole explanation, with the same numbers, changes language.

**Lakshmi Raman, site supervisor** (`lakshmi`)

8. **Overview** lists "Ravi Kumar asked for a pay check" under Needs action.
9. Open **Pay & time requests**, then Ravi's request. The same replay is shown, so the supervisor reviews exactly what the worker saw.
10. Choose **Correct payroll to the calculated amount**, write a reason the worker will read, and **Record decision**. The result now matches.
11. Open **Audit trail** and press **Verify the whole chain**: "Chain intact".

**Back as Ravi**

12. **Pay** now says the payroll matches his records and shows "Your request: Corrected". Open **Payroll versions** to see version 1 and version 2 side by side. Nothing was overwritten.

## 2. A forgotten check-out (construction)

**Suresh Mani, helper** (`suresh`)

1. **Today** or **Hours** shows a shift from a few days ago with no check-out, marked unpaid until fixed.
2. Tap **Fix this shift**, then **Tell us when you left**, enter a time such as 16:10, **Send**.
3. As `lakshmi`, the request appears under **Pay & time requests**. Choose **Record the check-out**; the shift becomes paid in the replay. The original events stay, with a correction added on top.

## 3. A confidential safety report (college)

**Priya, housekeeping** (`priya`)

1. Open **Help**. Tap a problem type such as **Danger at work**. Optionally write a few words and pick a place.
2. Under "Who can see your name?" choose **Keep my name out**. Read the note on what that does and does not protect.
3. **Send report**. A tracking code such as `K7QM-3XPA-9RTD` is shown once. Copy it.

**Dr. Anita Rao, facilities manager** (`anita`)

4. **Safety & grievances** lists the report as **Confidential**, with no name.
5. Open it, write a note, choose whether the reporter can see it, and move it to **Acknowledged**, then on through **Under review** and **Action taken**. States cannot be skipped.

**Anyone with the code**

6. Sign out and open `/track`. Enter the code. The status and the manager's public notes appear, with no sign-in. If the problem returns, **Still a problem? Reopen**.

Also try:

- `/report/GREENFIELD` reports without being signed in at all. Choose **Maintenance** as the place: the form explains that on a small team the site will be withheld.
- As `lakshmi`, the OMR Warehouse report shows "Site withheld" because only two people work there.
- Seeded codes for `/track`: `DEMO-CNST-0001`, `DEMO-CNST-0002`, `DEMO-CLGE-0001`, `DEMO-CLGE-0002`.

## 4. Inclusion and rest (college)

**Selvam, night guard** (`selvam`)

1. Tap **हि** for Hindi. The whole worker app changes, including dates, numbers and durations.
2. Press the large check-in button.
3. The amber box shows rest facts in plain words: seven days in a row, short rest between shifts, more than 48 hours in a week. These are facts with dates, not a score.
4. Open **मदद** (Help), tap **काम पर खतरा** (danger at work), tick **अभी किसी को चोट लग सकती है** (someone could get hurt now) and send, without typing anything.
5. As `anita`, the urgent report is at the top of **Needs action**. If it is not acknowledged within the organisation's deadline (4 hours in the demo), it is flagged as overdue.
6. Open **Pay** as Selvam to see a monthly salary replay with the weekly overtime rule and night allowances.

## 5. Same platform, two industries

Compare **Pay rules** as `lakshmi` and as `anita`:

| | Construction | College |
| --- | --- | --- |
| Overtime | Daily, after 8 h, 2× | Weekly, after 48 h, 1.5× |
| Base | Hourly rate | Monthly salary |
| Night allowance | None | ₹100 a night shift |

Both orgs run on the same engine, the same screens and the same tests. **Propose a new version** on the Pay rules page to see that a change can start this month or later, never earlier.

## 6. Accessibility checks you can do by hand

- Use **Tab** and **Enter/Space** only: file a report on `/report/STHAPATI` from start to finish.
- Turn on the operating system's dark mode: the app follows it.
- Zoom to 200%: content reflows without sideways scrolling on the worker screens.
- With a screen reader, the language buttons announce the full language name, and status messages are read out when they appear.

## If something goes wrong during a live demo

- Data looks different from this guide: the seed is relative to today, so dates and some totals shift. Ravi's ₹1,200 overtime gap is always present for last month.
- A step was already done (for example Ravi's correction): restart the server to reseed.
- No read-aloud: the device has no voice for that language; the app says so.
