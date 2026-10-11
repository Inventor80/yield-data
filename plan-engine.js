/**
 * The plan engine: two answers in, one recommendation out.
 *
 * WHY THIS FILE IS PLAIN JAVASCRIPT
 * ---------------------------------
 * It is the only piece of logic the phone app and the website both
 * run. Written in TypeScript it would need compiling for the web;
 * written twice it would drift, and the two would eventually
 * recommend different things to the same person — which is exactly
 * the failure the hosted rates file was built to prevent. So: one
 * plain ES module, imported by the app and copied to the site by
 * build:site. No imports of its own, so it runs anywhere.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * It never predicts. Every number here is either a rate published by
 * the DMO or CBN, or arithmetic on one. It does not rank shares, it
 * does not forecast, and where the honest answer is "this money
 * should not be invested at all" — an emergency fund, money needed
 * next month — it says so instead of finding something to sell.
 */

/** How soon the money is needed back. */
export const HORIZONS = [
  { key: 'short', label: 'Within a year', detail: 'School fees, rent, an emergency fund' },
  { key: 'medium', label: 'In two or three years', detail: 'A deposit, a car, something planned' },
  { key: 'long', label: 'Longer than that', detail: 'Retirement, a child’s future, no fixed date' },
  { key: 'unsure', label: 'I am not sure yet', detail: 'Show me everything' },
];

/** Years for a sum to double, compounding annually. */
export function doublingYears(ratePct) {
  if (!ratePct || ratePct <= 0) return null;
  return Math.log(2) / Math.log(1 + ratePct / 100);
}

/** 5.27 → "5y 3m". The unit people actually think in. */
export function formatYears(years) {
  if (years === null || !isFinite(years)) return '—';
  const whole = Math.floor(years);
  const months = Math.round((years - whole) * 12);
  if (months === 12) return `${whole + 1}y 0m`;
  return `${whole}y ${months}m`;
}

export function naira(value) {
  return '₦' + Math.round(value).toLocaleString('en-NG');
}

/**
 * Simple interest, because that is what these instruments actually
 * do: a savings bond pays its coupon into your account every quarter
 * rather than rolling it up. Quoting a compounded figure would flatter
 * the result by money the reader never receives unless they reinvest
 * it themselves.
 */
function grow(amount, ratePct, years) {
  return amount * (1 + (ratePct / 100) * years);
}

/**
 * The recommendation.
 *
 * `figures` is the live rates object; `events` the calendar. Both are
 * passed in rather than fetched, so this stays pure and the caller
 * owns the loading.
 */
export function buildPlan({ amount, horizon, figures, events = [], today = new Date() }) {
  const rate = (key) => (figures && figures[key] ? figures[key].value : null);

  const savings = rate('savings');
  const bond = rate('savingsBond');
  const tbill = rate('tbill');
  const inflation = rate('inflation');

  // 10% withholding on Treasury Bills since the FIRS notice of
  // 28 October 2025. Comparing a taxed rate with an exempt one at
  // face value is the single most common way these comparisons lie.
  const tbillNet = tbill === null ? null : tbill * 0.9;

  const years = horizon === 'short' ? 1 : horizon === 'medium' ? 3 : horizon === 'long' ? 5 : 3;

  const options = [
    savings !== null && {
      key: 'savings',
      label: 'Savings account',
      ratePct: savings,
      note: 'Reachable any day, and well under inflation',
      total: grow(amount, savings, years),
    },
    tbill !== null && {
      key: 'tbill',
      label: 'Treasury Bill',
      ratePct: tbillNet,
      rateNote: `${tbill}% less 10% tax`,
      note: 'Under a year at a time, government-backed',
      total: grow(amount, tbillNet, years),
    },
    bond !== null && {
      key: 'savingsBond',
      label: 'FGN Savings Bond',
      ratePct: bond,
      note: 'Two or three years, paid quarterly, no tax',
      total: grow(amount, bond, years),
    },
  ].filter(Boolean);

  options.sort((a, b) => b.total - a.total);

  /**
   * Which one fits — decided by the horizon, not by the biggest
   * number. Money needed within a year does not belong in a 3-year
   * bond however well it pays, and saying otherwise would be the kind
   * of advice this app exists to argue against.
   */
  let pickKey;
  let headline;
  let reason;

  if (horizon === 'short') {
    pickKey = 'tbill';
    headline = 'Keep this money reachable';
    reason =
      'Money you may need within a year should not be locked up. A Treasury Bill of 91 or 182 days, or a money market fund, keeps it available while paying far more than a savings account.';
  } else if (horizon === 'medium') {
    pickKey = 'savingsBond';
    headline = 'A 3-year FGN Savings Bond fits this money';
    reason =
      'Long enough to earn a real return, short enough to match a plan you already have. Government-backed, no tax on the interest, and the interest arrives every three months.';
  } else if (horizon === 'long') {
    pickKey = 'savingsBond';
    headline = 'Start with a savings bond, then widen out';
    reason =
      'Over this long you can take more risk than a bond — shares and funds have more room to grow. Start here because it is simple and certain, and read the lessons on shares and funds before you add them.';
  } else {
    pickKey = 'savingsBond';
    headline = 'Start where everyone sensible starts';
    reason =
      'Until you know when you need the money, the FGN Savings Bond is the safest useful answer: ₦5,000 minimum, government-backed, and you know the rate before you commit.';
  }

  const pick = options.find((o) => o.key === pickKey) || options[0];

  /**
   * When the recommendation is not the biggest number on the screen.
   *
   * Over three years a rolling Treasury Bill shows more than a savings
   * bond, and a reader will immediately ask why we did not say so. The
   * answer is real and worth teaching: a bill matures inside a year, so
   * that figure assumes you reinvest it two more times at rates nobody
   * knows yet. The bond fixes the rate for the whole term. Leaving the
   * question unanswered would look like either an error or a hidden
   * motive, and neither is affordable here.
   */
  let pickCaveat = null;
  const best = options[0];
  if (best && pick && best.key !== pick.key && best.total > pick.total) {
    if (best.key === 'tbill') {
      pickCaveat =
        'A Treasury Bill shows more here, but it matures in under a year — that figure assumes you reinvest it again at rates nobody knows yet. The bond fixes your rate for the whole term, which is what matters when the money has a date on it.';
    } else {
      pickCaveat =
        'Another option shows a larger number, but it does not match when you need the money back. The horizon picks the tool.';
    }
  }
  const worst = options.find((o) => o.key === 'savings');
  const gap = pick && worst ? pick.total - worst.total : 0;

  // Doubling, including the one that matters: prices.
  const doubling = [
    savings !== null && { label: 'Savings account', ratePct: savings, years: doublingYears(savings) },
    bond !== null && { label: 'FGN Savings Bond', ratePct: bond, years: doublingYears(bond) },
    tbillNet !== null && {
      label: 'Treasury Bill, after tax',
      ratePct: tbillNet,
      years: doublingYears(tbillNet),
    },
  ].filter(Boolean);
  doubling.sort((a, b) => b.years - a.years);

  const pricesDouble = inflation !== null ? doublingYears(inflation) : null;

  // The next window for the thing we recommended.
  const wantKinds =
    pickKey === 'tbill' ? ['tbill'] : ['savings_bond'];
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const next =
    events
      .filter((e) => wantKinds.includes(e.kind))
      .filter((e) => {
        const [y, m, d] = String(e.endDate).split('-').map(Number);
        return new Date(y, m - 1, d) >= startOfDay;
      })
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0] || null;

  let daysAway = null;
  if (next) {
    const [y, m, d] = String(next.startDate).split('-').map(Number);
    daysAway = Math.round((new Date(y, m - 1, d) - startOfDay) / 86400000);
  }

  const lessonId = pickKey === 'tbill' ? 'treasury-bills' : 'fgn-savings-bond';
  const lessonTitle = pickKey === 'tbill' ? 'Treasury Bills' : 'The FGN Savings Bond';

  return {
    amount,
    years,
    headline,
    reason,
    pick,
    pickCaveat,
    options,
    gap,
    doubling,
    pricesDouble,
    inflation,
    next,
    daysAway,
    lessonId,
    lessonTitle,
    /** True when the honest answer is "do not invest this yet". */
    emergencyWarning: horizon === 'short',
  };
}
